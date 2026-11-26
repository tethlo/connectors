// In-memory imitation of the Zammad REST API v1, for the tests and the agent evaluation.
// Shapes follow the public docs (docs.zammad.org); the search supports the query fields used by the server.
import type { Article, Group, Ticket, User } from "../src/api.ts";

export const NOW = "2026-11-24T12:00:00Z";
export const TEST_ENV = { ZAMMAD_URL: "https://helpdesk.zammad.test", ZAMMAD_TOKEN: "test-token" };
export const PER_USER_HEADERS = { "x-zammad-token": "test-token" };

export const EXPECTED_TOOLS = [
  "search_tickets",
  "get_ticket",
  "find_customers",
  "get_queue_summary",
  "create_ticket",
  "add_internal_note",
  "reply_to_customer",
  "update_ticket",
];

export const HTTP_PROBE = { tool: "get_queue_summary", args: {}, expect: /Invoice shows wrong VAT/ };
export const CONFIRM_CALLS = [{ tool: "reply_to_customer", args: { ticket: "31001", message: "We are on it." } }];

export interface FakeState {
  tickets: Ticket[];
  articles: Record<number, Article[]>;
  users: User[];
  groups: Group[];
  calls: string[];
}

export function seed(): FakeState {
  const ticket = (id: number, number: string, title: string, state: string, priority: string, group: string, owner: string, customer: string, created: string): Ticket => ({
    id, number, title, state, priority, group, owner, customer, customer_id: 100 + id, created_at: created, updated_at: created, article_count: 1,
  });
  const article = (id: number, from: string, body: string, sender: string, internal = false, type = "email"): Article => ({ id, from, body, type, internal, sender, content_type: "text/plain", created_at: "2026-11-23T09:00:00Z" });
  return {
    tickets: [
      ticket(1, "31001", "Invoice shows wrong VAT", "open", "3 high", "Billing", "-", "Jane Doe", "2026-11-22T12:00:00Z"),
      ticket(2, "31002", "Cannot log in to the portal", "new", "2 normal", "Support", "Tom Agent", "Sam Lee", "2026-11-24T08:00:00Z"),
      ticket(3, "31003", "Feature request: CSV export", "pending reminder", "1 low", "Support", "Tom Agent", "Jane Doe", "2026-11-20T12:00:00Z"),
      ticket(4, "30990", "Password reset", "closed", "2 normal", "Support", "Tom Agent", "Sam Lee", "2026-11-01T12:00:00Z"),
    ],
    articles: {
      1: [article(11, "Jane Doe <jane@acme.test>", "Hi, invoice 2026-0042 shows 19% VAT instead of 21%.", "Customer"), article(12, "Tom Agent", "Checked: tax rule outdated.", "Agent", true, "note")],
      2: [{ ...article(21, "Sam Lee <sam@globex.test>", "<p>I get <b>error 500</b> when I log in.</p>", "Customer"), content_type: "text/html" }],
      3: [article(31, "", "Logged by phone.", "Agent", false, "phone")],
    },
    users: [
      { id: 101, firstname: "Jane", lastname: "Doe", email: "jane@acme.test", organization: "Acme" },
      { id: 102, firstname: "Sam", lastname: "Lee", email: "sam@globex.test", organization: "Globex" },
      { id: 7, firstname: "Tom", lastname: "Agent", email: "tom@helpdesk.test" },
    ],
    groups: [{ id: 1, name: "Users", active: true }, { id: 2, name: "Support", active: true }, { id: 3, name: "Billing", active: true }],
    calls: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Minimal evaluator for the query syntax the server sends: field:value clauses joined by AND, plus free words. */
function search(state: FakeState, query: string): Ticket[] {
  const clauses = query.split(" AND ");
  return state.tickets.filter((t) =>
    clauses.every((clause) => {
      if (clause === "*") return true;
      let m: RegExpMatchArray | null;
      if ((m = clause.match(/^number:(.+)$/))) return t.number === m[1].replace(/\\/g, "");
      if ((m = clause.match(/^state\.name:\((.+)\)$/))) return m[1].split(" OR ").map((s) => s.replace(/"/g, "")).includes(t.state);
      if ((m = clause.match(/^state\.name:(.+)$/))) return t.state === m[1];
      if ((m = clause.match(/^group\.name:"(.+)"$/))) return t.group === m[1];
      if ((m = clause.match(/^priority\.name:"(.+)"$/))) return t.priority === m[1];
      if ((m = clause.match(/^customer\.email:(.+)$/))) return state.users.some((u) => u.email === m![1].replace(/\\/g, "") && `${u.firstname} ${u.lastname}` === t.customer);
      const words = clause.toLowerCase().split(/\s+/);
      const haystack = [t.title, ...(state.articles[t.id] ?? []).map((a) => a.body)].join(" ").toLowerCase();
      return words.every((w) => haystack.includes(w));
    }),
  );
}

export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}${url.search}`);
    if (new Headers(init?.headers).get("Authorization") !== "Token token=test-token") return json(401, { error: "authentication failed" });
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let m: RegExpMatchArray | null;

    if (path === "/tickets/search") return json(200, search(state, url.searchParams.get("query") ?? "*").sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, Number(url.searchParams.get("limit") ?? 50)));
    if (path === "/tickets" && method === "POST") {
      const email = String(body.customer_id).replace(/^guess:/, "");
      let user = state.users.find((u) => u.email === email);
      if (!user) state.users.push((user = { id: 200 + state.users.length, firstname: "", lastname: "", email }));
      const id = state.tickets.length + 1;
      const created: Ticket = { id, number: String(31000 + id), title: body.title, state: "new", priority: "2 normal", group: body.group, owner: "-", customer: `${user.firstname} ${user.lastname}`.trim() || email, created_at: NOW, updated_at: NOW };
      state.tickets.push(created);
      state.articles[id] = [{ id: id * 10, body: body.article.body, type: body.article.type, internal: false, sender: "Agent", created_at: NOW }];
      return json(201, created);
    }
    if ((m = path.match(/^\/tickets\/(\d+)$/))) {
      const found = state.tickets.find((t) => t.id === Number(m![1]));
      if (!found) return json(404, { error: "Couldn't find Ticket" });
      if (method === "PUT") {
        if (body.state) found.state = body.state;
        if (body.priority) found.priority = body.priority;
        if (body.owner_id) {
          const owner = state.users.find((u) => u.id === body.owner_id)!;
          found.owner = `${owner.firstname} ${owner.lastname}`;
        }
      }
      return json(200, found);
    }
    if ((m = path.match(/^\/ticket_articles\/by_ticket\/(\d+)$/))) return json(200, state.articles[Number(m[1])] ?? []);
    if (path === "/ticket_articles" && method === "POST") {
      const list = (state.articles[body.ticket_id] ??= []);
      const created: Article = { id: body.ticket_id * 10 + list.length + 1, from: "Agent", to: body.to, body: body.body, type: body.type, internal: body.internal, sender: "Agent", created_at: NOW };
      list.push(created);
      return json(201, created);
    }
    if (path === "/users/search") {
      const q = (url.searchParams.get("query") ?? "").toLowerCase();
      return json(200, state.users.filter((u) => [u.firstname, u.lastname, u.email, u.organization ?? ""].some((v) => v.toLowerCase().includes(q))));
    }
    if (path === "/groups") return json(200, state.groups);
    return json(404, { error: "Unknown endpoint" });
  };
}
