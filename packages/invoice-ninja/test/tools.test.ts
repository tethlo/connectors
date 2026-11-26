import assert from "node:assert/strict";
import { test } from "node:test";
import { seed } from "./fake-api.ts";
import { connect, data, text } from "./helpers.ts";

test("exposes 8 documented tools with safety annotations", async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "create_client",
    "create_invoice",
    "find_clients",
    "get_invoice",
    "get_receivables_summary",
    "list_invoices",
    "record_payment",
    "send_invoice",
  ]);
  for (const tool of tools) {
    assert.ok((tool.description ?? "").length > 80, `${tool.name} needs a real description`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} needs annotations`);
  }
  await close();
});

test("find_clients searches and ranks clients who owe money", async () => {
  const { call, close } = await connect();
  const owing = data(await call("find_clients", { owes_money: true }));
  assert.deepEqual(owing.clients.map((c: any) => [c.name, c.balance]), [["Acme Corp", 4200], ["Bluebird Studio", 1200]]);
  const acme = data(await call("find_clients", { query: "acme" }));
  assert.equal(acme.count, 2);
  assert.equal(acme.clients[0].email, "jane@acme.test");
  await close();
});

test("create_client avoids duplicates and creates new clients", async () => {
  const { call, state, close } = await connect();
  assert.equal(data(await call("create_client", { name: "acme corp" })).action, "existing");
  const created = data(await call("create_client", { name: "Globex", email: "ap@globex.test", first_name: "Hank" }));
  assert.equal(created.action, "created");
  assert.equal(created.client.email, "ap@globex.test");
  assert.equal(state.clients.length, 5);
  assert.equal((await call("create_client", { name: "Bad", email: "not-an-email" })).isError, true);
  await close();
});

test("list_invoices filters by client and status with days overdue", async () => {
  const { call, close } = await connect();
  const acme = data(await call("list_invoices", { client: "Acme Corp", status: "unpaid" }));
  assert.deepEqual(acme.invoices.map((i: any) => [i.number, i.status, i.days_overdue]), [["0042", "partial", undefined], ["0041", "overdue", 54]]);
  assert.equal(acme.total_balance, 4200);
  const overdue = data(await call("list_invoices", { status: "overdue" }));
  assert.deepEqual(overdue.invoices.map((i: any) => [i.number, i.client, i.days_overdue]), [["0041", "Acme Corp", 54], ["0043", "Bluebird Studio", 102]]);
  await close();
});

test("an ambiguous client returns the candidates, not a guess", async () => {
  const { call, close } = await connect();
  const result = await call("list_invoices", { client: "acme" });
  assert.equal(result.isError, true);
  assert.match(text(result), /matches 2 clients: "Acme Corp" <jane@acme\.test>, "Acme Labs" <ops@acmelabs\.test>/);
  assert.match(text(await call("list_invoices", { client: "Initech" })), /No client matches "Initech"/);
  await close();
});

test("get_invoice returns lines, totals and the portal link", async () => {
  const { call, close } = await connect();
  const invoice = data(await call("get_invoice", { invoice: "#0042" }));
  assert.equal(invoice.client_email, "jane@acme.test");
  assert.deepEqual(invoice.items[1], { item: "SUP", description: "Support hours", quantity: 16, unit_price: 100, total: 1600 });
  assert.equal(invoice.link, "https://in.test/client/invoice/i42");
  assert.match(text(await call("get_invoice", { invoice: "0099" })), /No invoice "0099"/);
  await close();
});

test("create_invoice builds line items and keeps a draft by default", async () => {
  const { call, state, close } = await connect();
  const result = data(
    await call("create_invoice", {
      client: "hello@bluebird.test",
      items: [{ description: "Logo animation", unit_price: 450 }, { description: "Revisions", quantity: 2, unit_price: 75 }],
      due_date: "2026-12-24",
    }),
  );
  assert.equal(result.action, "created_as_draft");
  assert.equal(result.invoice.amount, 600);
  assert.equal(result.invoice.status, "draft");
  assert.deepEqual(state.bodies.at(-1), {
    client_id: "c2Blue",
    due_date: "2026-12-24",
    line_items: [
      { product_key: "", notes: "Logo animation", quantity: 1, cost: 450 },
      { product_key: "", notes: "Revisions", quantity: 2, cost: 75 },
    ],
  });
  const noEmail = await call("create_invoice", { client: "Northwind Traders", items: [{ description: "X", unit_price: 1 }], send: true });
  assert.match(text(noEmail), /no contact email/);
  assert.equal((await call("create_invoice", { client: "Acme Corp", items: [], send: false })).isError, true);
  await close();
});

test("send_invoice emails a reminder and refuses paid invoices", async () => {
  const { call, state, close } = await connect();
  const sent = data(await call("send_invoice", { invoice: "0041", template: "reminder1" }));
  assert.deepEqual(sent, { sent: true, template: "reminder1", invoice: "0041", to: "jane@acme.test", balance: 2500 });
  assert.deepEqual(state.bodies.at(-1), { action: "send_email", ids: ["i41"], email_type: "reminder1" });
  data(await call("send_invoice", { invoice: "0042" }));
  assert.deepEqual(state.bodies.at(-1), { action: "email", ids: ["i42"] });
  assert.match(text(await call("send_invoice", { invoice: "0044" })), /is paid; there is nothing to send/);
  await close();
});

test("record_payment handles partial, full and excessive amounts", async () => {
  const { call, close } = await connect();
  const partial = data(await call("record_payment", { invoice: "0041", amount: 1000, reference: "WIRE-881" }));
  assert.deepEqual(partial, { recorded: true, payment: "0007", invoice: "0041", amount: 1000, remaining_balance: 1500, invoice_status: "partial" });
  const full = data(await call("record_payment", { invoice: "0043" }));
  assert.equal(full.amount, 1200);
  assert.equal(full.invoice_status, "paid");
  assert.match(text(await call("record_payment", { invoice: "0041", amount: 9999 })), /more than the balance due on invoice 0041 \(1500\)/);
  assert.match(text(await call("record_payment", { invoice: "0044" })), /no balance due/);
  await close();
});

test("get_receivables_summary computes aging and top debtors", async () => {
  const { call, close } = await connect();
  const summary = data(await call("get_receivables_summary"));
  assert.equal(summary.total_outstanding, 5400);
  assert.equal(summary.total_overdue, 3700);
  assert.deepEqual(summary.aging, { not_due: 1700, "1_30": 0, "31_60": 2500, "61_90": 0, over_90: 1200 });
  assert.deepEqual(summary.top_debtors, [{ client: "Acme Corp", owed: 4200 }, { client: "Bluebird Studio", owed: 1200 }]);
  assert.equal(summary.oldest_overdue[0].number, "0043");
  const acme = data(await call("get_receivables_summary", { client: "Acme Corp" }));
  assert.equal(acme.total_outstanding, 4200);
  await close();
});

test("API failures become tool errors the agent can relay", async () => {
  const state = seed();
  const { call, close } = await connect(state);
  state.failNext = 403;
  const result = await call("find_clients", {});
  assert.equal(result.isError, true);
  assert.match(text(result), /Pro or Enterprise/);
  await close();
});
