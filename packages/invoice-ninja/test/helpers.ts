import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { InvoiceNinjaApi } from "../src/api.ts";
import { createServer } from "../src/server.ts";
import { BASE, fakeFetch, seed, TODAY, TOKEN, type FakeState } from "./fake-api.ts";

/** Connects an MCP client to the server, backed by the fake Invoice Ninja API, with today pinned. */
export async function connect(state: FakeState = seed()) {
  const api = new InvoiceNinjaApi({ token: TOKEN, baseUrl: BASE, fetch: fakeFetch(state), retryDelayMs: 0 });
  const server = createServer(api, { today: () => TODAY });
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
