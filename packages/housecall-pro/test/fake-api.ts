// In-memory imitation of the Housecall Pro public API, for the tests and the agent evaluation.
// Shapes follow the public docs (docs.housecallpro.com); filters are simplified. Amounts are in cents, as in the API.
import type { Customer, Estimate, Job, Person } from "../src/api.ts";

export const NOW = "2026-11-24T07:00:00Z";
export const TEST_ENV = { HOUSECALLPRO_API_KEY: "test-key", HOUSECALLPRO_BASE_URL: "https://hcp.test" };
export const PER_USER_HEADERS = { "x-housecallpro-api-key": "test-key" };

export const EXPECTED_TOOLS = [
  "find_customers",
  "list_jobs",
  "get_job",
  "get_schedule_summary",
  "list_estimates",
  "list_employees",
  "create_customer",
  "add_job_note",
];

export const HTTP_PROBE = { tool: "get_schedule_summary", args: { from: "2026-11-24" }, expect: /Carlos Diaz/ };
export const CONFIRM_CALLS: Array<{ tool: string; args: Record<string, unknown> }> = [];

export interface FakeState {
  customers: Customer[];
  jobs: Job[];
  estimates: Estimate[];
  employees: Person[];
  notes: Array<{ job: string; content: string }>;
  calls: string[];
}

export function seed(): FakeState {
  const carlos: Person = { id: "pro_1", first_name: "Carlos", last_name: "Diaz", role: "field tech" };
  const amy: Person = { id: "pro_2", first_name: "Amy", last_name: "Chen", role: "field tech" };
  const smith: Customer = { id: "cus_1", first_name: "Robert", last_name: "Smith", email: "rsmith@example.test", mobile_number: "555-0110", addresses: [{ street: "12 Oak St", city: "Austin", state: "TX", zip: "78701" }] };
  const jones: Customer = { id: "cus_2", first_name: "Linda", last_name: "Jones", email: "linda@example.test", mobile_number: "555-0111", addresses: [{ street: "4 Elm Ave", city: "Austin" }] };
  const job = (id: string, c: Customer, status: Job["work_status"], start: string | null, techs: Person[], total: number, balance: number, description: string): Job => ({
    id, invoice_number: id.replace("job_", "10"), description, customer: c, address: c.addresses?.[0], work_status: status,
    schedule: { scheduled_start: start, scheduled_end: start ? start.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 2).padStart(2, "0")}`) : null },
    total_amount: total, outstanding_balance: balance, assigned_employees: techs, notes: [],
  });
  return {
    employees: [carlos, amy, { id: "pro_3", first_name: "Dana", last_name: "Office", role: "office staff" }],
    customers: [smith, jones, { id: "cus_3", first_name: "Robert", last_name: "Smithers", email: "bob@example.test" }],
    jobs: [
      job("job_1", smith, "scheduled", "2026-11-24T14:00:00Z", [carlos], 25000, 25000, "Water heater replacement"),
      job("job_2", jones, "scheduled", "2026-11-24T16:00:00Z", [amy], 12000, 0, "AC tune-up"),
      job("job_3", jones, "scheduled", "2026-11-24T18:00:00Z", [], 8000, 8000, "Leaking faucet"),
      job("job_4", smith, "unscheduled", null, [], 45000, 45000, "Bathroom remodel quote follow-up"),
      job("job_5", smith, "complete rated", "2026-11-10T14:00:00Z", [carlos], 15000, 15000, "Drain cleaning"),
    ],
    estimates: [
      { id: "est_1", estimate_number: "E-201", customer: smith, options: [{ name: "Tankless", total_amount: 320000, approval_status: null }, { name: "Tank 50 gal", total_amount: 180000, approval_status: null }] },
      { id: "est_2", estimate_number: "E-202", customer: jones, options: [{ name: "Standard", total_amount: 50000, approval_status: "approved" }] },
    ],
    notes: [],
    calls: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const page = <T>(key: string, items: T[]) => ({ [key]: items, page: 1, page_size: items.length, total_pages: 1, total_items: items.length });

export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}${url.search}`);
    if (new Headers(init?.headers).get("Authorization") !== "Token test-key") return json(401, { error: "Unauthorized" });
    const q = url.searchParams;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let m: RegExpMatchArray | null;

    if (url.pathname === "/customers" && method === "GET") {
      const term = (q.get("q") ?? "").toLowerCase();
      const list = state.customers.filter((c) => [c.first_name, c.last_name, `${c.first_name} ${c.last_name}`, c.email ?? "", c.mobile_number ?? "", c.addresses?.[0]?.street ?? ""].some((v) => v.toLowerCase().includes(term)));
      return json(200, page("customers", list.slice(0, Number(q.get("page_size") ?? 25))));
    }
    if (url.pathname === "/customers" && method === "POST") {
      if (!body.first_name) return json(422, { error: "first_name is required" });
      const created: Customer = { id: `cus_${state.customers.length + 1}`, ...body };
      state.customers.push(created);
      return json(201, created);
    }
    if (url.pathname === "/jobs") {
      const statuses = q.getAll("work_status[]");
      const list = state.jobs
        .filter((j) => !statuses.length || statuses.includes(j.work_status))
        .filter((j) => !q.get("customer_id") || j.customer.id === q.get("customer_id"))
        .filter((j) => !q.get("scheduled_start_min") || (j.schedule?.scheduled_start ?? "") >= q.get("scheduled_start_min")!)
        .filter((j) => !q.get("scheduled_start_max") || (j.schedule?.scheduled_start ?? "9999") <= q.get("scheduled_start_max")!);
      return json(200, page("jobs", list));
    }
    if ((m = url.pathname.match(/^\/jobs\/(\w+)(\/notes)?$/))) {
      const found = state.jobs.find((j) => j.id === m![1]);
      if (!found) return json(404, { error: "Job not found" });
      if (m[2] && method === "POST") {
        found.notes!.push({ id: `note_${state.notes.length + 1}`, content: body.content });
        state.notes.push({ job: found.id, content: body.content });
        return json(201, { id: `note_${state.notes.length}`, content: body.content });
      }
      return json(200, found);
    }
    if (url.pathname === "/estimates") return json(200, page("estimates", state.estimates.filter((e) => !q.get("customer_id") || e.customer.id === q.get("customer_id"))));
    if (url.pathname === "/employees") return json(200, page("employees", state.employees));
    return json(404, { error: "Unknown endpoint" });
  };
}
