// Shared file (source: shared/ at the repository root). Do not edit a copy.
// stdio and Streamable HTTP transports, with the connector's fake API.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../src/http.ts";
import { CONNECTOR } from "../src/server.ts";
import { EXPECTED_TOOLS, fakeFetch, HTTP_PROBE, PER_USER_HEADERS, seed, TEST_ENV } from "./helpers.ts";

const stdioEntry = fileURLToPath(new URL("../src/stdio.ts", import.meta.url));

test("stdio: starts and lists its tools", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--no-warnings", stdioEntry],
    env: { PATH: process.env.PATH ?? "", ...TEST_ENV },
    stderr: "ignore",
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort());
  assert.ok((client.getInstructions() ?? "").length > 50);
  assert.equal(client.getServerVersion()?.name, CONNECTOR.name);
  await client.close();
});

test("stdio: refuses to start without credentials and names the variables", () => {
  const result = spawnSync(process.execPath, ["--no-warnings", stdioEntry], { env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 20_000 });
  assert.equal(result.status, 1);
  for (const credential of CONNECTOR.credentials.filter((c) => !c.optional)) assert.match(result.stderr, new RegExp(credential.env));
});

let server: Server;
let url: string;

before(async () => {
  ({ server, url } = await startHttpServer({
    port: 0,
    env: { ...TEST_ENV, MCP_ACCESS_TOKEN: "secret-token" },
    api: { fetch: fakeFetch(seed()), retryDelayMs: 0 },
  }));
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function clientWith(headers: Record<string, string>) {
  const client = new Client({ name: "http-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}

test("http: serves MCP with per-user credentials in headers", async () => {
  const client = await clientWith(PER_USER_HEADERS);
  assert.equal((await client.listTools()).tools.length, EXPECTED_TOOLS.length);
  const result = await client.callTool({ name: HTTP_PROBE.tool, arguments: HTTP_PROBE.args });
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  assert.match(JSON.stringify(result.content), HTTP_PROBE.expect);
  await client.close();
});

test("http: accepts the server credentials behind the access token", async () => {
  const client = await clientWith({ Authorization: "Bearer secret-token" });
  assert.equal((await client.listTools()).tools.length, EXPECTED_TOOLS.length);
  await client.close();
});

test("http: rejects requests without credentials", async () => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer wrong" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate") ?? "", /Bearer/);
});

test("http: health check, 405 on GET, 404 elsewhere", async () => {
  const health = await fetch(url.replace("/mcp", "/health"));
  assert.deepEqual(await health.json(), { ok: true, name: CONNECTOR.name, version: CONNECTOR.version });
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await fetch(url.replace("/mcp", "/other"))).status, 404);
});
