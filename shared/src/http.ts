// Remote mode: MCP over Streamable HTTP (stateless, JSON responses), for hosted agents and remote MCP clients.
// Shared file (source: shared/ at the repository root). Do not edit a copy.
//
// Two ways to authenticate:
// - per user: each request carries the user's own credentials in the headers listed in the README;
//   nothing is kept between requests;
// - single tenant: the credentials are set on the server and clients send "Authorization: Bearer <MCP_ACCESS_TOKEN>".
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { missingCredentials, writesEnabled } from "./core.ts";
import { apiFromEnv, type ApiOverrides, CONNECTOR, createServer } from "./server.ts";

export interface HttpOptions {
  port?: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
  /** Extra API options (tests inject a fake fetch). */
  api?: ApiOverrides;
}

const MAX_BODY_BYTES = 1_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code: -32000, message }, id: null });
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Credential headers accepted in per-user mode, e.g. ["x-acuity-user-id", "x-acuity-api-key"]. */
export const CREDENTIAL_HEADERS = CONNECTOR.credentials.filter((c) => c.header).map((c) => c.header as string);

/** Returns the environment to use for this request, or null after answering 401. */
function authenticate(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv | null {
  const fromHeaders: NodeJS.ProcessEnv = {};
  for (const credential of CONNECTOR.credentials) {
    const value = credential.header ? req.headers[credential.header] : undefined;
    if (typeof value === "string" && value) fromHeaders[credential.env] = value;
  }
  if (Object.keys(fromHeaders).length) {
    // Server-side settings (base URL, read-only mode) stay; credentials come only from this request.
    const settings: NodeJS.ProcessEnv = { ...env };
    for (const credential of CONNECTOR.credentials) if (credential.header) delete settings[credential.env];
    const merged = { ...settings, ...fromHeaders };
    if (!missingCredentials(CONNECTOR, merged).length) return merged;
  }
  const accessToken = env.MCP_ACCESS_TOKEN;
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (accessToken && bearer && sameSecret(bearer, accessToken) && !missingCredentials(CONNECTOR, env).length) return env;
  res.setHeader("WWW-Authenticate", `Bearer realm="${CONNECTOR.name}"`);
  rpcError(res, 401, `Missing credentials: send ${CREDENTIAL_HEADERS.join(" and ")}, or Authorization: Bearer <MCP_ACCESS_TOKEN>.`);
  return null;
}

export function startHttpServer(options: HttpOptions = {}): Promise<{ server: Server; url: string }> {
  const env = options.env ?? process.env;
  const httpServer = createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, name: CONNECTOR.name, version: CONNECTOR.version });
      return;
    }
    if (path !== "/mcp") {
      sendJson(res, 404, { error: "Not found. The MCP endpoint is /mcp." });
      return;
    }
    if (req.method !== "POST") {
      // Stateless server: no SSE stream to resume and no session to delete.
      res.setHeader("Allow", "POST");
      rpcError(res, 405, "Method not allowed. Send JSON-RPC requests with POST.");
      return;
    }
    const requestEnv = authenticate(req, res, env);
    if (!requestEnv) return;
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      return;
    }
    try {
      const mcp = createServer(apiFromEnv(requestEnv, options.api), { writes: writesEnabled(requestEnv, CONNECTOR.prefix) });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) rpcError(res, 500, "Internal server error");
    }
  });
  return new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 3000, options.host ?? "127.0.0.1", () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({ server: httpServer, url: `http://${options.host ?? "127.0.0.1"}:${port}/mcp` });
    });
  });
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const hasServerCredentials = !missingCredentials(CONNECTOR, env).length;
  if (hasServerCredentials && !env.MCP_ACCESS_TOKEN) {
    console.error("Credentials are set on the server: also set MCP_ACCESS_TOKEN so that only your clients can use them.");
    process.exit(1);
  }
  const host = env.HOST ?? "127.0.0.1";
  const { url } = await startHttpServer({ port: Number(env.PORT ?? 3000), host, env });
  console.error(`${CONNECTOR.name} listening on ${url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
