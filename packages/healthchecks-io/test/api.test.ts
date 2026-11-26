import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, HealthchecksApi } from "../src/api.ts";
import { BASE, fakeFetch, KEY, seed } from "./fake-api.ts";

const make = (state = seed(), apiKey = KEY) =>
  new HealthchecksApi({ apiKey, baseUrl: `${BASE}/`, fetch: fakeFetch(state), retryDelayMs: 0 });

test("sends the key and builds v3 URLs with tag filters", async () => {
  const state = seed();
  const checks = await make(state).listChecks({ tags: ["prod", "backup"] });
  assert.deepEqual(checks.map((c) => c.slug), ["db-backup"]);
  assert.equal(state.calls[0], "GET /api/v3/checks/?tag=prod&tag=backup");
});

test("explains a bad key in words the agent can relay", async () => {
  await assert.rejects(make(seed(), "wrong").listChecks(), (error: ApiError) => {
    assert.equal(error.status, 401);
    assert.match(error.message, /API key is missing or invalid/);
    return true;
  });
});

test("refuses to start without a key", () => {
  assert.throws(() => new HealthchecksApi({ apiKey: "" }), ApiError);
});

test("maps 404 and 409 to actionable messages", async () => {
  const api = make();
  await assert.rejects(api.getCheck("00000000-0000-4000-8000-999999999999"), /call list_checks/);
  await assert.rejects(api.resumeCheck("00000000-0000-4000-8000-000000000002"), /not paused/);
});

test("retries once on 503, then succeeds", async () => {
  const state = seed();
  state.failNext = 503;
  const checks = await make(state).listChecks();
  assert.equal(checks.length, 5);
  assert.equal(state.calls.length, 2);
});

test("reports a network failure without leaking internals", async () => {
  const api = new HealthchecksApi({
    apiKey: KEY,
    fetch: async () => {
      throw new TypeError("fetch failed: ECONNREFUSED 10.0.0.1");
    },
  });
  await assert.rejects(api.listChecks(), (error: ApiError) => {
    assert.equal(error.status, 0);
    assert.doesNotMatch(error.message, /10\.0\.0\.1/);
    return true;
  });
});

test("returns null for a ping without body", async () => {
  const api = make();
  assert.equal(await api.getPingBody("00000000-0000-4000-8000-000000000002", 30), null);
  assert.match((await api.getPingBody("00000000-0000-4000-8000-000000000001", 12)) ?? "", /pg_dump/);
});
