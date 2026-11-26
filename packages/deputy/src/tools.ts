import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Area, DeputyApi, Employee, Leave, Shift } from "./api.ts";
import { confirmFirst, DATE, defineTool, money, pickOne, type ToolContext, ToolError } from "./core.ts";

export interface ToolOptions {
  writes: boolean;
  now: () => Date;
}

/** Leave status codes of the Deputy Resource API. */
const LEAVE_STATUS: Record<number, string> = { 0: "awaiting_approval", 1: "approved", 2: "declined", 3: "cancelled" };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));
const unix = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
const time = (ts: number) => new Date(ts * 1000).toISOString().replace(":00.000Z", "Z");

interface Directory {
  employees: Employee[];
  areas: Area[];
}

async function directory(api: DeputyApi): Promise<Directory> {
  const [employees, areas] = await Promise.all([api.employees(), api.areas()]);
  return { employees, areas: areas.filter((a) => a.Active !== false) };
}

const nameOf = (dir: Directory, id: number) => (id === 0 ? "(open shift)" : (dir.employees.find((e) => e.Id === id)?.DisplayName ?? `#${id}`));
const areaOf = (dir: Directory, id: number) => dir.areas.find((a) => a.Id === id)?.OperationalUnitName ?? `#${id}`;

function shiftSummary(s: Shift, dir: Directory) {
  return {
    id: s.Id,
    employee: nameOf(dir, s.Employee),
    area: areaOf(dir, s.OperationalUnit),
    start: time(s.StartTime),
    end: time(s.EndTime),
    hours: s.TotalTime ?? money((s.EndTime - s.StartTime) / 3600),
    published: s.Published ?? undefined,
  };
}

function leaveSummary(l: Leave, dir: Directory) {
  return { id: l.Id, employee: nameOf(dir, l.Employee), status: LEAVE_STATUS[l.Status] ?? String(l.Status), from: l.DateStart.slice(0, 10), to: l.DateEnd.slice(0, 10), days: l.Days, hours: l.TotalHours, comment: l.Comment || undefined };
}

function findEmployee(dir: Directory, ref: string): Employee {
  const wanted = ref.trim().toLowerCase();
  const exact = dir.employees.filter((e) => String(e.Id) === wanted || e.DisplayName.toLowerCase() === wanted);
  return pickOne(ref, exact.length ? exact : dir.employees.filter((e) => e.DisplayName.toLowerCase().includes(wanted)), (e) => `"${e.DisplayName}" (${e.Id})`, "employee", "Call list_employees to see the names.");
}

function findArea(dir: Directory, ref: string): Area {
  const wanted = ref.trim().toLowerCase();
  const exact = dir.areas.filter((a) => String(a.Id) === wanted || a.OperationalUnitName.toLowerCase() === wanted);
  return pickOne(ref, exact.length ? exact : dir.areas.filter((a) => a.OperationalUnitName.toLowerCase().includes(wanted)), (a) => `"${a.OperationalUnitName}" (${a.Id})`, "area", "Call list_areas to see the areas.");
}

export function registerTools(server: McpServer, api: DeputyApi, options: ToolOptions): void {
  const ctx: ToolContext = { server, writes: options.writes, service: "Deputy" };
  const today = () => iso(options.now());

  defineTool(
    ctx,
    "list_employees",
    {
      title: "List employees",
      description:
        "Active staff members (employees) with their id, optionally filtered by part of their name. Use it to get the exact " +
        "person before looking at their shifts, leave or hours.",
      input: { name: z.string().optional() },
      kind: "read",
    },
    async ({ name }) => {
      const list = (await api.employees()).filter((e) => !name || e.DisplayName.toLowerCase().includes(name.toLowerCase()));
      return { count: list.length, employees: list.slice(0, 100).map((e) => ({ id: e.Id, name: e.DisplayName })) };
    },
  );

  defineTool(
    ctx,
    "list_areas",
    {
      title: "List areas and locations",
      description:
        "The workplaces: locations (sites, stores) and their areas (work positions such as 'Kitchen' or 'Front desk') that " +
        "shifts are scheduled in. Use it to get exact area names before creating shifts.",
      input: {},
      kind: "read",
    },
    async () => {
      const [areas, locations] = await Promise.all([api.areas(), api.locations()]);
      return {
        locations: locations.filter((l) => l.Active !== false).map((l) => ({
          id: l.Id,
          name: l.CompanyName,
          areas: areas.filter((a) => a.Company === l.Id && a.Active !== false).map((a) => ({ id: a.Id, name: a.OperationalUnitName })),
        })),
      };
    },
  );

  defineTool(
    ctx,
    "get_roster",
    {
      title: "Get the roster",
      description:
        "The schedule (roster): shifts between two dates (default: today and the next 7 days) with employee, area, start, " +
        "end and hours, optionally for one employee or one area. Use it for 'who works on Saturday?'.",
      input: {
        from: z.string().regex(DATE).optional(),
        to: z.string().regex(DATE).optional().describe("Last day included."),
        employee: z.string().optional().describe("Employee name or id."),
        area: z.string().optional().describe("Area name or id."),
      },
      kind: "read",
    },
    async (args) => {
      const dir = await directory(api);
      const from = args.from ?? today();
      const to = args.to ?? addDays(from, 6);
      const extra = [];
      if (args.employee) extra.push({ field: "Employee", type: "eq" as const, data: findEmployee(dir, args.employee).Id });
      if (args.area) extra.push({ field: "OperationalUnit", type: "eq" as const, data: findArea(dir, args.area).Id });
      const shifts = await api.shifts(unix(from), unix(addDays(to, 1)), extra);
      return { from, to, count: shifts.length, total_hours: money(shifts.reduce((s, x) => s + (x.TotalTime ?? (x.EndTime - x.StartTime) / 3600), 0)), shifts: shifts.map((s) => shiftSummary(s, dir)) };
    },
  );

  defineTool(
    ctx,
    "find_open_shifts",
    {
      title: "Find open shifts",
      description:
        "Unfilled shifts (open shifts with nobody assigned) between two dates, default the next 14 days, so you can find who " +
        "could cover them. Also lists who is not rostered at all on those days.",
      input: { from: z.string().regex(DATE).optional(), to: z.string().regex(DATE).optional() },
      kind: "read",
    },
    async (args) => {
      const dir = await directory(api);
      const from = args.from ?? today();
      const to = args.to ?? addDays(from, 13);
      const shifts = await api.shifts(unix(from), unix(addDays(to, 1)));
      const open = shifts.filter((s) => s.Employee === 0 || s.Open);
      const days = [...new Set(open.map((s) => time(s.StartTime).slice(0, 10)))];
      return {
        from,
        to,
        open_shifts: open.map((s) => shiftSummary(s, dir)),
        free_staff_by_day: days.map((day) => ({
          day,
          not_rostered: dir.employees.filter((e) => !shifts.some((s) => s.Employee === e.Id && time(s.StartTime).startsWith(day))).map((e) => e.DisplayName),
        })),
      };
    },
  );

  defineTool(
    ctx,
    "list_leave_requests",
    {
      title: "List leave requests",
      description:
        "Leave (time off, holiday, sick leave) requests filtered by status (pending by default), employee or date, with " +
        "dates, days and comment. Use it for 'what time off is waiting?' or 'who is off next week?'.",
      input: {
        status: z.enum(["awaiting_approval", "approved", "declined", "all"]).default("awaiting_approval"),
        employee: z.string().optional(),
        from: z.string().regex(DATE).optional().describe("Only leave ending on or after this day."),
      },
      kind: "read",
    },
    async (args) => {
      const dir = await directory(api);
      const conditions = [];
      if (args.status !== "all") conditions.push({ field: "Status", type: "eq" as const, data: Number(Object.entries(LEAVE_STATUS).find(([, v]) => v === args.status)![0]) });
      if (args.employee) conditions.push({ field: "Employee", type: "eq" as const, data: findEmployee(dir, args.employee).Id });
      if (args.from) conditions.push({ field: "DateEnd", type: "ge" as const, data: args.from });
      const leaves = await api.leaves(conditions);
      return { count: leaves.length, leave: leaves.map((l) => leaveSummary(l, dir)) };
    },
  );

  defineTool(
    ctx,
    "get_hours_summary",
    {
      title: "Get the hours summary",
      description:
        "Worked hours from timesheets between two dates (default: the last 7 days): hours and cost per employee, totals, and " +
        "timesheets still in progress or not yet approved. Use it before payroll or to compare with the roster.",
      input: { from: z.string().regex(DATE).optional(), to: z.string().regex(DATE).optional(), employee: z.string().optional() },
      kind: "read",
    },
    async (args) => {
      const dir = await directory(api);
      const to = args.to ?? today();
      const from = args.from ?? addDays(to, -6);
      const extra = args.employee ? [{ field: "Employee", type: "eq" as const, data: findEmployee(dir, args.employee).Id }] : [];
      const sheets = await api.timesheets(from, to, extra);
      const per = new Map<string, { hours: number; cost: number; timesheets: number }>();
      for (const t of sheets) {
        const name = nameOf(dir, t.Employee);
        const row = per.get(name) ?? { hours: 0, cost: 0, timesheets: 0 };
        row.hours = money(row.hours + t.TotalTime);
        row.cost = money(row.cost + (t.Cost ?? 0));
        row.timesheets += 1;
        per.set(name, row);
      }
      return {
        from,
        to,
        total_hours: money(sheets.reduce((s, t) => s + t.TotalTime, 0)),
        total_cost: money(sheets.reduce((s, t) => s + (t.Cost ?? 0), 0)),
        by_employee: [...per].sort((a, b) => b[1].hours - a[1].hours).map(([employee, v]) => ({ employee, ...v })),
        not_approved: sheets.filter((t) => !t.TimeApproved && !t.IsInProgress).length,
        in_progress: sheets.filter((t) => t.IsInProgress).map((t) => nameOf(dir, t.Employee)),
      };
    },
  );

  defineTool(
    ctx,
    "create_shift",
    {
      title: "Create a shift",
      description:
        "Add a shift to the roster for an employee (or an open shift with no employee) in an area, from start to end time " +
        "(UTC), optionally published, which notifies the employee. Call with confirm=false first, show the preview, then confirm=true.",
      input: {
        area: z.string().describe("Area name or id."),
        date: z.string().regex(DATE),
        start: z.string().regex(/^\d{2}:\d{2}$/).describe("HH:MM, UTC."),
        end: z.string().regex(/^\d{2}:\d{2}$/).describe("HH:MM, UTC; earlier than start means the next day."),
        employee: z.string().optional().describe("Employee name or id; omit for an open shift."),
        break_minutes: z.number().int().min(0).max(240).default(0),
        publish: z.boolean().default(false).describe("Publish now (the employee is notified)."),
        confirm: z.boolean().default(false),
      },
      kind: "send",
    },
    async (args) => {
      const dir = await directory(api);
      const area = findArea(dir, args.area);
      const employee = args.employee ? findEmployee(dir, args.employee) : undefined;
      const start = Date.parse(`${args.date}T${args.start}:00Z`) / 1000;
      let end = Date.parse(`${args.date}T${args.end}:00Z`) / 1000;
      if (end <= start) end += 86_400;
      if (end - start > 16 * 3600) throw new ToolError("A shift longer than 16 hours looks like a mistake: check start and end.");
      const who = employee?.DisplayName ?? "an open shift";
      if (!args.confirm) {
        return confirmFirst(`Add ${who} in ${area.OperationalUnitName} on ${args.date} ${args.start}-${args.end} UTC${args.publish ? ", published (the employee is notified)" : " as an unpublished draft"}.`);
      }
      const shift = await api.createShift({ intStartTimestamp: start, intEndTimestamp: end, intRosterEmployee: employee?.Id ?? 0, intOpunitId: area.Id, blnPublish: args.publish, intMealbreakMinute: args.break_minutes });
      return { done: true, shift: shiftSummary(shift, dir) };
    },
  );

  defineTool(
    ctx,
    "decide_leave_request",
    {
      title: "Approve or decline leave",
      description:
        "Approve or decline a leave (time off) request awaiting approval; the employee is notified by Deputy. Call with " +
        "confirm=false first, show the preview, then call again with confirm=true.",
      input: {
        leave_id: z.number().int().positive(),
        decision: z.enum(["approve", "decline"]),
        confirm: z.boolean().default(false),
      },
      kind: "send",
    },
    async (args) => {
      const [leave, dir] = await Promise.all([api.getLeave(args.leave_id), directory(api)]);
      const summary = leaveSummary(leave, dir);
      if (leave.Status !== 0) throw new ToolError(`Leave ${leave.Id} is already ${summary.status}.`);
      if (!args.confirm) return confirmFirst(`${args.decision === "approve" ? "Approve" : "Decline"} ${summary.employee}'s leave from ${summary.from} to ${summary.to}.`);
      const updated = await api.updateLeave(leave.Id, { Status: args.decision === "approve" ? 1 : 2 });
      return { done: true, leave: leaveSummary(updated, dir) };
    },
  );
}
