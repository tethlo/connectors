// In-memory imitation of the Deputy API v1 (Resource API QUERY, supervise/roster), for the tests and the agent evaluation.
// Shapes follow the public docs (developer.deputy.com); the QUERY search supports eq, ge, le and lt.
import type { Area, Employee, Leave, Location, Shift, Timesheet } from "../src/api.ts";

export const NOW = "2026-11-24T08:00:00Z";
export const TEST_ENV = { DEPUTY_HOST: "demo.na.deputy.test", DEPUTY_ACCESS_TOKEN: "test-token", DEPUTY_BASE_URL: "https://deputy.test/api/v1" };
export const PER_USER_HEADERS = { "x-deputy-access-token": "test-token" };

export const EXPECTED_TOOLS = [
  "list_employees",
  "list_areas",
  "get_roster",
  "find_open_shifts",
  "list_leave_requests",
  "get_hours_summary",
  "create_shift",
  "decide_leave_request",
];

export const HTTP_PROBE = { tool: "get_roster", args: { from: "2026-11-28", to: "2026-11-28" }, expect: /Maya Patel/ };
export const CONFIRM_CALLS = [
  { tool: "create_shift", args: { area: "Kitchen", date: "2026-11-29", start: "16:00", end: "22:00", employee: "Leo" } },
  { tool: "decide_leave_request", args: { leave_id: 71, decision: "approve" } },
];

export interface FakeState {
  employees: Employee[];
  areas: Area[];
  locations: Location[];
  shifts: Shift[];
  leaves: Leave[];
  timesheets: Timesheet[];
  calls: string[];
}

const t = (iso: string) => Date.parse(iso) / 1000;

export function seed(): FakeState {
  const shift = (Id: number, Employee: number, OperationalUnit: number, start: string, end: string): Shift => ({ Id, Employee, OperationalUnit, StartTime: t(start), EndTime: t(end), TotalTime: (t(end) - t(start)) / 3600, Published: true, Open: Employee === 0 });
  const sheet = (Id: number, Employee: number, Date: string, hours: number, approved: boolean, inProgress = false): Timesheet => ({ Id, Employee, Date, StartTime: t(`${Date}T09:00:00Z`), EndTime: t(`${Date}T09:00:00Z`) + hours * 3600, TotalTime: hours, Cost: hours * 20, OperationalUnit: 11, TimeApproved: approved, IsInProgress: inProgress });
  return {
    employees: [
      { Id: 1, DisplayName: "Maya Patel", Active: true },
      { Id: 2, DisplayName: "Leo Martin", Active: true },
      { Id: 3, DisplayName: "Sara Kim", Active: true },
    ],
    locations: [{ Id: 100, CompanyName: "Downtown Café", Active: true }],
    areas: [
      { Id: 11, OperationalUnitName: "Kitchen", Company: 100, Active: true },
      { Id: 12, OperationalUnitName: "Front of house", Company: 100, Active: true },
    ],
    shifts: [
      shift(501, 1, 12, "2026-11-28T08:00:00Z", "2026-11-28T16:00:00Z"),
      shift(502, 2, 11, "2026-11-28T10:00:00Z", "2026-11-28T18:00:00Z"),
      shift(503, 0, 11, "2026-11-29T16:00:00Z", "2026-11-29T22:00:00Z"),
      shift(504, 3, 12, "2026-12-05T08:00:00Z", "2026-12-05T14:00:00Z"),
    ],
    leaves: [
      { Id: 71, Employee: 3, Status: 0, DateStart: "2026-12-01T00:00:00", DateEnd: "2026-12-03T00:00:00", Days: 3, TotalHours: 24, Comment: "Family trip" },
      { Id: 72, Employee: 1, Status: 1, DateStart: "2026-12-20T00:00:00", DateEnd: "2026-12-24T00:00:00", Days: 5, TotalHours: 40 },
    ],
    timesheets: [sheet(901, 1, "2026-11-20", 8, true), sheet(902, 2, "2026-11-21", 6.5, false), sheet(903, 1, "2026-11-22", 7.5, true), sheet(904, 3, "2026-11-24", 3, false, true)],
    calls: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function matches(record: Record<string, unknown>, search: Record<string, { field: string; type: string; data: unknown }>): boolean {
  return Object.values(search ?? {}).every(({ field, type, data }) => {
    const value = record[field] as number | string | boolean;
    if (type === "eq") return value === data;
    if (type === "ge") return value >= (data as number | string);
    if (type === "le") return value <= (data as number | string);
    if (type === "lt") return value < (data as number | string);
    return true;
  });
}

export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}`);
    if (new Headers(init?.headers).get("Authorization") !== "Bearer test-token") return json(401, { error: { code: 401, message: "Invalid access token" } });
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const tables: Record<string, Array<Record<string, unknown>>> = {
      Employee: state.employees as never,
      Roster: state.shifts as never,
      Leave: state.leaves as never,
      Timesheet: state.timesheets as never,
    };
    let m: RegExpMatchArray | null;

    if ((m = path.match(/^\/resource\/(\w+)\/QUERY$/)) && method === "POST") {
      const table = tables[m[1]];
      if (!table) return json(404, { error: { message: "Unknown resource" } });
      return json(200, table.filter((r) => matches(r, body.search)).slice(0, body.max ?? 500));
    }
    if (path === "/resource/OperationalUnit") return json(200, state.areas);
    if (path === "/resource/Company") return json(200, state.locations);
    if ((m = path.match(/^\/resource\/Leave\/(\d+)$/))) {
      const leave = state.leaves.find((l) => l.Id === Number(m![1]));
      if (!leave) return json(404, { error: { message: "Record not found" } });
      if (method === "POST") Object.assign(leave, body);
      return json(200, leave);
    }
    if (path === "/supervise/roster" && method === "POST") {
      if (!state.areas.some((a) => a.Id === body.intOpunitId)) return json(400, { error: { message: "Invalid area" } });
      const created: Shift = { Id: 600 + state.shifts.length, Employee: body.intRosterEmployee, OperationalUnit: body.intOpunitId, StartTime: body.intStartTimestamp, EndTime: body.intEndTimestamp, TotalTime: (body.intEndTimestamp - body.intStartTimestamp) / 3600 - body.intMealbreakMinute / 60, Published: body.blnPublish };
      state.shifts.push(created);
      return json(200, created);
    }
    return json(404, { error: { message: "Unknown endpoint" } });
  };
}
