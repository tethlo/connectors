import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../src/http.ts";
import { BASE, fakeFetch, KEY, seed } from "./fake-api.ts";

let server: Server;
let url: string;

before(async () => {
  ({ server, url } = await startHttpServer({
    port: 0,
    env: { HEALTHCHECKS_BASE_URL: BASE, HEALTHCHECKS_API_KEY: KEY, MCP_ACCESS_TOKEN: "secret-token" },
    api: { fetch: fakeFetch(seed()), retryDelayMs: 0 },
  }));
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function clientWith(headers: Record<string, string>) {
  const client = new Client({ name: "http-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}

test("serves MCP over streamable HTTP with a per-user key", async () => {
  const client = await clientWith({ "X-Healthchecks-Api-Key": KEY });
  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);
  const result = await client.callTool({ name: "list_checks", arguments: { status: ["down"] } });
  assert.match(JSON.stringify(result.content), /Nightly DB backup/);
  await client.close();
});

test("accepts the server key behind the access token", async () => {
  const client = await clientWith({ Authorization: "Bearer secret-token" });
  assert.equal((await client.listTools()).tools.length, 7);
  await client.close();
});

test("rejects requests without credentials", async () => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer wrong" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
});

test("answers health checks and refuses GET on /mcp", async () => {
  const health = await fetch(url.replace("/mcp", "/health"));
  assert.deepEqual(await health.json(), { ok: true, name: "tethlo-mcp-for-healthchecks-io", version: "0.1.0" });
  assert.equal((await fetch(url)).status, 405);
});
