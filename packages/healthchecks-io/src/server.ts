import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HealthchecksApi, type HealthchecksApiOptions } from "./api.ts";
import { registerTools } from "./tools.ts";

export const SERVER_INFO = { name: "tethlo-mcp-for-healthchecks-io", version: "0.1.0" } as const;

const INSTRUCTIONS = [
  "Tools for Healthchecks.io, a monitoring service for cron jobs and scheduled tasks.",
  "A 'check' expects a ping from a job on a schedule; it goes 'down' when the ping is late or the job reports a failure.",
  "Start with diagnose_failures when the user asks what is broken, and list_checks for an overview.",
  "Checks can be named in plain words: tools accept a name, a slug or an id.",
  "Never call delete_check without an explicit confirmation from the user.",
].join(" ");

export function createServer(api: HealthchecksApi): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerTools(server, api);
  return server;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: Partial<HealthchecksApiOptions> = {}): HealthchecksApi {
  return new HealthchecksApi({
    apiKey: overrides.apiKey ?? env.HEALTHCHECKS_API_KEY ?? "",
    baseUrl: overrides.baseUrl ?? env.HEALTHCHECKS_BASE_URL,
    ...overrides,
  });
}
