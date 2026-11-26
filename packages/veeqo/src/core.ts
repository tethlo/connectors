// Shared runtime for the "unofficial" MCP connectors: HTTP client with rate-limit backoff, tool helpers.
// Identical in every connector (source: shared/ at the repository root, copied by scripts/sync-shared.mjs). Do not edit a copy.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

/** An error from the remote API, with a message the agent can act on. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** A problem with the agent's input that it can fix (unknown name, ambiguous match, missing confirmation...). */
export class ToolError extends Error {}

export type Query = Record<string, string | number | boolean | undefined | null | Array<string | number>>;

export interface HttpClientOptions {
  /** Product name used in messages, e.g. "Acuity Scheduling". */
  service: string;
  baseUrl: string;
  headers: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Base delay of the exponential backoff. Tests set it to 0. */
  retryDelayMs?: number;
  /** Retries after a 429 (any method) or a 5xx / network error (GET only). */
  maxRetries?: number;
  /** Service-specific wording for an HTTP status; return undefined to use the generic one. */
  explain?: (status: number, detail: string) => string | undefined;
}

export interface RequestOptions {
  query?: Query;
  body?: unknown;
  /** Content type of the body. Default: application/json. */
  contentType?: string;
}

const MAX_WAIT_MS = 30_000;

function genericMessage(service: string, status: number, detail: string): string {
  switch (status) {
    case 400:
    case 422:
      return `${service} rejected the request: ${detail || "invalid parameters"}.`;
    case 401:
      return `The ${service} credentials are missing or invalid. Check the environment variables in the README.`;
    case 403:
      return `Access denied by ${service}: the user behind the key lacks this permission, or the plan does not include API access.`;
    case 404:
      return `Not found in ${service}. It may have been deleted; search again first.`;
    case 409:
      return `${service} reported a conflict: ${detail || "the record changed"}. Read it again, then retry.`;
    case 429:
      return `Rate limited by ${service} after several retries. Wait a minute, then try again.`;
    default:
      return status >= 500
        ? `${service} is temporarily unavailable (HTTP ${status}). Retry in a few minutes.`
        : `Unexpected response from ${service} (HTTP ${status})${detail ? `: ${detail}` : ""}.`;
  }
}

/** Pulls a readable message out of the usual JSON error shapes. */
export function errorDetail(text: string): string {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const parts: string[] = [];
    const add = (value: unknown) => {
      if (typeof value === "string" && value) parts.push(value);
      else if (Array.isArray(value)) value.forEach(add);
      else if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        if (typeof obj.detail === "string") parts.push(obj.detail);
        else if (typeof obj.message === "string") parts.push(obj.message);
        else if (typeof obj.title === "string") parts.push(obj.title);
        else for (const [key, val] of Object.entries(obj)) parts.push(`${key}: ${Array.isArray(val) ? val.join(" ") : String(val)}`);
      }
    };
    add(body.errors ?? body.message ?? body.error ?? body.detail);
    return parts.join("; ").slice(0, 300);
  } catch {
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  }
}

function toSearch(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const item of value) params.append(key, String(item));
    else params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** Seconds or HTTP date from Retry-After, in ms. */
export function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export class HttpClient {
  readonly service: string;
  readonly #baseUrl: string;
  readonly #headers: Record<string, string>;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;
  readonly #maxRetries: number;
  readonly #explain?: HttpClientOptions["explain"];

  constructor(options: HttpClientOptions) {
    this.service = options.service;
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#headers = options.headers;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#retryDelayMs = options.retryDelayMs ?? 500;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#explain = options.explain;
  }

  #wait(attempt: number, retryAfter?: number): Promise<void> {
    if (this.#retryDelayMs === 0) return Promise.resolve();
    const backoff = this.#retryDelayMs * 2 ** attempt * (0.75 + Math.random() / 2);
    const ms = Math.min(MAX_WAIT_MS, retryAfter ?? backoff);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  #fail(status: number, detail: string): ApiError {
    return new ApiError(status, this.#explain?.(status, detail) ?? genericMessage(this.service, status, detail));
  }

  /** Sends a request. 429 is retried for every method (the server did not process it); 5xx and network errors only for GET. */
  async request<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<{ status: number; data: T }> {
    const url = `${this.#baseUrl}${path}${toSearch(options.query)}`;
    const hasBody = options.body !== undefined;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method,
          headers: {
            Accept: "application/json",
            ...this.#headers,
            ...(hasBody ? { "Content-Type": options.contentType ?? "application/json" } : {}),
          },
          body: hasBody ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        if (method === "GET" && attempt < this.#maxRetries) {
          await this.#wait(attempt);
          continue;
        }
        const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
        throw new ApiError(0, `The request to ${this.service} ${reason}. Check the network and the base URL setting, then retry.`);
      }
      const retryable = res.status === 429 || (res.status >= 500 && method === "GET");
      if (retryable && attempt < this.#maxRetries) {
        await res.body?.cancel();
        await this.#wait(attempt, retryAfterMs(res.headers.get("Retry-After")));
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw this.#fail(res.status, errorDetail(text));
      if (!text) return { status: res.status, data: null as T };
      try {
        return { status: res.status, data: JSON.parse(text) as T };
      } catch {
        throw new ApiError(res.status, `${this.service} returned a response that is not JSON. Check the base URL setting.`);
      }
    }
  }

  get<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, { query }).then((r) => r.data);
  }
}

// ---------------------------------------------------------------- tools

export type ToolKind = "read" | "write" | "send" | "destructive";

export interface ToolSpec<Shape extends ZodRawShape> {
  title: string;
  description: string;
  input: Shape;
  /** read: no change. write: creates/updates. send: notifies a person. destructive: deletes, cancels or refunds. */
  kind: ToolKind;
  /** Repeating the same call has no extra effect. */
  idempotent?: boolean;
}

export interface ToolContext {
  server: McpServer;
  /** False when <PREFIX>_READ_ONLY=true: write tools are not registered at all. */
  writes: boolean;
  /** Errors not caused by the API or the input get this generic text. */
  service: string;
}

function ok(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

export async function run(service: string, fn: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    const message =
      error instanceof ApiError || error instanceof ToolError
        ? error.message
        : `Unexpected error in the ${service} MCP server. Retry once; if it persists, open an issue on the project page.`;
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

/** Registers a tool with annotations derived from its kind; skips write tools in read-only mode. */
export function defineTool<Shape extends ZodRawShape>(
  ctx: ToolContext,
  name: string,
  spec: ToolSpec<Shape>,
  handler: (args: any) => Promise<Record<string, unknown>>,
): void {
  if (spec.kind !== "read" && !ctx.writes) return;
  const annotations =
    spec.kind === "read"
      ? { readOnlyHint: true, openWorldHint: true }
      : { readOnlyHint: false, destructiveHint: spec.kind === "destructive", idempotentHint: spec.idempotent ?? false, openWorldHint: true };
  ctx.server.registerTool(
    name,
    { title: spec.title, description: spec.description, inputSchema: spec.input, annotations },
    (async (args: unknown) => run(ctx.service, () => handler(args))) as never,
  );
}

/** For send/destructive tools: without confirm=true, describe what would happen and do nothing. */
export function confirmFirst(action: string, details: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    done: false,
    needs_confirmation: true,
    would: action,
    ...details,
    next: "Nothing was changed. Show this to the user; if they agree, call the same tool again with confirm: true.",
  };
}

/** Picks one record from candidates matched by a human reference, or explains the ambiguity. */
export function pickOne<T>(ref: string, candidates: T[], label: (item: T) => string, what: string, hint: string): T {
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) throw new ToolError(`No ${what} matches "${ref}". ${hint}`);
  throw new ToolError(
    `"${ref}" matches ${candidates.length} ${what.endsWith("y") ? `${what.slice(0, -1)}ies` : `${what}s`}: ${candidates.slice(0, 8).map(label).join(", ")}. Ask the user which one, then use its id.`,
  );
}

export const money = (value: number) => Math.round(value * 100) / 100;
export const fromCents = (value: number | null | undefined) => money((value ?? 0) / 100);

/** True unless <PREFIX>_READ_ONLY is "true" or "1". */
export function writesEnabled(env: NodeJS.ProcessEnv, prefix: string): boolean {
  return !["true", "1", "yes"].includes(String(env[`${prefix}_READ_ONLY`] ?? "").toLowerCase());
}

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- connector description

export interface Credential {
  /** Environment variable, e.g. ACUITY_API_KEY. */
  env: string;
  /** HTTP header carrying the same value in per-user remote mode, e.g. x-acuity-api-key. Omitted: server-side setting only. */
  header?: string;
  /** Optional settings (base URL, account id...) are not required to start. */
  optional?: boolean;
}

export interface ConnectorInfo {
  /** npm package name, also the MCP server name. */
  name: string;
  version: string;
  /** Product name, e.g. "Acuity Scheduling". */
  product: string;
  /** Environment variable prefix, e.g. ACUITY. */
  prefix: string;
  credentials: Credential[];
}

export function missingCredentials(info: ConnectorInfo, env: NodeJS.ProcessEnv): string[] {
  return info.credentials.filter((c) => !c.optional && !env[c.env]).map((c) => c.env);
}
