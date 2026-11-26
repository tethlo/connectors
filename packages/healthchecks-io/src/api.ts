// Thin, typed client for the Healthchecks.io Management API v3.
// Docs: https://healthchecks.io/docs/api/

export type CheckStatus = "new" | "up" | "grace" | "down" | "paused";

export interface Check {
  name: string;
  slug: string;
  tags: string;
  desc: string;
  grace: number;
  n_pings: number;
  status: CheckStatus;
  started: boolean;
  last_ping: string | null;
  next_ping: string | null;
  manual_resume: boolean;
  /** Present with a read-write key. */
  uuid?: string;
  ping_url?: string;
  channels?: string;
  /** Present with a read-only key instead of uuid. */
  unique_key?: string;
  /** Simple checks. */
  timeout?: number;
  /** Cron / OnCalendar checks. */
  schedule?: string;
  tz?: string;
}

export interface Ping {
  type: "success" | "start" | "fail" | "log" | "ign" | "exitstatus";
  date: string;
  n: number;
  scheme: string;
  method: string;
  ua: string;
  duration?: number;
  exitstatus?: number;
  body_url: string | null;
}

export interface Flip {
  timestamp: string;
  up: 0 | 1;
}

export interface Channel {
  id: string;
  name: string;
  kind: string;
}

export interface CheckInput {
  name: string;
  slug?: string;
  tags?: string;
  desc?: string;
  timeout?: number;
  grace?: number;
  schedule?: string;
  tz?: string;
  channels?: string;
  unique?: Array<"name" | "slug" | "tags" | "timeout" | "grace">;
}

/** An error the agent can act on: the message says what went wrong and what to do next. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface HealthchecksApiOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Delay before the single retry on 429 / 5xx. Tests set it to 0. */
  retryDelayMs?: number;
}

const DEFAULT_BASE_URL = "https://healthchecks.io";

function explain(status: number, path: string, detail: string): string {
  switch (status) {
    case 400:
      return `Healthchecks.io rejected the request: ${detail || "invalid parameters"}.`;
    case 401:
      return "The Healthchecks.io API key is missing or invalid. Create one in Project Settings > API Access.";
    case 403:
      return path.startsWith("/checks/") && path.length > 8
        ? "Access denied. This needs a read-write API key for the project that owns the check (read-only keys can only list and read checks)."
        : "Access denied or plan limit reached (the free plan allows 20 checks). Use a read-write key or remove unused checks.";
    case 404:
      return "Not found. The check may have been deleted; call list_checks to see current checks.";
    case 409:
      return "Conflict: the check is not paused, so it cannot be resumed.";
    case 429:
      return "Rate limited by Healthchecks.io (about 100 requests per minute). Wait a minute, then retry.";
    default:
      return status >= 500
        ? `Healthchecks.io is temporarily unavailable (HTTP ${status}). Retry in a few minutes.`
        : `Unexpected response from Healthchecks.io (HTTP ${status}).`;
  }
}

export class HealthchecksApi {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;

  constructor(options: HealthchecksApiOptions) {
    if (!options.apiKey) throw new ApiError(401, explain(401, "", ""));
    this.#apiKey = options.apiKey;
    this.#baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#retryDelayMs = options.retryDelayMs ?? 1_000;
  }

  async #request(method: string, path: string, body?: unknown, accept = "json"): Promise<{ status: number; data: unknown }> {
    const url = `${this.#baseUrl}/api/v3${path}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method,
          headers: {
            "X-Api-Key": this.#apiKey,
            Accept: accept === "json" ? "application/json" : "text/plain",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? (method === "POST" ? "" : undefined) : JSON.stringify(body),
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
        throw new ApiError(0, `The request to Healthchecks.io ${reason}. Check the network or HEALTHCHECKS_BASE_URL, then retry.`);
      }
      if ((res.status === 429 || res.status >= 500) && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs));
        continue;
      }
      const text = await res.text();
      if (!res.ok) {
        let detail = "";
        try {
          const parsed = JSON.parse(text) as { error?: string };
          detail = parsed.error ?? "";
        } catch {
          detail = text.slice(0, 200);
        }
        throw new ApiError(res.status, explain(res.status, path, detail));
      }
      if (accept !== "json") return { status: res.status, data: text };
      try {
        return { status: res.status, data: text ? JSON.parse(text) : null };
      } catch {
        throw new ApiError(res.status, "Healthchecks.io returned a response that is not JSON. Check HEALTHCHECKS_BASE_URL.");
      }
    }
  }

  async listChecks(filter: { tags?: string[]; slug?: string } = {}): Promise<Check[]> {
    const params = new URLSearchParams();
    for (const tag of filter.tags ?? []) params.append("tag", tag);
    if (filter.slug) params.set("slug", filter.slug);
    const query = params.size ? `?${params}` : "";
    const { data } = await this.#request("GET", `/checks/${query}`);
    return (data as { checks: Check[] }).checks;
  }

  async getCheck(id: string): Promise<Check> {
    return (await this.#request("GET", `/checks/${encodeURIComponent(id)}`)).data as Check;
  }

  /** Create, or update when a check matches the `unique` fields. */
  async upsertCheck(input: CheckInput): Promise<{ created: boolean; check: Check }> {
    const { status, data } = await this.#request("POST", "/checks/", input);
    return { created: status === 201, check: data as Check };
  }

  async updateCheck(uuid: string, input: Partial<CheckInput>): Promise<Check> {
    return (await this.#request("POST", `/checks/${encodeURIComponent(uuid)}`, input)).data as Check;
  }

  async pauseCheck(uuid: string): Promise<Check> {
    return (await this.#request("POST", `/checks/${encodeURIComponent(uuid)}/pause`)).data as Check;
  }

  async resumeCheck(uuid: string): Promise<Check> {
    return (await this.#request("POST", `/checks/${encodeURIComponent(uuid)}/resume`)).data as Check;
  }

  async deleteCheck(uuid: string): Promise<Check> {
    return (await this.#request("DELETE", `/checks/${encodeURIComponent(uuid)}`)).data as Check;
  }

  async listPings(uuid: string): Promise<Ping[]> {
    const { data } = await this.#request("GET", `/checks/${encodeURIComponent(uuid)}/pings/`);
    return (data as { pings: Ping[] }).pings;
  }

  /** Returns null when the ping has no stored body. */
  async getPingBody(uuid: string, n: number): Promise<string | null> {
    try {
      const { data } = await this.#request("GET", `/checks/${encodeURIComponent(uuid)}/pings/${n}/body`, undefined, "text");
      return data as string;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }

  async listFlips(id: string, seconds?: number): Promise<Flip[]> {
    const query = seconds ? `?seconds=${seconds}` : "";
    const { data } = await this.#request("GET", `/checks/${encodeURIComponent(id)}/flips/${query}`);
    return data as Flip[];
  }

  async listChannels(): Promise<Channel[]> {
    const { data } = await this.#request("GET", "/channels/");
    return (data as { channels: Channel[] }).channels;
  }
}
