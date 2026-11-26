import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeputyApi } from "./api.ts";
import { type ConnectorInfo, HttpClient, type HttpClientOptions } from "./core.ts";
import { registerTools } from "./tools.ts";

export const CONNECTOR: ConnectorInfo = {
  name: "tethlo-mcp-for-deputy",
  version: "0.1.0",
  product: "Deputy",
  prefix: "DEPUTY",
  credentials: [
    { env: "DEPUTY_HOST" },
    { env: "DEPUTY_ACCESS_TOKEN", header: "x-deputy-access-token" },
    { env: "DEPUTY_BASE_URL", optional: true },
  ],
};

const INSTRUCTIONS = [
  "Tools for Deputy, workforce management software: employees, areas (work positions) in locations, shifts (roster),",
  "leave requests and timesheets. Start with get_roster for 'who works when' and find_open_shifts for gaps.",
  "Employees and areas can be named in plain words. Times are returned in UTC (ISO 8601).",
  "create_shift and decide_leave_request notify employees: call them with confirm=false first, show the preview, then confirm=true.",
].join(" ");

export type ApiOverrides = Partial<Pick<HttpClientOptions, "fetch" | "retryDelayMs" | "timeoutMs">>;

export interface ServerOptions {
  writes?: boolean;
  now?: () => Date;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: ApiOverrides = {}): DeputyApi {
  const host = (env.DEPUTY_HOST ?? "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return new DeputyApi(
    new HttpClient({
      service: "Deputy",
      baseUrl: env.DEPUTY_BASE_URL || `https://${host}/api/v1`,
      headers: { Authorization: `Bearer ${env.DEPUTY_ACCESS_TOKEN ?? ""}` },
      explain: (status) =>
        status === 401
          ? "Deputy rejected the token. Create a permanent token for your install and set DEPUTY_ACCESS_TOKEN and DEPUTY_HOST (e.g. yourcompany.na.deputy.com)."
          : status === 403
            ? "Deputy denied access: the user behind the token lacks this permission (managers and admins can see rosters and leave)."
            : undefined,
      ...overrides,
    }),
  );
}

export function createServer(api: DeputyApi, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: CONNECTOR.name, version: CONNECTOR.version }, { instructions: INSTRUCTIONS });
  registerTools(server, api, { writes: options.writes ?? true, now: options.now ?? (() => new Date()) });
  return server;
}
