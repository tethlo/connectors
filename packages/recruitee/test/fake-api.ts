// In-memory imitation of the Recruitee ATS API, for the tests and the agent evaluation.
// Shapes follow the public reference (docs.recruitee.com); filters are simplified.
import type { Candidate, Note, Offer } from "../src/api.ts";

export const NOW = "2026-11-24T09:00:00Z";
export const TEST_ENV = { RECRUITEE_COMPANY_ID: "4242", RECRUITEE_API_TOKEN: "test-token", RECRUITEE_BASE_URL: "https://recruitee.test" };
export const PER_USER_HEADERS = { "x-recruitee-company-id": "4242", "x-recruitee-api-token": "test-token" };

export const EXPECTED_TOOLS = [
  "list_jobs",
  "get_job_pipeline",
  "search_candidates",
  "get_candidate",
  "get_hiring_summary",
  "add_candidate",
  "add_candidate_note",
  "move_candidate",
];

export const HTTP_PROBE = { tool: "get_hiring_summary", args: {}, expect: /Sales Manager/ };
export const CONFIRM_CALLS = [{ tool: "move_candidate", args: { candidate: 201, stage: "Interview" } }];

export interface FakeState {
  offers: Offer[];
  candidates: Candidate[];
  notes: Record<number, Note[]>;
  calls: string[];
}

const stages = [
  { id: 1, name: "Applied", category: "apply" },
  { id: 2, name: "Screening", category: "phone_screen" },
  { id: 3, name: "Interview", category: "interview" },
  { id: 4, name: "Offer", category: "offer" },
];

export function seed(): FakeState {
  const candidate = (id: number, name: string, email: string, created: string, offer: number, stage: number, updated: string, disqualified = false): Candidate => ({
    id, name, emails: [email], phones: ["+33 6 00 00 00 " + String(id).slice(-2)], created_at: `${created}T10:00:00Z`, source: "careers site",
    placements: [{ id: id * 10, offer_id: offer, stage_id: stage, updated_at: `${updated}T10:00:00Z`, disqualified_at: disqualified ? `${updated}T10:00:00Z` : null }],
  });
  return {
    offers: [
      { id: 11, title: "Sales Manager", status: "published", department: "Sales", location: "Paris", created_at: "2026-10-01T00:00:00Z", pipeline_template: { stages } },
      { id: 12, title: "Backend Developer", status: "published", department: "Tech", location: "Remote", created_at: "2026-11-01T00:00:00Z", pipeline_template: { stages } },
      { id: 13, title: "Office Assistant", status: "closed", department: "Ops", location: "Lyon", created_at: "2026-06-01T00:00:00Z", pipeline_template: { stages } },
    ],
    candidates: [
      candidate(201, "Claire Martin", "claire@example.test", "2026-11-02", 11, 2, "2026-11-05"),
      candidate(202, "Hugo Bernard", "hugo@example.test", "2026-11-20", 11, 3, "2026-11-22"),
      candidate(203, "Ines Petit", "ines@example.test", "2026-11-21", 12, 1, "2026-11-21"),
      candidate(204, "Marc Dubois", "marc@example.test", "2026-11-10", 11, 1, "2026-11-12", true),
    ],
    notes: { 202: [{ id: 1, body: "Strong first call, expects 55k.", created_at: "2026-11-21T15:00:00Z" }] },
    calls: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}${url.search}`);
    if (new Headers(init?.headers).get("Authorization") !== "Bearer test-token") return json(401, { error: ["Unauthorized"] });
    if (!url.pathname.startsWith("/c/4242/")) return json(404, { error: ["Company not found"] });
    const path = url.pathname.slice("/c/4242".length);
    const q = url.searchParams;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let m: RegExpMatchArray | null;

    if (path === "/offers") return json(200, { offers: state.offers.filter((o) => (q.get("scope") === "archived" ? o.status === "archived" : o.status !== "archived")) });
    if ((m = path.match(/^\/offers\/(\d+)$/))) {
      const offer = state.offers.find((o) => o.id === Number(m![1]));
      return offer ? json(200, { offer }) : json(404, { error: ["Not found"] });
    }
    if (path === "/candidates" && method === "GET") {
      const term = (q.get("query") ?? "").toLowerCase();
      return json(200, {
        candidates: state.candidates
          .filter((c) => !q.get("offer_id") || c.placements.some((p) => String(p.offer_id) === q.get("offer_id")))
          .filter((c) => !term || c.name.toLowerCase().includes(term) || c.emails.some((e) => e.includes(term))),
      });
    }
    if (path === "/candidates" && method === "POST") {
      const id = 300 + state.candidates.length;
      const created: Candidate = { id, name: body.candidate.name, emails: body.candidate.emails ?? [], phones: body.candidate.phones ?? [], created_at: NOW, placements: (body.offers ?? []).map((offer_id: number) => ({ id: id * 10, offer_id, stage_id: 1, updated_at: NOW })) };
      state.candidates.push(created);
      return json(201, { candidate: created });
    }
    if ((m = path.match(/^\/candidates\/(\d+)(\/notes)?$/))) {
      const c = state.candidates.find((x) => x.id === Number(m![1]));
      if (!c) return json(404, { error: ["Not found"] });
      if (m[2] && method === "POST") {
        const note = { id: Date.now(), body: body.note.body, created_at: NOW };
        (state.notes[c.id] ??= []).push(note);
        return json(201, { note });
      }
      if (m[2]) return json(200, { notes: state.notes[c.id] ?? [] });
      return json(200, { candidate: c });
    }
    if ((m = path.match(/^\/placements\/(\d+)\/change_stage$/)) && method === "PATCH") {
      const placement = state.candidates.flatMap((c) => c.placements).find((p) => p.id === Number(m![1]));
      if (!placement) return json(404, { error: ["Not found"] });
      placement.stage_id = body.stage_id;
      placement.updated_at = NOW;
      return json(200, { placement });
    }
    return json(404, { error: ["Unknown endpoint"] });
  };
}
