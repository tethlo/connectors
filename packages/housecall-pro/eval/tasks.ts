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
  { id: "today", prompt: "What does today's dispatch look like per technician? Anything not assigned?", tool: "get_schedule_summary", args: {}, expect: "Leaking faucet" },
  { id: "revenue", prompt: "How much revenue is booked on the schedule for today?", tool: "get_schedule_summary", args: {}, expect: "\"booked_revenue\":450" },
  { id: "customer", prompt: "Find the customer Linda Jones and her phone number.", tool: "find_customers", args: { query: "Linda Jones" }, expect: "555-0111" },
  { id: "customer-jobs", prompt: "Which open jobs do we have for Robert Smith?", tool: "list_jobs", args: { customer: "rsmith@example.test" }, expect: "Water heater replacement" },
  { id: "unscheduled", prompt: "List the unscheduled jobs that still need a date.", tool: "list_jobs", args: { status: "unscheduled" }, expect: "Bathroom remodel" },
  { id: "job", prompt: "Give me the details and balance due of job job_1.", tool: "get_job", args: { job_id: "job_1" }, expect: "\"balance\":250" },
  { id: "quotes", prompt: "Which estimates are still waiting for customer approval?", tool: "list_estimates", args: { pending_only: true }, expect: "E-201" },
  { id: "techs", prompt: "Who are our technicians and staff?", tool: "list_employees", args: {}, expect: "Amy Chen" },
  { id: "new-customer", prompt: "Create a customer: Mike Brown, mike@example.test, 77 Pine Rd, Austin.", tool: "create_customer", args: { first_name: "Mike", last_name: "Brown", email: "mike@example.test", street: "77 Pine Rd", city: "Austin" }, expect: "\"action\":\"created\"" },
  { id: "note", prompt: "Add a note to job job_3 for the tech: gate code is 4512.", tool: "add_job_note", args: { job_id: "job_3", note: "Gate code is 4512." }, expect: "\"done\":true" },
];
