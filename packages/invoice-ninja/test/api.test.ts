import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, InvoiceNinjaApi } from "../src/api.ts";
import { BASE, fakeFetch, seed, TOKEN } from "./fake-api.ts";

const make = (state = seed(), token = TOKEN) =>
  new InvoiceNinjaApi({ token, baseUrl: `${BASE}/`, fetch: fakeFetch(state), retryDelayMs: 0 });

test("sends the token headers and builds v1 URLs", async () => {
  const state = seed();
  let seen: Headers | undefined;
  const inner = fakeFetch(state);
  const api = new InvoiceNinjaApi({
    token: TOKEN,
    baseUrl: BASE,
    fetch: async (input, init) => {
      seen = new Headers(init?.headers);
      return inner(input, init);
    },
  });
  await api.listInvoices({ client_status: "unpaid", include: "client" });
  assert.equal(seen?.get("X-Requested-With"), "XMLHttpRequest");
  assert.equal(state.calls[0], "GET /api/v1/invoices?per_page=20&sort=date%7Cdesc&client_status=unpaid&include=client");
});

test("explains a bad token", async () => {
  await assert.rejects(make(seed(), "wrong").listClients({}), (error: ApiError) => {
    assert.equal(error.status, 401);
    assert.match(error.message, /API token is missing or invalid/);
    return true;
  });
});

test("turns validation errors into one readable line", async () => {
  await assert.rejects(make().createClient({ name: "", contacts: [] }), /rejected the data: name: The name field is required\./);
});

test("retries a failed read once, never a write", async () => {
  const state = seed();
  state.failNext = 502;
  assert.equal((await make(state).listClients({})).data.length, 4);
  state.failNext = 502;
  await assert.rejects(
    make(state).createPayment({ client_id: "c1Acme", amount: 1, date: "2026-11-24", invoices: [{ invoice_id: "i41", amount: 1 }] }, {}),
    /temporarily unavailable/,
  );
  assert.equal(state.payments.length, 0);
});

test("refuses to start without a token", () => {
  assert.throws(() => new InvoiceNinjaApi({ token: "" }), ApiError);
});
