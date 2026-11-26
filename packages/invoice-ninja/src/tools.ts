import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiError, type Client, type Invoice, type InvoiceNinjaApi } from "./api.ts";

/** A problem with the agent's input that it can fix (unknown client, ambiguous match, amount too high...). */
export class ToolError extends Error {}

export interface ToolOptions {
  /** Today's date as YYYY-MM-DD (injectable for tests). */
  today?: () => string;
}

type Status = "draft" | "sent" | "partial" | "overdue" | "paid" | "cancelled" | "reversed";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use the YYYY-MM-DD format");
const DAY_MS = 86_400_000;

function ok(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

async function run(fn: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    const message =
      error instanceof ApiError || error instanceof ToolError
        ? error.message
        : "Unexpected error in the Invoice Ninja MCP server. Retry once; if it persists, report it to the server owner.";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

export const money = (value: number) => Math.round(value * 100) / 100;

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

export function statusOf(invoice: Invoice, today: string): Status {
  switch (String(invoice.status_id)) {
    case "1":
      return "draft";
    case "4":
      return "paid";
    case "5":
      return "cancelled";
    case "6":
      return "reversed";
    default:
      if (invoice.balance > 0 && invoice.due_date && invoice.due_date < today) return "overdue";
      return String(invoice.status_id) === "3" ? "partial" : "sent";
  }
}

function primaryEmail(client?: Client): string | undefined {
  if (!client) return undefined;
  return (client.contacts.find((c) => c.is_primary) ?? client.contacts[0])?.email || undefined;
}

function clientSummary(client: Client) {
  return {
    id: client.id,
    name: client.display_name || client.name,
    email: primaryEmail(client),
    balance: money(client.balance),
    paid_to_date: money(client.paid_to_date),
  };
}

function invoiceSummary(invoice: Invoice, today: string) {
  const status = statusOf(invoice, today);
  return {
    id: invoice.id,
    number: invoice.number,
    client: invoice.client ? invoice.client.display_name || invoice.client.name : invoice.client_id,
    status,
    amount: money(invoice.amount),
    balance: money(invoice.balance),
    date: invoice.date,
    due_date: invoice.due_date || undefined,
    days_overdue: status === "overdue" ? daysBetween(invoice.due_date, today) : undefined,
  };
}

function label(client: Client): string {
  const email = primaryEmail(client);
  return `"${client.name}"${email ? ` <${email}>` : ""}`;
}

/** Find a client from what the user said: name, contact email, part of the name, or id. */
export async function resolveClient(api: InvoiceNinjaApi, ref: string): Promise<Client> {
  const wanted = ref.trim();
  const lower = wanted.toLowerCase();
  const found = (await api.listClients({ filter: wanted, per_page: 20 })).data.filter((c) => !c.is_deleted);
  const exact = found.filter(
    (c) => c.id === wanted || c.name.toLowerCase() === lower || c.contacts.some((ct) => ct.email?.toLowerCase() === lower),
  );
  if (exact.length === 1) return exact[0];
  const candidates = exact.length ? exact : found;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new ToolError(
      `"${wanted}" matches ${candidates.length} clients: ${candidates.slice(0, 8).map(label).join(", ")}. Ask the user which one.`,
    );
  }
  if (/^[A-Za-z0-9]{4,}$/.test(wanted)) {
    try {
      return await api.getClient(wanted);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  throw new ToolError(`No client matches "${wanted}". Search with find_clients, or add it with create_client.`);
}

/** Find an invoice by its number (e.g. "0042" or "INV-0042") or its id. */
export async function resolveInvoice(api: InvoiceNinjaApi, ref: string): Promise<Invoice> {
  const wanted = ref.trim().replace(/^#/, "");
  const byNumber = (await api.listInvoices({ number: wanted, include: "client" })).data.filter((i) => !i.is_deleted);
  const exact = byNumber.filter((i) => i.number.toLowerCase() === wanted.toLowerCase());
  if (exact.length === 1) return exact[0];
  if (byNumber.length === 1) return byNumber[0];
  if (byNumber.length > 1) {
    throw new ToolError(`"${wanted}" matches ${byNumber.length} invoices: ${byNumber.slice(0, 8).map((i) => i.number).join(", ")}.`);
  }
  try {
    return await api.getInvoice(wanted);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ToolError(`No invoice "${wanted}". Use list_invoices to find it by client or status.`);
    }
    throw error;
  }
}

const STATUS_QUERY: Record<string, { client_status?: string; status_id?: number }> = {
  all: {},
  draft: { status_id: 1 },
  sent: { status_id: 2 },
  partial: { status_id: 3 },
  unpaid: { client_status: "unpaid" },
  overdue: { client_status: "overdue" },
  paid: { client_status: "paid" },
};

export function registerTools(server: McpServer, api: InvoiceNinjaApi, options: ToolOptions = {}): void {
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10));

  server.registerTool(
    "find_clients",
    {
      title: "Find clients",
      description:
        "Search the customers (clients) of the Invoice Ninja account by name, contact name or email, with what each one owes " +
        "(balance) and has paid. Use it to check whether a customer already exists, get their contact details, or list " +
        "who owes money. For invoices, use list_invoices.",
      inputSchema: {
        query: z.string().optional().describe("Text to search in client name, contact name or email. Empty = all clients."),
        owes_money: z.boolean().default(false).describe("Only clients with an outstanding balance, largest first."),
        limit: z.number().int().min(1).max(50).default(10),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query, owes_money, limit }) =>
      run(async () => {
        const page = await api.listClients({ filter: query, per_page: owes_money ? 100 : limit, sort: owes_money ? "balance|desc" : "name|asc" });
        const clients = page.data
          .filter((c) => !c.is_deleted && (!owes_money || c.balance > 0))
          .sort((a, b) => (owes_money ? b.balance - a.balance : 0));
        return {
          count: Math.min(clients.length, limit),
          truncated: clients.length > limit,
          clients: clients.slice(0, limit).map(clientSummary),
        };
      }),
  );

  server.registerTool(
    "create_client",
    {
      title: "Create a client",
      description:
        "Add a new customer (client) with a primary contact. If a client with the same name already exists, returns it " +
        "instead of creating a duplicate, unless allow_duplicate is true.",
      inputSchema: {
        name: z.string().min(1).max(255).describe("Company or person name, e.g. 'Acme Corp'."),
        email: z.email().optional().describe("Primary contact email: invoices are sent there."),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        phone: z.string().optional(),
        website: z.string().optional(),
        allow_duplicate: z.boolean().default(false),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      run(async () => {
        if (!args.allow_duplicate) {
          const existing = (await api.listClients({ filter: args.name, per_page: 20 })).data.find(
            (c) => !c.is_deleted && c.name.toLowerCase() === args.name.trim().toLowerCase(),
          );
          if (existing) return { action: "existing", client: clientSummary(existing), note: "A client with this name already exists." };
        }
        const client = await api.createClient({
          name: args.name.trim(),
          phone: args.phone,
          website: args.website,
          contacts: [{ first_name: args.first_name ?? "", last_name: args.last_name ?? "", email: args.email ?? "", is_primary: true }],
        });
        return { action: "created", client: clientSummary(client) };
      }),
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List invoices",
      description:
        "List invoices, newest first, filtered by client and/or status (draft, sent, partial, unpaid, overdue, paid). " +
        "Returns totals and days overdue. Use it for 'what has Acme not paid?' or 'show last month's invoices'. " +
        "For the overall money owed across all clients, use get_receivables_summary.",
      inputSchema: {
        client: z.string().optional().describe("Client name, email or id."),
        status: z.enum(["all", "draft", "sent", "partial", "unpaid", "overdue", "paid"]).default("all"),
        search: z.string().optional().describe("Text to search in number, PO number, item names or notes."),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client, status, search, limit }) =>
      run(async () => {
        const clientId = client ? (await resolveClient(api, client)).id : undefined;
        const page = await api.listInvoices({ ...STATUS_QUERY[status], client_id: clientId, filter: search, per_page: limit, include: "client" });
        const date = today();
        const invoices = page.data.filter((i) => !i.is_deleted).map((i) => invoiceSummary(i, date));
        return {
          count: invoices.length,
          total_matching: page.meta?.pagination?.total ?? invoices.length,
          total_amount: money(invoices.reduce((sum, i) => sum + i.amount, 0)),
          total_balance: money(invoices.reduce((sum, i) => sum + i.balance, 0)),
          invoices,
        };
      }),
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get an invoice",
      description:
        "Full detail of ONE invoice by its number (e.g. '0042') or id: client and email, line items, totals, balance due, " +
        "status, due date and the client portal link to view or pay it.",
      inputSchema: { invoice: z.string().min(1).describe("Invoice number or id.") },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ invoice }) =>
      run(async () => {
        const found = await resolveInvoice(api, invoice);
        return {
          ...invoiceSummary(found, today()),
          client_email: primaryEmail(found.client),
          po_number: found.po_number || undefined,
          paid_to_date: money(found.paid_to_date),
          items: found.line_items.map((l) => ({
            item: l.product_key || undefined,
            description: l.notes,
            quantity: l.quantity,
            unit_price: money(l.cost),
            total: money(l.line_total ?? l.cost * l.quantity),
          })),
          notes: found.public_notes || undefined,
          link: found.invitations?.[0]?.link,
        };
      }),
  );

  server.registerTool(
    "create_invoice",
    {
      title: "Create an invoice",
      description:
        "Bill a client: create an invoice from line items (description, quantity, unit price). Saved as a draft unless " +
        "send is true, which also emails it to the client. Confirm the amounts with the user before sending.",
      inputSchema: {
        client: z.string().min(1).describe("Client name, email or id. Create the client first with create_client if needed."),
        items: z
          .array(
            z.object({
              description: z.string().min(1),
              quantity: z.number().positive().default(1),
              unit_price: z.number().min(0),
              product_key: z.string().optional().describe("Product or service code, if any."),
            }),
          )
          .min(1)
          .max(100),
        due_date: DATE.optional().describe("YYYY-MM-DD. Default: the account's payment terms."),
        po_number: z.string().optional(),
        notes: z.string().max(5000).optional().describe("Public note printed on the invoice."),
        send: z.boolean().default(false).describe("Email the invoice to the client right away."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) =>
      run(async () => {
        const client = await resolveClient(api, args.client);
        if (args.send && !primaryEmail(client)) {
          throw new ToolError(`${client.name} has no contact email, so the invoice cannot be sent. Create it with send=false.`);
        }
        const invoice = await api.createInvoice(
          {
            client_id: client.id,
            due_date: args.due_date,
            po_number: args.po_number,
            public_notes: args.notes,
            line_items: args.items.map((item) => ({
              product_key: item.product_key ?? "",
              notes: item.description,
              quantity: item.quantity,
              cost: item.unit_price,
            })),
          },
          { send_email: args.send },
        );
        return {
          action: args.send ? "created_and_sent" : "created_as_draft",
          invoice: invoiceSummary({ ...invoice, client }, today()),
          sent_to: args.send ? primaryEmail(client) : undefined,
          link: invoice.invitations?.[0]?.link,
        };
      }),
  );

  server.registerTool(
    "send_invoice",
    {
      title: "Send an invoice or a reminder",
      description:
        "Email an existing invoice to its client, or a payment reminder (reminder1, reminder2, reminder3 templates). " +
        "Use it to send a draft, re-send an invoice, or chase a late payment.",
      inputSchema: {
        invoice: z.string().min(1).describe("Invoice number or id."),
        template: z.enum(["invoice", "reminder1", "reminder2", "reminder3"]).default("invoice"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ invoice, template }) =>
      run(async () => {
        const found = await resolveInvoice(api, invoice);
        const status = statusOf(found, today());
        if (status === "paid" || status === "cancelled" || status === "reversed") {
          throw new ToolError(`Invoice ${found.number} is ${status}; there is nothing to send.`);
        }
        const client = found.client ?? (await api.getClient(found.client_id));
        const email = primaryEmail(client);
        if (!email) throw new ToolError(`${client.name} has no contact email. Add one in Invoice Ninja first.`);
        if (template === "invoice") await api.bulkInvoices("email", [found.id]);
        else await api.bulkInvoices("send_email", [found.id], template);
        return { sent: true, template, invoice: found.number, to: email, balance: money(found.balance) };
      }),
  );

  server.registerTool(
    "record_payment",
    {
      title: "Record a payment",
      description:
        "Record money received against an invoice (bank transfer, check, cash...). Defaults to paying the full balance " +
        "today. Marks the invoice paid or partially paid.",
      inputSchema: {
        invoice: z.string().min(1).describe("Invoice number or id."),
        amount: z.number().positive().optional().describe("Amount received. Default: the full balance due."),
        date: DATE.optional().describe("YYYY-MM-DD. Default: today."),
        reference: z.string().max(100).optional().describe("Bank or transaction reference."),
        send_receipt: z.boolean().default(false).describe("Email a payment receipt to the client."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args) =>
      run(async () => {
        const found = await resolveInvoice(api, args.invoice);
        if (found.balance <= 0) throw new ToolError(`Invoice ${found.number} has no balance due.`);
        const amount = money(args.amount ?? found.balance);
        if (amount > money(found.balance)) {
          throw new ToolError(`${amount} is more than the balance due on invoice ${found.number} (${money(found.balance)}).`);
        }
        const payment = await api.createPayment(
          {
            client_id: found.client_id,
            amount,
            date: args.date ?? today(),
            transaction_reference: args.reference,
            invoices: [{ invoice_id: found.id, amount }],
          },
          { email_receipt: args.send_receipt },
        );
        const remaining = money(found.balance - amount);
        return {
          recorded: true,
          payment: payment.number,
          invoice: found.number,
          amount,
          remaining_balance: remaining,
          invoice_status: remaining === 0 ? "paid" : "partial",
        };
      }),
  );

  server.registerTool(
    "get_receivables_summary",
    {
      title: "Accounts receivable summary",
      description:
        "How much money customers owe in total: outstanding and overdue amounts, aging buckets (not due, 1-30, 31-60, " +
        "61-90, over 90 days late), the clients who owe the most and the oldest overdue invoices. Use it for cash-flow " +
        "questions like 'how much are we owed?' or 'who should I chase first?'.",
      inputSchema: {
        client: z.string().optional().describe("Limit to one client (name, email or id)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ client }) =>
      run(async () => {
        const clientId = client ? (await resolveClient(api, client)).id : undefined;
        const unpaid: Invoice[] = [];
        for (let page = 1; page <= 5; page++) {
          const result = await api.listInvoices({ client_status: "unpaid", client_id: clientId, per_page: 100, page, include: "client" });
          unpaid.push(...result.data.filter((i) => !i.is_deleted && i.balance > 0 && String(i.status_id) !== "1"));
          if (result.data.length < 100) break;
        }
        const date = today();
        const buckets = { not_due: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
        const byClient = new Map<string, number>();
        for (const invoice of unpaid) {
          const late = invoice.due_date ? daysBetween(invoice.due_date, date) : 0;
          const key = late <= 0 ? "not_due" : late <= 30 ? "1_30" : late <= 60 ? "31_60" : late <= 90 ? "61_90" : "over_90";
          buckets[key] += invoice.balance;
          const name = invoice.client ? invoice.client.display_name || invoice.client.name : invoice.client_id;
          byClient.set(name, (byClient.get(name) ?? 0) + invoice.balance);
        }
        const overdue = unpaid.filter((i) => statusOf(i, date) === "overdue");
        return {
          as_of: date,
          open_invoices: unpaid.length,
          total_outstanding: money(unpaid.reduce((sum, i) => sum + i.balance, 0)),
          total_overdue: money(overdue.reduce((sum, i) => sum + i.balance, 0)),
          aging: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, money(v)])),
          top_debtors: [...byClient.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, owed]) => ({ client: name, owed: money(owed) })),
          oldest_overdue: overdue
            .sort((a, b) => a.due_date.localeCompare(b.due_date))
            .slice(0, 5)
            .map((i) => invoiceSummary(i, date)),
          note: unpaid.length >= 500 ? "Only the first 500 open invoices were included." : undefined,
        };
      }),
  );
}
