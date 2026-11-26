import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Order, Product, Sellable, VeeqoApi, Warehouse } from "./api.ts";
import { ApiError, confirmFirst, DATE, defineTool, money, pickOne, type ToolContext, ToolError } from "./core.ts";

export interface ToolOptions {
  writes: boolean;
  now: () => Date;
}

const ORDER_STATUS = ["awaiting_payment", "awaiting_fulfillment", "awaiting_stock", "shipped", "cancelled", "refunded"] as const;

const customerName = (o: Order) => o.customer?.full_name || [o.deliver_to?.first_name, o.deliver_to?.last_name].filter(Boolean).join(" ") || undefined;

function orderSummary(o: Order) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    channel: o.channel?.name,
    created: o.created_at.slice(0, 10),
    customer: customerName(o),
    ship_to: [o.deliver_to?.city, o.deliver_to?.country].filter(Boolean).join(", ") || undefined,
    total: o.total_price !== undefined ? money(Number(o.total_price)) : undefined,
    items: o.line_items.reduce((n, l) => n + l.quantity, 0),
  };
}

const available = (s: Sellable) => (s.stock_entries ?? []).reduce((n, e) => n + (e.available_stock_level ?? e.physical_stock_level - (e.allocated_stock_level ?? 0)), 0);
const physical = (s: Sellable) => (s.stock_entries ?? []).reduce((n, e) => n + e.physical_stock_level, 0);

function sellableSummary(p: Product, s: Sellable, warehouses?: Warehouse[]) {
  return {
    sellable_id: s.id,
    sku: s.sku_code,
    name: s.title && s.title !== p.title ? `${p.title} - ${s.title}` : p.title,
    price: s.price !== undefined ? money(Number(s.price)) : undefined,
    on_hand: physical(s),
    available: available(s),
    by_warehouse: warehouses ? (s.stock_entries ?? []).map((e) => ({ warehouse: warehouses.find((w) => w.id === e.warehouse_id)?.name ?? e.warehouse_id, on_hand: e.physical_stock_level })) : undefined,
  };
}

async function resolveOrder(api: VeeqoApi, ref: string | number): Promise<Order> {
  const wanted = String(ref).trim().replace(/^#/, "");
  if (/^\d+$/.test(wanted)) {
    try {
      return await api.getOrder(Number(wanted));
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
  }
  const matches = (await api.listOrders({ query: wanted })).filter((o) => o.number === wanted || o.number.endsWith(wanted));
  return pickOne(wanted, matches, (o) => `${o.number} (${o.id})`, "order", "Use list_orders to find it.");
}

async function resolveSku(api: VeeqoApi, sku: string): Promise<{ product: Product; sellable: Sellable }> {
  const products = await api.listProducts({ query: sku });
  const hits = products.flatMap((product) => product.sellables.filter((s) => s.sku_code.toLowerCase() === sku.trim().toLowerCase()).map((sellable) => ({ product, sellable })));
  return pickOne(sku, hits, (h) => h.sellable.sku_code, "SKU", "Search with find_products to get the exact SKU.");
}

export function registerTools(server: McpServer, api: VeeqoApi, options: ToolOptions): void {
  const ctx: ToolContext = { server, writes: options.writes, service: "Veeqo" };

  defineTool(
    ctx,
    "list_orders",
    {
      title: "List orders",
      description:
        "Orders from all sales channels by status (awaiting_fulfillment by default: the packing queue; or awaiting_payment, " +
        "awaiting_stock, shipped, cancelled, refunded), optionally created since a date, with customer, destination and total.",
      input: {
        status: z.enum(ORDER_STATUS).default("awaiting_fulfillment"),
        since: z.string().regex(DATE).optional().describe("Created on or after this day."),
        limit: z.number().int().min(1).max(100).default(25),
      },
      kind: "read",
    },
    async (args) => {
      const orders = await api.listOrders({ status: args.status, created_at_min: args.since ? `${args.since} 00:00:00` : undefined });
      const byChannel = orders.reduce((m, o) => m.set(o.channel?.name ?? "unknown", (m.get(o.channel?.name ?? "unknown") ?? 0) + 1), new Map<string, number>());
      return { status: args.status, count: orders.length, by_channel: Object.fromEntries(byChannel), orders: orders.slice(0, args.limit).map(orderSummary) };
    },
  );

  defineTool(
    ctx,
    "get_order",
    {
      title: "Get an order",
      description:
        "One order by its id or order number: status, channel, customer, delivery city, line items (SKU, product, quantity) " +
        "and internal notes. Use it to answer a customer asking 'where is my order?'.",
      input: { order: z.union([z.string(), z.number()]).describe("Order id or order number.") },
      kind: "read",
    },
    async ({ order }) => {
      const o = await resolveOrder(api, order);
      return {
        ...orderSummary(o),
        currency: o.currency_code,
        lines: o.line_items.map((l) => ({ sku: l.sellable.sku_code, product: l.sellable.product_title ?? l.sellable.title, quantity: l.quantity })),
        notes: o.employee_notes?.map((n) => n.text),
      };
    },
  );

  defineTool(
    ctx,
    "find_products",
    {
      title: "Find products",
      description:
        "Search the catalogue by product name or SKU and get each variant's price and stock: on hand and available (not yet " +
        "allocated to orders), per warehouse. Use it for 'how many blue mugs do we have?'.",
      input: { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) },
      kind: "read",
    },
    async ({ query, limit }) => {
      const [products, warehouses] = await Promise.all([api.listProducts({ query }), api.listWarehouses()]);
      const variants = products.flatMap((p) => p.sellables.map((s) => sellableSummary(p, s, warehouses)));
      return { count: variants.length, variants: variants.slice(0, limit) };
    },
  );

  defineTool(
    ctx,
    "get_low_stock",
    {
      title: "Get low stock",
      description:
        "Variants whose available stock is at or below a threshold (default 5), lowest first, including those already out " +
        "of stock, to decide what to reorder. Scans up to 100 products.",
      input: { threshold: z.number().int().min(0).max(10_000).default(5) },
      kind: "read",
    },
    async ({ threshold }) => {
      const products = await api.listProducts({});
      const low = products
        .flatMap((p) => p.sellables.map((s) => sellableSummary(p, s)))
        .filter((v) => v.available <= threshold)
        .sort((a, b) => a.available - b.available)
        .map(({ by_warehouse: _unused, ...v }) => v);
      return { threshold, count: low.length, out_of_stock: low.filter((v) => v.available <= 0).length, variants: low };
    },
  );

  defineTool(
    ctx,
    "list_warehouses",
    {
      title: "List warehouses",
      description:
        "Warehouses (stock locations) of the account with their id, needed to read or set stock in a specific location.",
      input: {},
      kind: "read",
    },
    async () => ({ warehouses: (await api.listWarehouses()).map((w) => ({ id: w.id, name: w.name })) }),
  );

  defineTool(
    ctx,
    "find_customers",
    {
      title: "Find customers",
      description:
        "Look up customers (buyers) by name or email, with phone, to identify a buyer before checking their order. Veeqo " +
        "customers come from all sales channels.",
      input: { query: z.string().min(2) },
      kind: "read",
    },
    async ({ query }) => {
      const customers = await api.listCustomers(query);
      return {
        count: customers.length,
        customers: customers.map((c) => ({ id: c.id, name: c.full_name || `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim(), email: c.email, phone: c.phone || undefined })),
      };
    },
  );

  defineTool(
    ctx,
    "set_stock_level",
    {
      title: "Set the stock level",
      description:
        "Overwrite the on-hand stock count of a SKU in one warehouse, after a stock take or a delivery. This replaces the " +
        "current number, so call with confirm=false first to see the change, then confirm=true.",
      input: {
        sku: z.string().min(1),
        warehouse: z.string().describe("Warehouse name or id."),
        on_hand: z.number().int().min(0).max(1_000_000),
        confirm: z.boolean().default(false),
      },
      kind: "destructive",
      idempotent: true,
    },
    async (args) => {
      const [{ product, sellable }, warehouses] = await Promise.all([resolveSku(api, args.sku), api.listWarehouses()]);
      const wanted = args.warehouse.trim().toLowerCase();
      const warehouse = pickOne(args.warehouse, warehouses.filter((w) => String(w.id) === wanted || w.name.toLowerCase().includes(wanted)), (w) => `"${w.name}" (${w.id})`, "warehouse", "Call list_warehouses.");
      const current = sellable.stock_entries?.find((e) => e.warehouse_id === warehouse.id)?.physical_stock_level ?? 0;
      if (!args.confirm) return confirmFirst(`Set ${sellable.sku_code} (${product.title}) in ${warehouse.name} from ${current} to ${args.on_hand} on hand.`);
      const entry = await api.setStockLevel(sellable.id, warehouse.id, args.on_hand);
      return { done: true, sku: sellable.sku_code, warehouse: warehouse.name, before: current, on_hand: entry.physical_stock_level };
    },
  );

  defineTool(
    ctx,
    "add_order_note",
    {
      title: "Add an order note",
      description:
        "Add an internal employee note to an order (e.g. 'customer asked to hold until Monday'). Notes are internal and " +
        "are not sent to the buyer or the sales channel.",
      input: { order: z.union([z.string(), z.number()]), note: z.string().min(1).max(2000) },
      kind: "write",
    },
    async (args) => {
      const o = await resolveOrder(api, args.order);
      if (o.status === "cancelled") throw new ToolError(`Order ${o.number} is cancelled.`);
      await api.addOrderNote(o.id, args.note);
      return { done: true, order: o.number };
    },
  );
}
