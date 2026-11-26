import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Article, Ticket, User, ZammadApi } from "./api.ts";
import { ApiError, confirmFirst, defineTool, pickOne, type ToolContext, ToolError } from "./core.ts";

export interface ToolOptions {
  writes: boolean;
  now: () => Date;
}

const OPEN_QUERY = "state.name:(new OR open OR \"pending reminder\")";
const hoursBetween = (from: string, to: Date) => Math.round((to.getTime() - Date.parse(from)) / 3_600_000);

/** Escapes characters with a meaning in Zammad's Elasticsearch query syntax. */
const escape = (value: string) => value.replace(/([+\-=&|><!(){}[\]^"~*?:\\/])/g, "\\$1");

function ticketSummary(t: Ticket) {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    state: t.state,
    priority: t.priority,
    group: t.group,
    owner: t.owner && t.owner !== "-" ? t.owner : undefined,
    customer: t.customer,
    updated_at: t.updated_at,
  };
}

const plain = (html: string) => html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ").trim();

function articleSummary(a: Article) {
  const text = a.content_type === "text/html" ? plain(a.body) : a.body;
  return { from: a.from, type: a.type, internal: a.internal || undefined, sender: a.sender, at: a.created_at, text: text.length > 1500 ? `${text.slice(0, 1500)}...` : text };
}

const userSummary = (u: User) => ({ id: u.id, name: `${u.firstname} ${u.lastname}`.trim(), email: u.email || undefined, phone: u.phone || undefined, organization: u.organization || undefined });

async function resolveTicket(api: ZammadApi, ref: string | number): Promise<Ticket> {
  const wanted = String(ref).trim().replace(/^#/, "");
  const byNumber = await api.searchTickets(`number:${escape(wanted)}`, 5);
  const exact = byNumber.filter((t) => t.number === wanted);
  if (exact.length === 1) return exact[0];
  if (/^\d+$/.test(wanted)) {
    try {
      return await api.getTicket(Number(wanted));
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  throw new ToolError(`No ticket "${wanted}". Use search_tickets to find it.`);
}

export function registerTools(server: McpServer, api: ZammadApi, options: ToolOptions): void {
  const ctx: ToolContext = { server, writes: options.writes, service: "Zammad" };

  defineTool(
    ctx,
    "search_tickets",
    {
      title: "Search tickets",
      description:
        "Find support tickets by words (title and messages), customer email, state (open by default, closed or all), group " +
        "or priority, newest first. Use it for 'any ticket from acme.com about invoices?'.",
      input: {
        text: z.string().optional().describe("Words to look for, or a customer email."),
        state: z.enum(["open", "closed", "all"]).default("open"),
        group: z.string().optional(),
        priority: z.enum(["1 low", "2 normal", "3 high"]).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      },
      kind: "read",
    },
    async (args) => {
      const parts: string[] = [];
      if (args.text) parts.push(args.text.includes("@") ? `customer.email:${escape(args.text)}` : args.text);
      if (args.state === "open") parts.push(OPEN_QUERY);
      if (args.state === "closed") parts.push("state.name:closed");
      if (args.group) parts.push(`group.name:"${args.group.replace(/"/g, "")}"`);
      if (args.priority) parts.push(`priority.name:"${args.priority}"`);
      const tickets = await api.searchTickets(parts.join(" AND ") || "*", args.limit);
      return { count: tickets.length, tickets: tickets.map(ticketSummary) };
    },
  );

  defineTool(
    ctx,
    "get_ticket",
    {
      title: "Get a ticket",
      description:
        "Read one ticket by number or id: state, priority, group, owner, customer and the conversation (last messages and " +
        "internal notes, as plain text). Use it before replying or summarising a case.",
      input: { ticket: z.union([z.string(), z.number()]).describe("Ticket number or id."), messages: z.number().int().min(1).max(30).default(10) },
      kind: "read",
    },
    async (args) => {
      const ticket = await resolveTicket(api, args.ticket);
      const articles = await api.articles(ticket.id);
      return { ...ticketSummary(ticket), created_at: ticket.created_at, message_count: articles.length, messages: articles.slice(-args.messages).map(articleSummary) };
    },
  );

  defineTool(
    ctx,
    "find_customers",
    {
      title: "Find customers",
      description:
        "Look up people (customers and agents) by name, email or organization, with contact details. Use it to check who a " +
        "customer is before creating a ticket for them.",
      input: { query: z.string().min(2), limit: z.number().int().min(1).max(50).default(10) },
      kind: "read",
    },
    async ({ query, limit }) => {
      const users = await api.searchUsers(query, limit);
      return { count: users.length, people: users.map(userSummary) };
    },
  );

  defineTool(
    ctx,
    "get_queue_summary",
    {
      title: "Get the queue summary",
      description:
        "Helpdesk overview: open tickets counted by state, group and priority, unassigned tickets, high-priority tickets and " +
        "the oldest waiting ones with their age in hours. Use it for 'how is support doing?' or 'what needs attention?'.",
      input: {},
      kind: "read",
    },
    async () => {
      const open = await api.searchTickets(OPEN_QUERY, 200);
      const count = (key: (t: Ticket) => string) =>
        Object.fromEntries([...open.reduce((m, t) => m.set(key(t), (m.get(key(t)) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]));
      const now = options.now();
      return {
        open: open.length,
        by_state: count((t) => t.state),
        by_group: count((t) => t.group),
        by_priority: count((t) => t.priority),
        unassigned: open.filter((t) => !t.owner || t.owner === "-").length,
        high_priority: open.filter((t) => t.priority.startsWith("3")).map(ticketSummary),
        oldest: [...open].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 5).map((t) => ({ number: t.number, title: t.title, age_hours: hoursBetween(t.created_at, now) })),
      };
    },
  );

  defineTool(
    ctx,
    "create_ticket",
    {
      title: "Create a ticket",
      description:
        "Open a new ticket for a customer (by email; Zammad creates the customer if unknown) in a group, with a first message " +
        "recorded as a phone or web note. The customer is not emailed by this tool.",
      input: {
        title: z.string().min(3).max(200),
        customer_email: z.email(),
        group: z.string().describe("Group (team) name, e.g. 'Users' or 'Support'."),
        message: z.string().min(1).max(20000),
        channel: z.enum(["phone", "web", "note"]).default("phone"),
      },
      kind: "write",
    },
    async (args) => {
      const groups = (await api.groups()).filter((g) => g.active !== false);
      const wanted = args.group.toLowerCase();
      const group = pickOne(args.group, groups.filter((g) => g.name.toLowerCase() === wanted).length ? groups.filter((g) => g.name.toLowerCase() === wanted) : groups.filter((g) => g.name.toLowerCase().includes(wanted)), (g) => `"${g.name}"`, "group", `Groups: ${groups.map((g) => g.name).join(", ")}.`);
      const ticket = await api.createTicket({
        title: args.title,
        group: group.name,
        customer_id: `guess:${args.customer_email}`,
        article: { subject: args.title, body: args.message, type: args.channel, internal: false },
      });
      return { done: true, ticket: ticketSummary(ticket) };
    },
  );

  defineTool(
    ctx,
    "add_internal_note",
    {
      title: "Add an internal note",
      description:
        "Add an internal note to a ticket for the team (investigation, summary, hand-over). Internal notes are never visible " +
        "to the customer and send no email.",
      input: { ticket: z.union([z.string(), z.number()]), note: z.string().min(1).max(20000) },
      kind: "write",
    },
    async (args) => {
      const ticket = await resolveTicket(api, args.ticket);
      await api.addArticle({ ticket_id: ticket.id, body: args.note, type: "note", internal: true, content_type: "text/plain" });
      return { done: true, ticket: ticket.number };
    },
  );

  defineTool(
    ctx,
    "reply_to_customer",
    {
      title: "Reply to the customer",
      description:
        "Send an email reply to the customer on a ticket, optionally changing its state (e.g. pending reminder or closed). " +
        "Call with confirm=false first to get the draft and recipient, show it to the user, then confirm=true.",
      input: {
        ticket: z.union([z.string(), z.number()]),
        message: z.string().min(1).max(20000),
        set_state: z.enum(["open", "pending reminder", "closed"]).optional(),
        confirm: z.boolean().default(false),
      },
      kind: "send",
    },
    async (args) => {
      const ticket = await resolveTicket(api, args.ticket);
      const articles = await api.articles(ticket.id);
      const lastFromCustomer = [...articles].reverse().find((a) => a.sender === "Customer" && a.from);
      const to = lastFromCustomer?.from;
      if (!to) throw new ToolError(`Ticket ${ticket.number} has no customer email to reply to. Add an internal note instead, or reply from Zammad.`);
      if (!args.confirm) return confirmFirst(`Email ${to} on ticket ${ticket.number} ("${ticket.title}")${args.set_state ? ` and set it to ${args.set_state}` : ""}.`, { draft: args.message });
      await api.addArticle({ ticket_id: ticket.id, body: args.message, type: "email", internal: false, to, subject: `Re: ${ticket.title}`, content_type: "text/plain" });
      const updated = args.set_state ? await api.updateTicket(ticket.id, { state: args.set_state }) : ticket;
      return { done: true, sent_to: to, ticket: ticketSummary(updated) };
    },
  );

  defineTool(
    ctx,
    "update_ticket",
    {
      title: "Update a ticket",
      description:
        "Change a ticket's state (open, pending reminder, closed), raise or lower its priority (1 low, 2 normal, 3 high), or assign it to an owner (agent email). " +
        "No email is sent to the customer. Closing can be undone by reopening.",
      input: {
        ticket: z.union([z.string(), z.number()]),
        state: z.enum(["open", "pending reminder", "closed"]).optional(),
        priority: z.enum(["1 low", "2 normal", "3 high"]).optional(),
        owner_email: z.email().optional().describe("Agent to assign."),
      },
      kind: "write",
      idempotent: true,
    },
    async (args) => {
      if (!args.state && !args.priority && !args.owner_email) throw new ToolError("Nothing to change: give state, priority or owner_email.");
      const ticket = await resolveTicket(api, args.ticket);
      let owner_id: number | undefined;
      if (args.owner_email) {
        const users = (await api.searchUsers(args.owner_email, 5)).filter((u) => u.email.toLowerCase() === args.owner_email.toLowerCase());
        owner_id = pickOne(args.owner_email, users, (u) => u.email, "agent", "Check the agent's email in Zammad.").id;
      }
      const updated = await api.updateTicket(ticket.id, { state: args.state, priority: args.priority, owner_id });
      return { done: true, ticket: ticketSummary(updated) };
    },
  );
}
