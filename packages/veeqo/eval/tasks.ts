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
  { id: "queue", prompt: "How many orders are waiting to be packed and shipped, per sales channel?", tool: "list_orders", args: {}, expect: "\"Amazon\":1" },
  { id: "shipped", prompt: "Which orders were shipped since November 15?", tool: "list_orders", args: { status: "shipped", since: "2026-11-15" }, expect: "#1039" },
  { id: "wismo", prompt: "A buyer asks where order #1042 is. What's its status and what's in it?", tool: "get_order", args: { order: "#1042" }, expect: "MUG-BLU" },
  { id: "stock", prompt: "How many blue mugs do we have in stock, per warehouse?", tool: "find_products", args: { query: "mug" }, expect: "\"on_hand\":34" },
  { id: "reorder", prompt: "What is low on stock and needs reordering?", tool: "get_low_stock", args: {}, expect: "TOWEL-NAT" },
  { id: "warehouses", prompt: "List our warehouses.", tool: "list_warehouses", args: {}, expect: "Shop floor" },
  { id: "buyer", prompt: "Find the buyer Emma Wilson's email and phone.", tool: "find_customers", args: { query: "Emma" }, expect: "07700 900111" },
  { id: "stock-take", prompt: "After the stock take, set MUG-RED to 15 on hand in the main warehouse.", tool: "set_stock_level", args: { sku: "MUG-RED", warehouse: "Main", on_hand: 15, confirm: true }, expect: "\"on_hand\":15" },
  { id: "preview", prompt: "Set the stock level of TOWEL-NAT to 20 in the Main warehouse.", tool: "set_stock_level", args: { sku: "TOWEL-NAT", warehouse: "Main", on_hand: 20 }, expect: "from 0 to 20" },
  { id: "note", prompt: "Add a note on order 5002: customer asked to hold it until Monday.", tool: "add_order_note", args: { order: 5002, note: "Customer asked to hold until Monday." }, expect: "AMZ-202-77" },
];
