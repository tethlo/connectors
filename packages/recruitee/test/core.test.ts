// Shared file (source: shared/ at the repository root). Do not edit a copy.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, confirmFirst, errorDetail, HttpClient, pickOne, retryAfterMs, ToolError, writesEnabled } from "../src/core.ts";

function scripted(statuses: number[], seen: string[] = []): typeof fetch {
  return async (input, init) => {
    seen.push(`${init?.method ?? "GET"} ${String(input)}`);
    const status = statuses.shift() ?? 200;
    return new Response(status === 200 ? JSON.stringify({ ok: true }) : JSON.stringify({ message: `status ${status}` }), {
      status,
      headers: status === 429 ? { "Retry-After": "0" } : {},
    });
  };
}

const client = (statuses: number[], seen: string[] = []) =>
  new HttpClient({ service: "Example", baseUrl: "https://api.example.test/v1/", headers: { "X-Key": "k" }, fetch: scripted(statuses, seen), retryDelayMs: 0 });

test("backs off and retries on 429, for reads and writes", async () => {
  const seen: string[] = [];
  assert.deepEqual(await client([429, 429, 200], seen).get("/things"), { ok: true });
  assert.equal(seen.length, 3);
  const writes: string[] = [];
  const { status } = await client([429, 200], writes).request("POST", "/things", { body: { a: 1 } });
  assert.equal(status, 200);
  assert.equal(writes.length, 2);
});

test("gives up after the retry budget with an actionable message", async () => {
  await assert.rejects(client([429, 429, 429, 429, 429]).get("/x"), (error: ApiError) => {
    assert.equal(error.status, 429);
    assert.match(error.message, /Rate limited by Example/);
    return true;
  });
});

test("retries 5xx only for GET, never a write", async () => {
  assert.deepEqual(await client([502, 200]).get("/x"), { ok: true });
  const seen: string[] = [];
  await assert.rejects(client([503, 200], seen).request("POST", "/x", { body: {} }), /temporarily unavailable/);
  assert.equal(seen.length, 1);
});

test("builds URLs with repeated array parameters and skips empty values", async () => {
  const seen: string[] = [];
  await client([200], seen).get("/items", { "status[]": ["a", "b"], q: "x y", empty: "", none: undefined });
  assert.equal(seen[0], "GET https://api.example.test/v1/items?status%5B%5D=a&status%5B%5D=b&q=x+y");
});

test("network failures become ApiError", async () => {
  const failing = new HttpClient({ service: "Example", baseUrl: "https://x.test", headers: {}, retryDelayMs: 0, fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(failing.get("/x"), (error: ApiError) => error.status === 0 && /request to Example failed/.test(error.message));
});

test("error details are extracted from common shapes", () => {
  assert.equal(errorDetail(JSON.stringify({ errors: [{ detail: "bad date" }] })), "bad date");
  assert.equal(errorDetail(JSON.stringify({ errors: { name: ["is required"] } })), "name: is required");
  assert.equal(errorDetail(JSON.stringify({ message: "nope" })), "nope");
  assert.equal(errorDetail("<h1>Bad</h1> gateway"), "Bad gateway");
  assert.equal(retryAfterMs("2"), 2000);
  assert.equal(retryAfterMs(null), undefined);
});

test("confirmation, picking and read-only helpers", () => {
  const preview = confirmFirst("Cancel #12", { id: 12 });
  assert.equal(preview.done, false);
  assert.equal(preview.needs_confirmation, true);
  assert.equal(pickOne("a", [1], String, "item", ""), 1);
  assert.throws(() => pickOne("a", [1, 2], String, "item", ""), (e: ToolError) => /matches 2 items/.test(e.message));
  assert.throws(() => pickOne("zz", [], String, "item", "Search first."), /No item matches "zz". Search first./);
  assert.equal(writesEnabled({}, "X"), true);
  assert.equal(writesEnabled({ X_READ_ONLY: "true" }, "X"), false);
});
