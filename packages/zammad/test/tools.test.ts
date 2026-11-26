import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFromEnv } from "../src/server.ts";
import { connect, data, text } from "./helpers.ts";

test("the instance URL may be given with or without /api/v1", async () => {
  const seen: string[] = [];
  const api = apiFromEnv({ ZAMMAD_URL: "https://desk.example.test/api/v1/", ZAMMAD_TOKEN: "t" }, { fetch: async (input) => (seen.push(String(input)), new Response("[]")) });
  await api.groups();
  assert.equal(seen[0], "https://desk.example.test/api/v1/groups");
});

test("queue summary counts open tickets and ages", async () => {
  const { call, close } = await connect();
  const q = data(await call("get_queue_summary"));
  assert.equal(q.open, 3);
  assert.deepEqual(q.by_group, { Support: 2, Billing: 1 });
  assert.equal(q.high_priority[0].number, "31001");
  assert.deepEqual(q.oldest[0], { number: "31003", title: "Feature request: CSV export", age_hours: 96 });
  await close();
});

test("get_ticket returns plain text and keeps internal notes flagged", async () => {
  const { call, close } = await connect();
  const t = data(await call("get_ticket", { ticket: "31002" }));
  assert.equal(t.messages[0].text, "I get error 500 when I log in.");
  const billing = data(await call("get_ticket", { ticket: 1 }));
  assert.equal(billing.messages[1].internal, true);
  assert.match(text(await call("get_ticket", { ticket: "99999" })), /No ticket "99999"/);
  await close();
});

test("reply_to_customer emails the last customer address and can close the ticket", async () => {
  const { call, state, close } = await connect();
  const preview = data(await call("reply_to_customer", { ticket: "31001", message: "Done." }));
  assert.equal(preview.draft, "Done.");
  const sent = data(await call("reply_to_customer", { ticket: "31001", message: "Done.", set_state: "closed", confirm: true }));
  assert.equal(sent.sent_to, "Jane Doe <jane@acme.test>");
  assert.equal(sent.ticket.state, "closed");
  assert.equal(state.articles[1].at(-1)!.type, "email");
  assert.match(text(await call("reply_to_customer", { ticket: "31003", message: "x", confirm: true })), /no customer email/);
  await close();
});

test("create_ticket checks the group and update_ticket needs a change", async () => {
  const { call, close } = await connect();
  assert.match(text(await call("create_ticket", { title: "Hello", customer_email: "a@b.test", group: "Sales", message: "x" })), /No group matches "Sales"/);
  assert.match(text(await call("update_ticket", { ticket: "31001" })), /Nothing to change/);
  await close();
});
