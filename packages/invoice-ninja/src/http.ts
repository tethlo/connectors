// Remote mode: MCP over Streamable HTTP (stateless), for ChatGPT, Claude.ai connectors and hosted agents.
//
// Two ways to authenticate (OAuth is the production path, see README):
// - per user: each request carries the user's own API token in the `X-InvoiceNinja-Api-Token` header;
// - single tenant: INVOICENINJA_API_TOKEN is set on the server and clients send `Authorization: Bearer <MCP_ACCESS_TOKEN>`.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { InvoiceNinjaApiOptions } from "./api.ts";
import { apiFromEnv, createServer, SERVER_INFO } from "./server.ts";
import type { ToolOptions } from "./tools.ts";

export interface HttpOptions {
  port?: number;
  host?: string;
  env?: NodeJS.ProcessEnv;
  /** Extra API options (tests inject a fake fetch). */
  api?: Partial<InvoiceNinjaApiOptions>;
  /** Tool options (tests pin today's date). */
  tools?: ToolOptions;
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

/** Returns the Invoice Ninja token to use for this request, or null after answering 401. */
function authenticate(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): string | null {
  const userKey = req.headers["x-invoiceninja-api-token"];
  if (typeof userKey === "string" && userKey) return userKey;
  const serverKey = env.INVOICENINJA_API_TOKEN;
  const accessToken = env.MCP_ACCESS_TOKEN;
  const bearer = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (serverKey && accessToken && bearer && sameSecret(bearer, accessToken)) return serverKey;
  res.setHeader("WWW-Authenticate", 'Bearer realm="tethlo-mcp-for-invoice-ninja"');
  rpcError(res, 401, "Missing credentials: send X-InvoiceNinja-Api-Token, or Authorization: Bearer <MCP_ACCESS_TOKEN>.");
  return null;
}

export function startHttpServer(options: HttpOptions = {}): Promise<{ server: Server; url: string }> {
  const env = options.env ?? process.env;
  const httpServer = createHttpServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (path === "/health" && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...SERVER_INFO });
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
    const token = authenticate(req, res, env);
    if (!token) return;
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null });
      return;
    }
    try {
      const mcp = createServer(apiFromEnv(env, { ...options.api, token }), options.tools);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST ?? "127.0.0.1";
  if (process.env.INVOICENINJA_API_TOKEN && !process.env.MCP_ACCESS_TOKEN) {
    console.error("INVOICENINJA_API_TOKEN is set: also set MCP_ACCESS_TOKEN so that only your clients can use this token.");
    process.exit(1);
  }
  const { url } = await startHttpServer({ port: Number(process.env.PORT ?? 3000), host });
  console.error(`tethlo-mcp-for-invoice-ninja listening on ${url}`);
}
