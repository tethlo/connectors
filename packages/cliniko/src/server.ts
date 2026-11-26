import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClinikoApi, shardOf } from "./api.ts";
import { type ConnectorInfo, HttpClient, type HttpClientOptions } from "./core.ts";
import { registerTools } from "./tools.ts";

export const CONNECTOR: ConnectorInfo = {
  name: "tethlo-mcp-for-cliniko",
  version: "0.1.0",
  product: "Cliniko",
  prefix: "CLINIKO",
  credentials: [
    { env: "CLINIKO_API_KEY", header: "x-cliniko-api-key" },
    { env: "CLINIKO_CONTACT_EMAIL", optional: true },
    { env: "CLINIKO_BASE_URL", optional: true },
  ],
};

const INSTRUCTIONS = [
  "Tools for Cliniko, practice management software for allied health clinics (physio, chiro, osteo, psychology...).",
  "This server only handles scheduling data: patients' contact details and appointments, never clinical notes.",
  "Find the patient with find_patients, check list_practitioners_and_services and find_available_times, then book.",
  "cancel_appointment needs confirm=true after the user approved the preview. Share patient data only with the user.",
].join(" ");

export type ApiOverrides = Partial<Pick<HttpClientOptions, "fetch" | "retryDelayMs" | "timeoutMs">>;

export interface ServerOptions {
  writes?: boolean;
  now?: () => Date;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: ApiOverrides = {}): ClinikoApi {
  const key = env.CLINIKO_API_KEY ?? "";
  const contact = env.CLINIKO_CONTACT_EMAIL ? ` (${env.CLINIKO_CONTACT_EMAIL})` : "";
  return new ClinikoApi(
    new HttpClient({
      service: "Cliniko",
      baseUrl: env.CLINIKO_BASE_URL || `https://api.${shardOf(key)}.cliniko.com/v1`,
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        // Cliniko asks API clients to identify themselves in the User-Agent.
        "User-Agent": `${CONNECTOR.name}/${CONNECTOR.version}${contact}`,
      },
      explain: (status) =>
        status === 401
          ? "Cliniko rejected the API key. Create one in Cliniko > My Info > Manage API keys and set CLINIKO_API_KEY (it ends with the shard, e.g. -au1)."
          : status === 403
            ? "Cliniko denied access: the user who owns the API key lacks this permission."
            : undefined,
      ...overrides,
    }),
  );
}

export function createServer(api: ClinikoApi, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: CONNECTOR.name, version: CONNECTOR.version }, { instructions: INSTRUCTIONS });
  registerTools(server, api, { writes: options.writes ?? true, now: options.now ?? (() => new Date()) });
  return server;
}
