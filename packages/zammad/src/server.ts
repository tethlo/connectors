import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZammadApi } from "./api.ts";
import { type ConnectorInfo, HttpClient, type HttpClientOptions } from "./core.ts";
import { registerTools } from "./tools.ts";

export const CONNECTOR: ConnectorInfo = {
  name: "tethlo-mcp-for-zammad",
  version: "0.1.0",
  product: "Zammad",
  prefix: "ZAMMAD",
  credentials: [
    { env: "ZAMMAD_URL" },
    { env: "ZAMMAD_TOKEN", header: "x-zammad-token" },
  ],
};

const INSTRUCTIONS = [
  "Tools for Zammad, an open-source helpdesk: tickets with articles (emails, notes), customers, groups (teams).",
  "Use get_queue_summary for the state of the queue, search_tickets to find tickets, get_ticket to read a conversation.",
  "Tickets can be given by number or id. reply_to_customer emails the customer: call it with confirm=false first,",
  "show the draft to the user, then confirm=true. Internal notes are never seen by customers.",
].join(" ");

export type ApiOverrides = Partial<Pick<HttpClientOptions, "fetch" | "retryDelayMs" | "timeoutMs">>;

export interface ServerOptions {
  writes?: boolean;
  now?: () => Date;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: ApiOverrides = {}): ZammadApi {
  const base = (env.ZAMMAD_URL ?? "").replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return new ZammadApi(
    new HttpClient({
      service: "Zammad",
      baseUrl: `${base}/api/v1`,
      headers: { Authorization: `Token token=${env.ZAMMAD_TOKEN ?? ""}` },
      explain: (status) =>
        status === 401
          ? "Zammad rejected the token. Create one in Profile > Token Access (permission ticket.agent) and set ZAMMAD_TOKEN and ZAMMAD_URL."
          : status === 403
            ? "Zammad denied access: the token lacks the ticket.agent permission, or the agent has no access to that group."
            : undefined,
      ...overrides,
    }),
  );
}

export function createServer(api: ZammadApi, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: CONNECTOR.name, version: CONNECTOR.version }, { instructions: INSTRUCTIONS });
  registerTools(server, api, { writes: options.writes ?? true, now: options.now ?? (() => new Date()) });
  return server;
}
