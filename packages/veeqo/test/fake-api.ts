// In-memory imitation of the Veeqo public API, for the tests and the agent evaluation.
// Shapes follow the public docs (developers.veeqo.com); filters are simplified.
import type { Customer, Order, Product, Warehouse } from "../src/api.ts";

export const NOW = "2026-11-24T09:00:00Z";
export const TEST_ENV = { VEEQO_API_KEY: "test-key", VEEQO_BASE_URL: "https://veeqo.test" };
export const PER_USER_HEADERS = { "x-veeqo-api-key": "test-key" };

export const EXPECTED_TOOLS = [
  "list_orders",
  "get_order",
  "find_products",
  "get_low_stock",
  "list_warehouses",
  "find_customers",
  "set_stock_level",
  "add_order_note",
];

export const HTTP_PROBE = { tool: "list_orders", args: {}, expect: /Emma Wilson/ };
export const CONFIRM_CALLS = [{ tool: "set_stock_level", args: { sku: "MUG-BLU", warehouse: "Main", on_hand: 40 } }];

export interface FakeState {
  orders: Order[];
  products: Product[];
  warehouses: Warehouse[];
  customers: Customer[];
  calls: string[];
}

export function seed(): FakeState {
  const order = (id: number, number: string, status: string, created: string, name: string, city: string, channel: string, total: number, lines: Array<[string, string, number]>): Order => ({
    id, number, status, created_at: `${created}T10:00:00Z`, total_price: total.toFixed(2), currency_code: "GBP", channel: { name: channel },
    customer: { email: `${name.split(" ")[0].toLowerCase()}@example.test`, full_name: name }, deliver_to: { city, country: "GB" },
    line_items: lines.map(([sku_code, product_title, quantity]) => ({ quantity, sellable: { sku_code, product_title } })), employee_notes: [],
  });
  return {
    warehouses: [{ id: 1, name: "Main warehouse" }, { id: 2, name: "Shop floor" }],
    products: [
      { id: 10, title: "Ceramic mug", sellables: [
        { id: 101, sku_code: "MUG-BLU", title: "Blue", price: "12.00", stock_entries: [{ warehouse_id: 1, physical_stock_level: 30, allocated_stock_level: 2, available_stock_level: 28 }, { warehouse_id: 2, physical_stock_level: 4, allocated_stock_level: 0, available_stock_level: 4 }] },
        { id: 102, sku_code: "MUG-RED", title: "Red", price: "12.00", stock_entries: [{ warehouse_id: 1, physical_stock_level: 3, allocated_stock_level: 1, available_stock_level: 2 }] },
      ] },
      { id: 11, title: "Linen tea towel", sellables: [{ id: 111, sku_code: "TOWEL-NAT", title: "Linen tea towel", price: "9.50", stock_entries: [{ warehouse_id: 1, physical_stock_level: 0, allocated_stock_level: 0, available_stock_level: 0 }] }] },
    ],
    orders: [
      order(5001, "#1042", "awaiting_fulfillment", "2026-11-23", "Emma Wilson", "Leeds", "Shopify", 24, [["MUG-BLU", "Ceramic mug", 2]]),
      order(5002, "AMZ-202-77", "awaiting_fulfillment", "2026-11-24", "Raj Patel", "Bristol", "Amazon", 21.5, [["MUG-RED", "Ceramic mug", 1], ["TOWEL-NAT", "Linen tea towel", 1]]),
      order(5003, "#1039", "shipped", "2026-11-20", "Emma Wilson", "Leeds", "Shopify", 9.5, [["TOWEL-NAT", "Linen tea towel", 1]]),
    ],
    customers: [
      { id: 71, email: "emma@example.test", full_name: "Emma Wilson", phone: "07700 900111" },
      { id: 72, email: "raj@example.test", full_name: "Raj Patel" },
    ],
    calls: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}${url.search}`);
    if (new Headers(init?.headers).get("x-api-key") !== "test-key") return json(401, { error_messages: "Unauthorized" });
    const q = url.searchParams;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let m: RegExpMatchArray | null;

    if (url.pathname === "/orders") {
      const term = (q.get("query") ?? "").toLowerCase();
      return json(200, state.orders
        .filter((o) => !q.get("status") || o.status === q.get("status"))
        .filter((o) => !q.get("created_at_min") || o.created_at >= q.get("created_at_min")!.replace(" ", "T"))
        .filter((o) => !term || o.number.toLowerCase().includes(term) || (o.customer?.full_name ?? "").toLowerCase().includes(term)));
    }
    if ((m = url.pathname.match(/^\/orders\/(\d+)$/))) {
      const found = state.orders.find((o) => o.id === Number(m![1]));
      if (!found) return json(404, { error_messages: "Not found" });
      if (method === "PUT") for (const note of body.order.employee_notes_attributes ?? []) found.employee_notes!.push({ text: note.text });
      return json(200, found);
    }
    if (url.pathname === "/products") {
      const term = (q.get("query") ?? "").toLowerCase();
      return json(200, state.products.filter((p) => !term || p.title.toLowerCase().includes(term) || p.sellables.some((s) => s.sku_code.toLowerCase().includes(term))));
    }
    if (url.pathname === "/warehouses") return json(200, state.warehouses);
    if ((m = url.pathname.match(/^\/sellables\/(\d+)\/warehouses\/(\d+)\/stock_entry$/)) && method === "PUT") {
      const sellable = state.products.flatMap((p) => p.sellables).find((s) => s.id === Number(m![1]));
      if (!sellable) return json(404, { error_messages: "Not found" });
      let entry = sellable.stock_entries!.find((e) => e.warehouse_id === Number(m![2]));
      if (!entry) sellable.stock_entries!.push((entry = { warehouse_id: Number(m[2]), physical_stock_level: 0 }));
      entry.physical_stock_level = body.stock_entry.physical_stock_level;
      entry.available_stock_level = entry.physical_stock_level - (entry.allocated_stock_level ?? 0);
      return json(200, entry);
    }
    if (url.pathname === "/customers") {
      const term = (q.get("query") ?? "").toLowerCase();
      return json(200, state.customers.filter((c) => [c.email, c.full_name ?? ""].some((v) => v.toLowerCase().includes(term))));
    }
    return json(404, { error_messages: "Unknown endpoint" });
  };
}
