import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HousecallProApi } from "./api.ts";
import { type ConnectorInfo, HttpClient, type HttpClientOptions } from "./core.ts";
import { registerTools } from "./tools.ts";

export const CONNECTOR: ConnectorInfo = {
  name: "tethlo-mcp-for-housecall-pro",
  version: "0.1.0",
  product: "Housecall Pro",
  prefix: "HOUSECALLPRO",
  credentials: [
    { env: "HOUSECALLPRO_API_KEY", header: "x-housecallpro-api-key" },
    { env: "HOUSECALLPRO_BASE_URL", optional: true },
  ],
};

const INSTRUCTIONS = [
  "Tools for Housecall Pro, field service management software for home service businesses (plumbing, HVAC, cleaning...):",
  "customers, jobs on the schedule, estimates and technicians (employees). Use get_schedule_summary for 'what does the day look like?',",
  "list_jobs for details. Amounts are returned in dollars (the API uses cents). Customers can be named in plain words.",
].join(" ");

export type ApiOverrides = Partial<Pick<HttpClientOptions, "fetch" | "retryDelayMs" | "timeoutMs">>;

export interface ServerOptions {
  writes?: boolean;
  now?: () => Date;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: ApiOverrides = {}): HousecallProApi {
  return new HousecallProApi(
    new HttpClient({
      service: "Housecall Pro",
      baseUrl: env.HOUSECALLPRO_BASE_URL || "https://api.housecallpro.com",
      headers: { Authorization: `Token ${env.HOUSECALLPRO_API_KEY ?? ""}` },
      explain: (status) =>
        status === 401
          ? "Housecall Pro rejected the API key. An admin creates one in My Apps > API Key Management (MAX plan) and sets HOUSECALLPRO_API_KEY."
          : status === 403
            ? "Housecall Pro denied access: the key may be read-only, or the plan does not include the public API."
            : undefined,
      ...overrides,
    }),
  );
}

export function createServer(api: HousecallProApi, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: CONNECTOR.name, version: CONNECTOR.version }, { instructions: INSTRUCTIONS });
  registerTools(server, api, { writes: options.writes ?? true, now: options.now ?? (() => new Date()) });
  return server;
}
