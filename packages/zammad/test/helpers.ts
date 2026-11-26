// Shared file (source: shared/ at the repository root). Do not edit a copy.
// Connects an MCP client to the server, backed by the connector's fake API (test/fake-api.ts), with the clock pinned.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { apiFromEnv, createServer } from "../src/server.ts";
import { fakeFetch, NOW, seed, TEST_ENV, type FakeState } from "./fake-api.ts";

export * from "./fake-api.ts";

export async function connect(state: FakeState = seed(), options: { writes?: boolean } = {}) {
  const api = apiFromEnv(TEST_ENV, { fetch: fakeFetch(state), retryDelayMs: 0 });
  const server = createServer(api, { writes: options.writes ?? true, now: () => new Date(NOW) });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { client, call, state, close: () => client.close() };
}

export function data(result: CallToolResult): any {
  if (result.isError) throw new Error(`Tool error: ${text(result)}`);
  return JSON.parse(text(result));
}

export function text(result: CallToolResult): string {
  const first = result.content[0];
  return first && first.type === "text" ? first.text : "";
}
