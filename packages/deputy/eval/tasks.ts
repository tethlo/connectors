// Agent evaluation: 10 realistic requests, the tool an agent should call first, and arguments that solve the task.
// `expect` must appear in the tool result when called with `args` on the fake API.
export interface EvalTask {
  id: string;
  prompt: string;
  tool: string;
  args: Record<string, unknown>;
  expect: string;
}

export const TASKS: EvalTask[] = [
  { id: "saturday", prompt: "Who works on Saturday November 28, and in which area?", tool: "get_roster", args: { from: "2026-11-28", to: "2026-11-28" }, expect: "Leo Martin" },
  { id: "my-week", prompt: "Show Sara Kim's shifts on the schedule for the next two weeks.", tool: "get_roster", args: { employee: "Sara", from: "2026-11-24", to: "2026-12-07" }, expect: "\"count\":1" },
  { id: "gaps", prompt: "Are there unfilled open shifts I need to cover?", tool: "find_open_shifts", args: {}, expect: "(open shift)" },
  { id: "pending-leave", prompt: "What time off requests are waiting for my approval?", tool: "list_leave_requests", args: {}, expect: "Family trip" },
  { id: "who-off", prompt: "Which approved leave do we have, who is off and when?", tool: "list_leave_requests", args: { status: "approved" }, expect: "2026-12-20" },
  { id: "payroll", prompt: "How many hours did each employee work last week, and what did it cost? Any timesheets not approved?", tool: "get_hours_summary", args: { from: "2026-11-18", to: "2026-11-24" }, expect: "\"total_hours\":25" },
  { id: "staff", prompt: "List our active employees.", tool: "list_employees", args: {}, expect: "\"count\":3" },
  { id: "areas", prompt: "Which locations and work areas do we have?", tool: "list_areas", args: {}, expect: "Front of house" },
  { id: "add-shift", prompt: "Put Leo on a Kitchen shift on November 30 from 10:00 to 18:00 UTC.", tool: "create_shift", args: { area: "Kitchen", date: "2026-11-30", start: "10:00", end: "18:00", employee: "Leo", confirm: true }, expect: "\"employee\":\"Leo Martin\"" },
  { id: "approve", prompt: "Approve leave request 71.", tool: "decide_leave_request", args: { leave_id: 71, decision: "approve", confirm: true }, expect: "\"status\":\"approved\"" },
];
