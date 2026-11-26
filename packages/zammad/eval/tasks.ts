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
  { id: "queue", prompt: "How is the support queue doing? What needs attention first?", tool: "get_queue_summary", args: {}, expect: "\"unassigned\":1" },
  { id: "find", prompt: "Search tickets about VAT on invoices.", tool: "search_tickets", args: { text: "VAT" }, expect: "31001" },
  { id: "customer-tickets", prompt: "Which open tickets do we have from sam@globex.test?", tool: "search_tickets", args: { text: "sam@globex.test" }, expect: "Cannot log in" },
  { id: "read", prompt: "Read ticket 31002 and tell me what the customer wrote.", tool: "get_ticket", args: { ticket: "31002" }, expect: "error 500" },
  { id: "who", prompt: "Find the customer Jane Doe: email and organization?", tool: "find_customers", args: { query: "Jane" }, expect: "jane@acme.test" },
  { id: "new", prompt: "Create a ticket for ops@initech.test: printer offline, in the Support group, they phoned us.", tool: "create_ticket", args: { title: "Printer offline", customer_email: "ops@initech.test", group: "Support", message: "Customer phoned: printer offline." }, expect: "\"state\":\"new\"" },
  { id: "note", prompt: "Add an internal note to ticket 31001: fixed the tax rule, waiting for finance to reissue.", tool: "add_internal_note", args: { ticket: "31001", note: "Fixed the tax rule, waiting for finance to reissue." }, expect: "\"done\":true" },
  { id: "reply", prompt: "Reply to the customer on 31001 that the corrected invoice is on its way.", tool: "reply_to_customer", args: { ticket: "31001", message: "The corrected invoice is on its way." }, expect: "jane@acme.test" },
  { id: "close", prompt: "Close ticket 31003.", tool: "update_ticket", args: { ticket: "31003", state: "closed" }, expect: "\"state\":\"closed\"" },
  { id: "assign", prompt: "Assign ticket 31001 to tom@helpdesk.test and raise its priority to high.", tool: "update_ticket", args: { ticket: "31001", owner_email: "tom@helpdesk.test", priority: "3 high" }, expect: "\"owner\":\"Tom Agent\"" },
];
