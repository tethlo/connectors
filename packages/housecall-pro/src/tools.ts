import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Customer, Estimate, HousecallProApi, Job, Person } from "./api.ts";
import { DATE, defineTool, fromCents, money, pickOne, type ToolContext, ToolError } from "./core.ts";

export interface ToolOptions {
  writes: boolean;
  now: () => Date;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));
const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`.trim();
const where = (a?: { street?: string; city?: string }) => (a ? [a.street, a.city].filter(Boolean).join(", ") || undefined : undefined);

const STATUS: Record<string, string[]> = {
  open: ["unscheduled", "scheduled", "in_progress"],
  unscheduled: ["unscheduled"],
  scheduled: ["scheduled"],
  in_progress: ["in_progress"],
  completed: ["complete unrated", "complete rated"],
  canceled: ["user canceled", "pro canceled"],
};

function jobSummary(j: Job) {
  return {
    id: j.id,
    invoice: j.invoice_number,
    customer: fullName(j.customer),
    description: j.description || undefined,
    status: j.work_status,
    start: j.schedule?.scheduled_start ?? undefined,
    end: j.schedule?.scheduled_end ?? undefined,
    address: where(j.address),
    techs: j.assigned_employees?.map(fullName),
    total: fromCents(j.total_amount),
    balance: fromCents(j.outstanding_balance) || undefined,
  };
}

const customerSummary = (c: Customer) => ({
  id: c.id,
  name: fullName(c),
  company: c.company || undefined,
  email: c.email || undefined,
  phone: c.mobile_number || undefined,
  address: where(c.addresses?.[0]),
});

async function resolveCustomer(api: HousecallProApi, ref: string): Promise<Customer> {
  const found = await api.listCustomers({ q: ref.trim() });
  const lower = ref.trim().toLowerCase();
  const exact = found.filter((c) => c.id === ref.trim() || fullName(c).toLowerCase() === lower || c.email?.toLowerCase() === lower);
  return pickOne(ref, exact.length ? exact : found, (c) => `"${fullName(c)}" (${c.email ?? c.id})`, "customer", "Search with find_customers.");
}

function resolveTech(employees: Person[], ref: string): Person {
  const lower = ref.trim().toLowerCase();
  const exact = employees.filter((e) => e.id === ref.trim() || fullName(e).toLowerCase() === lower);
  return pickOne(ref, exact.length ? exact : employees.filter((e) => fullName(e).toLowerCase().includes(lower)), (e) => `"${fullName(e)}"`, "employee", "Call list_employees.");
}

export function registerTools(server: McpServer, api: HousecallProApi, options: ToolOptions): void {
  const ctx: ToolContext = { server, writes: options.writes, service: "Housecall Pro" };
  const today = () => iso(options.now());

  defineTool(
    ctx,
    "find_customers",
    {
      title: "Find customers",
      description:
        "Search customers by name, email, phone or address, with contact details and service address. Use it to look up a " +
        "homeowner before checking their jobs, or to check that someone is already a customer.",
      input: { query: z.string().min(2), limit: z.number().int().min(1).max(50).default(10) },
      kind: "read",
    },
    async ({ query, limit }) => {
      const customers = await api.listCustomers({ q: query, page_size: limit });
      return { count: customers.length, customers: customers.map(customerSummary) };
    },
  );

  defineTool(
    ctx,
    "list_jobs",
    {
      title: "List jobs",
      description:
        "Jobs between two dates (default: today and the next 7 days) by status (open, unscheduled, scheduled, in_progress, " +
        "completed, canceled), customer or technician, with address, assigned techs, total and balance due.",
      input: {
        from: z.string().regex(DATE).optional(),
        to: z.string().regex(DATE).optional(),
        status: z.enum(["open", "unscheduled", "scheduled", "in_progress", "completed", "canceled", "all"]).default("open"),
        customer: z.string().optional().describe("Customer name, email or id."),
        technician: z.string().optional().describe("Employee name."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      kind: "read",
    },
    async (args) => {
      const customer = args.customer ? await resolveCustomer(api, args.customer) : undefined;
      const tech = args.technician ? resolveTech(await api.listEmployees(), args.technician) : undefined;
      const unscheduledOnly = args.status === "unscheduled";
      const from = args.from ?? today();
      const to = args.to ?? addDays(from, 7);
      const jobs = (
        await api.listJobs({
          scheduled_start_min: unscheduledOnly || customer ? undefined : `${from}T00:00:00Z`,
          scheduled_start_max: unscheduledOnly || customer ? undefined : `${to}T23:59:59Z`,
          customer_id: customer?.id,
          "work_status[]": args.status === "all" ? undefined : STATUS[args.status],
        })
      ).filter((j) => !tech || j.assigned_employees?.some((e) => e.id === tech.id));
      return {
        count: jobs.length,
        total: money(jobs.reduce((s, j) => s + fromCents(j.total_amount), 0)),
        balance_due: money(jobs.reduce((s, j) => s + fromCents(j.outstanding_balance), 0)),
        jobs: jobs.slice(0, args.limit).map(jobSummary),
      };
    },
  );

  defineTool(
    ctx,
    "get_job",
    {
      title: "Get a job",
      description:
        "One job by id: customer, description, address, schedule window, assigned technicians, status, total, balance due " +
        "and job notes. Use the id returned by list_jobs.",
      input: { job_id: z.string().min(1) },
      kind: "read",
    },
    async ({ job_id }) => {
      const job = await api.getJob(job_id);
      return { ...jobSummary(job), notes: job.notes?.map((n) => n.content) };
    },
  );

  defineTool(
    ctx,
    "get_schedule_summary",
    {
      title: "Get the schedule summary",
      description:
        "Dispatch overview for a day or a few days (default: today): jobs per technician with their times and addresses, " +
        "jobs with no tech assigned, unscheduled jobs waiting for a date, and the booked revenue.",
      input: { from: z.string().regex(DATE).optional(), days: z.number().int().min(1).max(7).default(1) },
      kind: "read",
    },
    async (args) => {
      const from = args.from ?? today();
      const to = addDays(from, args.days - 1);
      const [scheduled, unscheduled] = await Promise.all([
        api.listJobs({ scheduled_start_min: `${from}T00:00:00Z`, scheduled_start_max: `${to}T23:59:59Z`, "work_status[]": ["scheduled", "in_progress"] }),
        api.listJobs({ "work_status[]": ["unscheduled"] }),
      ]);
      const byTech = new Map<string, Array<{ start?: string; customer: string; address?: string }>>();
      for (const job of scheduled) {
        for (const tech of job.assigned_employees ?? []) {
          const list = byTech.get(fullName(tech)) ?? [];
          list.push({ start: job.schedule?.scheduled_start ?? undefined, customer: fullName(job.customer), address: where(job.address) });
          byTech.set(fullName(tech), list);
        }
      }
      return {
        from,
        to,
        jobs: scheduled.length,
        booked_revenue: money(scheduled.reduce((s, j) => s + fromCents(j.total_amount), 0)),
        by_technician: [...byTech].map(([technician, jobs]) => ({ technician, count: jobs.length, jobs: jobs.sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "")) })),
        unassigned: scheduled.filter((j) => !j.assigned_employees?.length).map(jobSummary),
        unscheduled_waiting: unscheduled.length,
      };
    },
  );

  defineTool(
    ctx,
    "list_estimates",
    {
      title: "List estimates",
      description:
        "Estimates (quotes) with customer, options and their approval status and amount, optionally for one customer. Use " +
        "it to follow up on quotes that are still waiting for the customer's approval.",
      input: { customer: z.string().optional(), pending_only: z.boolean().default(false).describe("Only estimates with no approved or declined option.") },
      kind: "read",
    },
    async (args) => {
      const customer = args.customer ? await resolveCustomer(api, args.customer) : undefined;
      const estimates = (await api.listEstimates({ customer_id: customer?.id })).filter(
        (e: Estimate) => !args.pending_only || !(e.options ?? []).some((o) => o.approval_status === "approved" || o.approval_status === "declined"),
      );
      return {
        count: estimates.length,
        estimates: estimates.map((e) => ({
          id: e.id,
          number: e.estimate_number,
          customer: fullName(e.customer),
          options: (e.options ?? []).map((o) => ({ name: o.name, amount: fromCents(o.total_amount), approval: o.approval_status ?? "pending" })),
        })),
      };
    },
  );

  defineTool(
    ctx,
    "list_employees",
    {
      title: "List employees",
      description:
        "Technicians and office staff (employees) with their role, to know who can be assigned or to filter the job list " +
        "and the schedule by technician.",
      input: {},
      kind: "read",
    },
    async () => {
      const employees = await api.listEmployees();
      return { count: employees.length, employees: employees.map((e) => ({ id: e.id, name: fullName(e), role: e.role })) };
    },
  );

  defineTool(
    ctx,
    "create_customer",
    {
      title: "Create a customer",
      description:
        "Add a new customer with contact details and service address. Automatic customer notifications are off for customers " +
        "created here. Returns the existing customer instead of a duplicate when the email is already known.",
      input: {
        first_name: z.string().min(1),
        last_name: z.string().optional(),
        email: z.email().optional(),
        phone: z.string().optional(),
        company: z.string().optional(),
        street: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
      },
      kind: "write",
      idempotent: true,
    },
    async (args) => {
      if (args.email) {
        const existing = (await api.listCustomers({ q: args.email })).find((c) => c.email?.toLowerCase() === args.email.toLowerCase());
        if (existing) return { action: "existing", customer: customerSummary(existing) };
      }
      const address = args.street ? [{ street: args.street, city: args.city, state: args.state, zip: args.zip }] : undefined;
      const created = await api.createCustomer({ first_name: args.first_name, last_name: args.last_name, email: args.email, mobile_number: args.phone, company: args.company, notifications_enabled: false, addresses: address });
      return { action: "created", customer: customerSummary(created) };
    },
  );

  defineTool(
    ctx,
    "add_job_note",
    {
      title: "Add a job note",
      description:
        "Add an internal note to a job (gate code, parts needed, what the customer said on the phone) so the technician sees " +
        "it. Notes are internal; the customer is not messaged.",
      input: { job_id: z.string().min(1), note: z.string().min(1).max(5000) },
      kind: "write",
    },
    async ({ job_id, note }) => {
      const job = await api.getJob(job_id);
      if (STATUS.canceled.includes(job.work_status)) throw new ToolError(`Job ${job_id} is canceled.`);
      await api.addJobNote(job_id, note);
      return { done: true, job: job_id, customer: fullName(job.customer) };
    },
  );
}
