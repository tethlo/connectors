// Agent evaluation: 10 realistic requests, the tool an agent should call first, and arguments that solve the task.
// `expect` is a fragment that must appear in the tool result when called with `args` on the fake API.

export interface EvalTask {
  id: string;
  prompt: string;
  tool: string;
  args: Record<string, unknown>;
  expect: string;
}

export const TASKS: EvalTask[] = [
  {
    id: "money-owed",
    prompt: "How much money are customers owing us in total, and how much of it is late?",
    tool: "get_receivables_summary",
    args: {},
    expect: "\"total_overdue\":3700",
  },
  {
    id: "chase-first",
    prompt: "Cash is tight this month. Who should I chase first?",
    tool: "get_receivables_summary",
    args: {},
    expect: "top_debtors",
  },
  {
    id: "client-unpaid",
    prompt: "Which invoices has Acme Corp not paid yet?",
    tool: "list_invoices",
    args: { client: "Acme Corp", status: "unpaid" },
    expect: "\"total_balance\":4200",
  },
  {
    id: "invoice-detail",
    prompt: "What exactly did we bill on invoice 0042?",
    tool: "get_invoice",
    args: { invoice: "0042" },
    expect: "Support hours",
  },
  {
    id: "lookup-customer",
    prompt: "Do we already have Bluebird Studio as a customer? What's their contact email?",
    tool: "find_clients",
    args: { query: "Bluebird" },
    expect: "hello@bluebird.test",
  },
  {
    id: "new-customer",
    prompt: "Add a new customer: Globex, billing contact Hank Scorpio, ap@globex.test.",
    tool: "create_client",
    args: { name: "Globex", first_name: "Hank", last_name: "Scorpio", email: "ap@globex.test" },
    expect: "\"action\":\"created\"",
  },
  {
    id: "bill-work",
    prompt: "Bill Bluebird Studio 450 for the logo animation and 2 rounds of revisions at 75 each. Keep it as a draft.",
    tool: "create_invoice",
    args: {
      client: "Bluebird Studio",
      items: [
        { description: "Logo animation", unit_price: 450 },
        { description: "Revisions", quantity: 2, unit_price: 75 },
      ],
    },
    expect: "\"amount\":600",
  },
  {
    id: "remind",
    prompt: "Invoice 0041 is way overdue. Send Acme a polite reminder.",
    tool: "send_invoice",
    args: { invoice: "0041", template: "reminder1" },
    expect: "\"sent\":true",
  },
  {
    id: "got-paid",
    prompt: "Acme just wired 1,000 for invoice 0041, reference WIRE-881. Record it.",
    tool: "record_payment",
    args: { invoice: "0041", amount: 1000, reference: "WIRE-881" },
    expect: "\"remaining_balance\":1500",
  },
  {
    id: "overdue-list",
    prompt: "List every overdue invoice with how many days late it is.",
    tool: "list_invoices",
    args: { status: "overdue" },
    expect: "\"days_overdue\":102",
  },
];
