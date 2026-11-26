import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { VeeqoApi } from "./api.ts";
import { type ConnectorInfo, HttpClient, type HttpClientOptions } from "./core.ts";
import { registerTools } from "./tools.ts";

export const CONNECTOR: ConnectorInfo = {
  name: "tethlo-mcp-for-veeqo",
  version: "0.1.0",
  product: "Veeqo",
  prefix: "VEEQO",
  credentials: [
    { env: "VEEQO_API_KEY", header: "x-veeqo-api-key" },
    { env: "VEEQO_BASE_URL", optional: true },
  ],
};

const INSTRUCTIONS = [
  "Tools for Veeqo, inventory and order management for multichannel e-commerce sellers: orders from all sales channels,",
  "products and their variants (sellables, by SKU), stock per warehouse, customers. Use list_orders for the fulfilment queue,",
  "get_low_stock before reordering. set_stock_level overwrites a stock count: call it with confirm=false first, then confirm=true.",
].join(" ");

export type ApiOverrides = Partial<Pick<HttpClientOptions, "fetch" | "retryDelayMs" | "timeoutMs">>;

export interface ServerOptions {
  writes?: boolean;
  now?: () => Date;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: ApiOverrides = {}): VeeqoApi {
  return new VeeqoApi(
    new HttpClient({
      service: "Veeqo",
      baseUrl: env.VEEQO_BASE_URL || "https://api.veeqo.com",
      headers: { "x-api-key": env.VEEQO_API_KEY ?? "" },
      explain: (status) =>
        status === 401
          ? "Veeqo rejected the API key. Create one in Veeqo > Settings > Users > (your user) > Refresh API key, and set VEEQO_API_KEY."
          : undefined,
      ...overrides,
    }),
  );
}

export function createServer(api: VeeqoApi, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: CONNECTOR.name, version: CONNECTOR.version }, { instructions: INSTRUCTIONS });
  registerTools(server, api, { writes: options.writes ?? true, now: options.now ?? (() => new Date()) });
  return server;
}
