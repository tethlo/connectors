// In-memory imitation of the Invoice Ninja v5 API, used by the tests and the agent evaluation.
// Shapes follow the official OpenAPI file (openapi/api-docs.yaml); filters are simplified.
import type { Client, Invoice, LineItem, Payment } from "../src/api.ts";

export const BASE = "https://in.test";
export const TOKEN = "test-token";
export const TODAY = "2026-11-24";

const contact = (first: string, last: string, email: string) => ({ first_name: first, last_name: last, email, is_primary: true });
const line = (notes: string, cost: number, quantity = 1, product_key = ""): LineItem => ({ product_key, notes, cost, quantity, line_total: cost * quantity });

export interface FakeState {
  clients: Client[];
  invoices: Invoice[];
  payments: Payment[];
  calls: string[];
  bodies: unknown[];
  failNext?: number;
}

export function seed(): FakeState {
  const clients: Client[] = [
    { id: "c1Acme", name: "Acme Corp", balance: 4200, paid_to_date: 9800, contacts: [contact("Jane", "Doe", "jane@acme.test")] },
    { id: "c2Blue", name: "Bluebird Studio", balance: 1200, paid_to_date: 800, contacts: [contact("Sam", "Lee", "hello@bluebird.test")] },
    { id: "c3Labs", name: "Acme Labs", balance: 0, paid_to_date: 0, contacts: [contact("Ops", "", "ops@acmelabs.test")] },
    { id: "c4Nort", name: "Northwind Traders", balance: 0, paid_to_date: 300, contacts: [contact("", "", "")] },
  ];
  const invoice = (id: string, number: string, client_id: string, status_id: string, amount: number, balance: number, date: string, due_date: string, lines: LineItem[]): Invoice => ({
    id, number, client_id, status_id, amount, balance, paid_to_date: amount - balance, date, due_date, line_items: lines,
    invitations: [{ link: `https://in.test/client/invoice/${id}` }],
  });
  return {
    clients,
    invoices: [
      invoice("i41", "0041", "c1Acme", "2", 2500, 2500, "2026-09-01", "2026-10-01", [line("Website redesign, phase 1", 2500)]),
      invoice("i42", "0042", "c1Acme", "3", 2000, 1700, "2026-11-01", "2026-12-01", [line("Hosting (yearly)", 400), line("Support hours", 100, 16, "SUP")]),
      invoice("i43", "0043", "c2Blue", "2", 1200, 1200, "2026-07-15", "2026-08-14", [line("Logo design", 1200)]),
      invoice("i44", "0044", "c2Blue", "4", 800, 0, "2026-06-01", "2026-07-01", [line("Brand workshop", 800)]),
      invoice("i45", "0045", "c3Labs", "1", 600, 600, "2026-11-20", "2026-12-20", [line("Consulting day", 600)]),
    ],
    payments: [],
    calls: [],
    bodies: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function page<T>(items: T[], perPage: number, pageNo: number) {
  const start = (pageNo - 1) * perPage;
  return {
    data: items.slice(start, start + perPage),
    meta: { pagination: { total: items.length, current_page: pageNo, total_pages: Math.max(1, Math.ceil(items.length / perPage)) } },
  };
}

/** A fetch() that answers like Invoice Ninja from the given state. */
export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    state.calls.push(`${method} ${url.pathname}${url.search}`);
    if (state.failNext) {
      const status = state.failNext;
      state.failNext = undefined;
      return json(status, { message: "simulated" });
    }
    if (headers.get("X-API-TOKEN") !== TOKEN) return json(401, { message: "Invalid token" });
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const q = url.searchParams;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (body) state.bodies.push(body);
    const withClient = (i: Invoice) => (q.get("include") === "client" ? { ...i, client: state.clients.find((c) => c.id === i.client_id) } : i);
    let m: RegExpMatchArray | null;

    if (path === "/clients" && method === "GET") {
      const term = (q.get("filter") ?? "").toLowerCase();
      const list = state.clients.filter(
        (c) => !term || [c.name, ...c.contacts.flatMap((ct) => [ct.email, ct.first_name, ct.last_name])].some((v) => v.toLowerCase().includes(term)),
      );
      return json(200, page(list, Number(q.get("per_page") ?? 20), 1));
    }
    if (path === "/clients" && method === "POST") {
      if (!body.name) return json(422, { message: "The given data was invalid.", errors: { name: ["The name field is required."] } });
      const created: Client = { id: `c${state.clients.length + 1}New`, name: body.name, balance: 0, paid_to_date: 0, contacts: body.contacts };
      state.clients.push(created);
      return json(200, { data: created });
    }
    if ((m = path.match(/^\/clients\/([^/]+)$/))) {
      const found = state.clients.find((c) => c.id === m![1]);
      return found ? json(200, { data: found }) : json(404, { message: "Record not found" });
    }
    if (path === "/invoices" && method === "GET") {
      const statuses = (q.get("client_status") ?? "").split(",").filter(Boolean);
      const term = (q.get("filter") ?? "").toLowerCase();
      const list = state.invoices
        .filter((i) => !q.get("number") || i.number === q.get("number"))
        .filter((i) => !q.get("client_id") || i.client_id === q.get("client_id"))
        .filter((i) => !q.get("status_id") || i.status_id === q.get("status_id"))
        .filter(
          (i) =>
            !statuses.length ||
            statuses.includes("all") ||
            (statuses.includes("paid") && i.status_id === "4") ||
            (statuses.includes("unpaid") && ["2", "3"].includes(i.status_id)) ||
            (statuses.includes("overdue") && ["2", "3"].includes(i.status_id) && i.due_date < TODAY),
        )
        .filter((i) => !term || i.number.includes(term) || i.line_items.some((l) => l.notes.toLowerCase().includes(term)))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(withClient);
      return json(200, page(list, Number(q.get("per_page") ?? 20), Number(q.get("page") ?? 1)));
    }
    if (path === "/invoices" && method === "POST") {
      const client = state.clients.find((c) => c.id === body.client_id);
      if (!client) return json(422, { message: "The given data was invalid.", errors: { client_id: ["The selected client id is invalid."] } });
      const amount = body.line_items.reduce((sum: number, l: LineItem) => sum + l.cost * l.quantity, 0);
      const id = `i${46 + state.invoices.length - 5}`;
      const created: Invoice = {
        id, number: `00${46 + state.invoices.length - 5}`, client_id: client.id, status_id: q.get("send_email") === "true" ? "2" : "1",
        amount, balance: amount, paid_to_date: 0, date: TODAY, due_date: body.due_date ?? "", po_number: body.po_number,
        public_notes: body.public_notes, line_items: body.line_items, invitations: [{ link: `https://in.test/client/invoice/${id}` }],
      };
      state.invoices.push(created);
      return json(200, { data: created });
    }
    if (path === "/invoices/bulk" && method === "POST") {
      const missing = body.ids.filter((id: string) => !state.invoices.some((i) => i.id === id));
      return missing.length ? json(404, { message: "Record not found" }) : json(200, { data: [] });
    }
    if ((m = path.match(/^\/invoices\/([^/]+)$/))) {
      const found = state.invoices.find((i) => i.id === m![1]);
      return found ? json(200, { data: withClient(found) }) : json(404, { message: "Record not found" });
    }
    if (path === "/payments" && method === "POST") {
      const target = state.invoices.find((i) => i.id === body.invoices[0].invoice_id);
      if (!target) return json(422, { message: "The given data was invalid.", errors: { "invoices.0.invoice_id": ["Invalid invoice"] } });
      target.balance = Math.round((target.balance - body.amount) * 100) / 100;
      target.paid_to_date += body.amount;
      target.status_id = target.balance === 0 ? "4" : "3";
      const client = state.clients.find((c) => c.id === target.client_id)!;
      client.balance -= body.amount;
      const payment: Payment = { id: `p${state.payments.length + 1}`, number: String(state.payments.length + 7).padStart(4, "0"), amount: body.amount, date: body.date, client_id: body.client_id, transaction_reference: body.transaction_reference };
      state.payments.push(payment);
      return json(200, { data: payment });
    }
    return json(404, { message: "Unknown endpoint" });
  };
}
