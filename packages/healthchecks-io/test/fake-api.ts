// In-memory imitation of the Healthchecks.io Management API v3, used by the tests and the agent evaluation.
// Responses follow the shapes documented at https://healthchecks.io/docs/api/.
import type { Channel, Check, Flip, Ping } from "../src/api.ts";

export const BASE = "https://hc.test";
export const KEY = "test-key";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function check(n: number, fields: Partial<Check>): Check {
  return {
    name: "",
    slug: "",
    tags: "",
    desc: "",
    grace: 3600,
    n_pings: 10,
    status: "up",
    started: false,
    last_ping: "2026-11-24T02:15:00+00:00",
    next_ping: "2026-11-25T02:15:00+00:00",
    manual_resume: false,
    uuid: uuid(n),
    ping_url: `https://hc-ping.test/${uuid(n)}`,
    channels: "",
    timeout: 86400,
    ...fields,
  };
}

export interface FakeState {
  checks: Check[];
  pings: Record<string, Ping[]>;
  flips: Record<string, Flip[]>;
  bodies: Record<string, string>;
  channels: Channel[];
  calls: string[];
  failNext?: number;
}

export function seed(): FakeState {
  const checks = [
    check(1, { name: "Nightly DB backup", slug: "db-backup", tags: "prod backup", status: "down", schedule: "15 2 * * *", tz: "Europe/Paris", timeout: undefined, last_ping: "2026-11-23T01:15:09+00:00", next_ping: null }),
    check(2, { name: "Invoice sync", slug: "invoice-sync", tags: "prod billing", status: "up", timeout: 3600 }),
    check(3, { name: "Newsletter sender", slug: "newsletter", tags: "marketing", status: "paused", next_ping: null }),
    check(4, { name: "Search reindex", slug: "reindex", tags: "prod", status: "grace", timeout: 21600 }),
    check(5, { name: "Staging backup", slug: "staging-backup", tags: "staging backup", status: "up" }),
  ];
  const p = (type: Ping["type"], date: string, n: number, extra: Partial<Ping> = {}): Ping => ({
    type, date, n, scheme: "https", method: "POST", ua: "curl/8.5.0", body_url: null, ...extra,
  });
  return {
    checks,
    pings: {
      [uuid(1)]: [
        p("fail", "2026-11-24T01:16:40+00:00", 12, { exitstatus: 2, body_url: `${BASE}/api/v3/checks/${uuid(1)}/pings/12/body` }),
        p("start", "2026-11-24T01:15:02+00:00", 11),
        p("success", "2026-11-23T01:17:31+00:00", 10, { duration: 149.2 }),
        p("start", "2026-11-23T01:15:02+00:00", 9),
      ],
      [uuid(2)]: [
        p("success", "2026-11-24T10:00:41+00:00", 30, { duration: 40.4 }),
        p("start", "2026-11-24T10:00:01+00:00", 29),
        p("success", "2026-11-24T09:00:39+00:00", 28, { duration: 38.6 }),
      ],
      [uuid(4)]: [p("start", "2026-11-24T04:00:00+00:00", 5), p("success", "2026-11-23T22:01:10+00:00", 4, { duration: 70 })],
    },
    flips: {
      [uuid(1)]: [
        { timestamp: "2026-11-24T01:16:40+00:00", up: 0 },
        { timestamp: "2026-11-20T03:00:00+00:00", up: 1 },
        { timestamp: "2026-11-20T02:30:00+00:00", up: 0 },
      ],
    },
    bodies: {
      [`${uuid(1)}/12`]: "pg_dump: error: connection to server at \"db.internal\" failed: FATAL: password authentication failed for user \"backup\"",
    },
    channels: [
      { id: "11111111-0000-4000-8000-000000000001", name: "Ops email", kind: "email" },
      { id: "11111111-0000-4000-8000-000000000002", name: "#alerts", kind: "slack" },
    ],
    calls: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch() that answers like Healthchecks.io from the given state. */
export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    state.calls.push(`${method} ${url.pathname}${url.search}`);
    if (state.failNext) {
      const status = state.failNext;
      state.failNext = undefined;
      return json(status, { error: "simulated" });
    }
    if (headers.get("X-Api-Key") !== KEY) return json(401, { error: "missing api key" });
    const path = url.pathname.replace(/^\/api\/v3/, "");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const byId = (id: string) => state.checks.find((c) => c.uuid === id);
    let m: RegExpMatchArray | null;

    if (path === "/checks/" && method === "GET") {
      const tags = url.searchParams.getAll("tag");
      const slug = url.searchParams.get("slug");
      return json(200, {
        checks: state.checks.filter((c) => tags.every((t) => c.tags.split(" ").includes(t)) && (!slug || c.slug === slug)),
      });
    }
    if (path === "/checks/" && method === "POST") {
      const existing = (body.unique ?? []).includes("name") ? state.checks.find((c) => c.name === body.name) : undefined;
      if (existing) return json(200, Object.assign(existing, body));
      const created = check(100 + state.checks.length, {
        name: body.name, tags: body.tags ?? "", desc: body.desc ?? "", status: "new", n_pings: 0, last_ping: null, next_ping: null,
        grace: body.grace ?? 3600, timeout: body.schedule ? undefined : (body.timeout ?? 86400), schedule: body.schedule, tz: body.tz,
        channels: body.channels === "*" ? state.channels.map((c) => c.id).join(",") : (body.channels ?? ""),
      });
      state.checks.push(created);
      return json(201, created);
    }
    if ((m = path.match(/^\/checks\/([^/]+)$/))) {
      const found = byId(m[1]);
      if (!found) return json(404, { error: "not found" });
      if (method === "GET") return json(200, found);
      if (method === "POST") return json(200, Object.assign(found, body));
      if (method === "DELETE") {
        state.checks = state.checks.filter((c) => c !== found);
        return json(200, found);
      }
    }
    if ((m = path.match(/^\/checks\/([^/]+)\/(pause|resume)$/)) && method === "POST") {
      const found = byId(m[1]);
      if (!found) return json(404, { error: "not found" });
      if (m[2] === "resume" && found.status !== "paused") return json(409, { error: "not paused" });
      found.status = m[2] === "pause" ? "paused" : "new";
      return json(200, found);
    }
    if ((m = path.match(/^\/checks\/([^/]+)\/pings\/$/))) {
      if (!byId(m[1])) return json(404, { error: "not found" });
      return json(200, { pings: state.pings[m[1]] ?? [] });
    }
    if ((m = path.match(/^\/checks\/([^/]+)\/pings\/(\d+)\/body$/))) {
      const text = state.bodies[`${m[1]}/${m[2]}`];
      return text ? new Response(text, { status: 200, headers: { "Content-Type": "text/plain" } }) : json(404, { error: "no body" });
    }
    if ((m = path.match(/^\/checks\/([^/]+)\/flips\/$/))) {
      if (!byId(m[1])) return json(404, { error: "not found" });
      return json(200, state.flips[m[1]] ?? []);
    }
    if (path === "/channels/") return json(200, { channels: state.channels });
    return json(404, { error: "unknown endpoint" });
  };
}
