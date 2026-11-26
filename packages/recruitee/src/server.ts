import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RecruiteeApi } from "./api.ts";
import { type ConnectorInfo, HttpClient, type HttpClientOptions } from "./core.ts";
import { registerTools } from "./tools.ts";

export const CONNECTOR: ConnectorInfo = {
  name: "tethlo-mcp-for-recruitee",
  version: "0.1.0",
  product: "Recruitee",
  prefix: "RECRUITEE",
  credentials: [
    { env: "RECRUITEE_COMPANY_ID", header: "x-recruitee-company-id" },
    { env: "RECRUITEE_API_TOKEN", header: "x-recruitee-api-token" },
    { env: "RECRUITEE_BASE_URL", optional: true },
  ],
};

const INSTRUCTIONS = [
  "Tools for Recruitee, an applicant tracking system (ATS): jobs (offers), candidates and their placement in each job's",
  "pipeline stages, notes. Use get_hiring_summary for the overview, get_job_pipeline for one job, search_candidates to find people.",
  "Jobs and stages can be named in plain words. move_candidate can trigger automated emails set up in Recruitee:",
  "call it with confirm=false first, show the preview, then confirm=true. Candidate data is personal data: share it only with the user.",
].join(" ");

export type ApiOverrides = Partial<Pick<HttpClientOptions, "fetch" | "retryDelayMs" | "timeoutMs">>;

export interface ServerOptions {
  writes?: boolean;
  now?: () => Date;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: ApiOverrides = {}): RecruiteeApi {
  const base = env.RECRUITEE_BASE_URL || "https://api.recruitee.com";
  return new RecruiteeApi(
    new HttpClient({
      service: "Recruitee",
      baseUrl: `${base.replace(/\/+$/, "")}/c/${encodeURIComponent(env.RECRUITEE_COMPANY_ID ?? "")}`,
      headers: { Authorization: `Bearer ${env.RECRUITEE_API_TOKEN ?? ""}` },
      explain: (status) =>
        status === 401
          ? "Recruitee rejected the token. Create a personal API token (Settings > Apps and plugins > Personal API tokens) and set RECRUITEE_API_TOKEN and RECRUITEE_COMPANY_ID."
          : status === 403
            ? "Recruitee denied access: the user behind the token lacks access to this job or action."
            : undefined,
      ...overrides,
    }),
  );
}

export function createServer(api: RecruiteeApi, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: CONNECTOR.name, version: CONNECTOR.version }, { instructions: INSTRUCTIONS });
  registerTools(server, api, { writes: options.writes ?? true, now: options.now ?? (() => new Date()) });
  return server;
}
