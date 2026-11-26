import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Candidate, Offer, Placement, RecruiteeApi, Stage } from "./api.ts";
import { confirmFirst, defineTool, pickOne, type ToolContext, ToolError } from "./core.ts";

export interface ToolOptions {
  writes: boolean;
  now: () => Date;
}

const DAY = 86_400_000;
const stagesOf = (o: Offer): Stage[] => o.pipeline_template?.stages ?? [];
const activePlacement = (c: Candidate, offerId?: number) => c.placements.find((p) => (!offerId || p.offer_id === offerId) && !p.disqualified_at);

function stageName(offers: Offer[], p?: Placement): string | undefined {
  if (!p) return undefined;
  if (p.disqualified_at) return "disqualified";
  const offer = offers.find((o) => o.id === p.offer_id);
  return stagesOf(offer ?? ({} as Offer)).find((s) => s.id === p.stage_id)?.name ?? (p.stage_id ? `stage ${p.stage_id}` : "new");
}

function candidateSummary(c: Candidate, offers: Offer[]) {
  return {
    id: c.id,
    name: c.name,
    email: c.emails[0],
    applied: c.created_at.slice(0, 10),
    jobs: c.placements.map((p) => ({ job: offers.find((o) => o.id === p.offer_id)?.title ?? p.offer_id, stage: stageName(offers, p) })),
  };
}

async function resolveOffer(api: RecruiteeApi, ref: string | number): Promise<Offer> {
  const offers = await api.offers();
  const wanted = String(ref).trim().toLowerCase();
  const exact = offers.filter((o) => String(o.id) === wanted || o.title.toLowerCase() === wanted);
  const found = pickOne(String(ref), exact.length ? exact : offers.filter((o) => o.title.toLowerCase().includes(wanted)), (o) => `"${o.title}" (${o.id}, ${o.status})`, "job", "Call list_jobs to see the jobs.");
  return found.pipeline_template ? found : api.offer(found.id);
}

async function resolveCandidate(api: RecruiteeApi, ref: string | number): Promise<Candidate> {
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) return api.candidate(Number(ref));
  const found = await api.candidates({ query: String(ref) });
  const lower = String(ref).trim().toLowerCase();
  const exact = found.filter((c) => c.name.toLowerCase() === lower || c.emails.some((e) => e.toLowerCase() === lower));
  const one = pickOne(String(ref), exact.length ? exact : found, (c) => `"${c.name}" <${c.emails[0] ?? "no email"}> (${c.id})`, "candidate", "Search with search_candidates.");
  return api.candidate(one.id);
}

export function registerTools(server: McpServer, api: RecruiteeApi, options: ToolOptions): void {
  const ctx: ToolContext = { server, writes: options.writes, service: "Recruitee" };

  defineTool(
    ctx,
    "list_jobs",
    {
      title: "List jobs",
      description:
        "Job openings (offers) by status: published (default), internal, draft, closed or all, with department, location and " +
        "creation date. Use it to see which positions are open before looking at candidates.",
      input: { status: z.enum(["published", "internal", "draft", "closed", "archived", "all"]).default("published") },
      kind: "read",
    },
    async ({ status }) => {
      const offers = (await api.offers(status === "archived" ? "archived" : undefined)).filter((o) => status === "all" || o.status === status);
      return { count: offers.length, jobs: offers.map((o) => ({ id: o.id, title: o.title, status: o.status, department: o.department || undefined, location: o.location || undefined, opened: o.created_at.slice(0, 10) })) };
    },
  );

  defineTool(
    ctx,
    "get_job_pipeline",
    {
      title: "Get a job pipeline",
      description:
        "The hiring pipeline of one job: each stage with its candidates (name, days since last move), plus disqualified " +
        "count. Use it for 'where are we on the sales manager role?'.",
      input: { job: z.union([z.string(), z.number()]).describe("Job title or id.") },
      kind: "read",
    },
    async ({ job }) => {
      const offer = await resolveOffer(api, job);
      const candidates = await api.candidates({ offer_id: offer.id });
      const now = options.now().getTime();
      const inStage = (stageId: number | null) =>
        candidates
          .filter((c) => activePlacement(c, offer.id)?.stage_id === stageId)
          .map((c) => {
            const p = activePlacement(c, offer.id)!;
            return { id: c.id, name: c.name, days_in_stage: Math.floor((now - Date.parse(p.updated_at ?? c.created_at)) / DAY) };
          });
      return {
        job: offer.title,
        status: offer.status,
        total: candidates.length,
        stages: stagesOf(offer).map((s) => ({ stage: s.name, candidates: inStage(s.id) })),
        disqualified: candidates.filter((c) => c.placements.some((p) => p.offer_id === offer.id && p.disqualified_at)).length,
      };
    },
  );

  defineTool(
    ctx,
    "search_candidates",
    {
      title: "Search candidates",
      description:
        "Find candidates (applicants) by name, email or keyword, optionally for one job, with their current stage in each job. " +
        "Use it to look someone up before reading their profile or moving them.",
      input: {
        query: z.string().optional().describe("Name, email or keyword."),
        job: z.union([z.string(), z.number()]).optional().describe("Job title or id."),
        limit: z.number().int().min(1).max(50).default(20),
      },
      kind: "read",
    },
    async (args) => {
      if (!args.query && !args.job) throw new ToolError("Give a query, a job, or both.");
      const offer = args.job ? await resolveOffer(api, args.job) : undefined;
      const [found, offers] = await Promise.all([api.candidates({ query: args.query, offer_id: offer?.id }), api.offers()]);
      return { count: found.length, candidates: found.slice(0, args.limit).map((c) => candidateSummary(c, offers)) };
    },
  );

  defineTool(
    ctx,
    "get_candidate",
    {
      title: "Get a candidate",
      description:
        "One candidate's profile by id, name or email: contact details, source, jobs applied to with the current stage, and " +
        "the latest notes from the hiring team. Use it to prepare an interview or a decision.",
      input: { candidate: z.union([z.string(), z.number()]) },
      kind: "read",
    },
    async ({ candidate }) => {
      const c = await resolveCandidate(api, candidate);
      const [offers, notes] = await Promise.all([api.offers(), api.notes(c.id)]);
      return { ...candidateSummary(c, offers), phone: c.phones[0], source: c.source || undefined, notes: notes.slice(-5).map((n) => ({ at: n.created_at.slice(0, 10), text: n.body })) };
    },
  );

  defineTool(
    ctx,
    "get_hiring_summary",
    {
      title: "Get the hiring summary",
      description:
        "Recruiting overview across published jobs: candidates per job and per stage, new applicants in the last 7 days, and " +
        "candidates waiting more than 7 days in the same stage. Use it for 'how is hiring going?' or 'who is stuck?'.",
      input: {},
      kind: "read",
    },
    async () => {
      const offers = (await api.offers()).filter((o) => o.status === "published");
      const now = options.now().getTime();
      const jobs = await Promise.all(
        offers.map(async (offer) => {
          const full = offer.pipeline_template ? offer : await api.offer(offer.id);
          const candidates = await api.candidates({ offer_id: offer.id });
          const active = candidates.filter((c) => activePlacement(c, offer.id));
          return {
            job: offer.title,
            candidates: active.length,
            new_last_7_days: candidates.filter((c) => now - Date.parse(c.created_at) <= 7 * DAY).length,
            by_stage: Object.fromEntries(stagesOf(full).map((s) => [s.name, active.filter((c) => activePlacement(c, offer.id)!.stage_id === s.id).length])),
            waiting_over_7_days: active
              .filter((c) => now - Date.parse(activePlacement(c, offer.id)!.updated_at ?? c.created_at) > 7 * DAY)
              .map((c) => ({ name: c.name, stage: stageName([full], activePlacement(c, offer.id)) })),
          };
        }),
      );
      return { open_jobs: jobs.length, total_candidates: jobs.reduce((n, j) => n + j.candidates, 0), jobs };
    },
  );

  defineTool(
    ctx,
    "add_candidate",
    {
      title: "Add a candidate",
      description:
        "Add a candidate (for example a referral or someone met at an event) with name, email and phone, optionally to a job. " +
        "Returns the existing candidate instead of a duplicate when the email is already known.",
      input: {
        name: z.string().min(2),
        email: z.email().optional(),
        phone: z.string().optional(),
        job: z.union([z.string(), z.number()]).optional().describe("Job title or id to apply them to."),
      },
      kind: "write",
      idempotent: true,
    },
    async (args) => {
      if (args.email) {
        const existing = (await api.candidates({ query: args.email })).find((c) => c.emails.some((e) => e.toLowerCase() === args.email.toLowerCase()));
        if (existing) return { action: "existing", candidate: { id: existing.id, name: existing.name } };
      }
      const offer = args.job ? await resolveOffer(api, args.job) : undefined;
      const created = await api.createCandidate({ name: args.name, emails: args.email ? [args.email] : undefined, phones: args.phone ? [args.phone] : undefined }, offer?.id);
      return { action: "created", candidate: { id: created.id, name: created.name, job: offer?.title } };
    },
  );

  defineTool(
    ctx,
    "add_candidate_note",
    {
      title: "Add a candidate note",
      description:
        "Write a note on a candidate for colleagues (feedback after a call, salary expectations, next steps). " +
        "Notes are internal: the candidate does not see them.",
      input: { candidate: z.union([z.string(), z.number()]), note: z.string().min(1).max(10_000) },
      kind: "write",
    },
    async (args) => {
      const c = await resolveCandidate(api, args.candidate);
      await api.addNote(c.id, args.note);
      return { done: true, candidate: c.name };
    },
  );

  defineTool(
    ctx,
    "move_candidate",
    {
      title: "Move a candidate",
      description:
        "Move a candidate to another stage of a job's pipeline (e.g. from Screening to Interview). Stage automations set up in " +
        "Recruitee may email the candidate, so call with confirm=false first, show the preview, then confirm=true.",
      input: {
        candidate: z.union([z.string(), z.number()]),
        stage: z.string().describe("Target stage name, e.g. 'Interview'."),
        job: z.union([z.string(), z.number()]).optional().describe("Needed when the candidate is in several jobs."),
        confirm: z.boolean().default(false),
      },
      kind: "send",
    },
    async (args) => {
      const c = await resolveCandidate(api, args.candidate);
      const offer = args.job ? await resolveOffer(api, args.job) : undefined;
      const placements = c.placements.filter((p) => !p.disqualified_at && (!offer || p.offer_id === offer.id));
      const placement = pickOne(c.name, placements, (p) => `job ${p.offer_id}`, "active application", "Pass job to choose, or check that the candidate is not disqualified.");
      const target = offer ?? (await api.offer(placement.offer_id));
      const wanted = args.stage.toLowerCase();
      const stage = pickOne(args.stage, stagesOf(target).filter((s) => s.name.toLowerCase().includes(wanted)), (s) => `"${s.name}"`, "stage", `Stages of ${target.title}: ${stagesOf(target).map((s) => s.name).join(", ")}.`);
      const from = stageName([target], placement);
      if (!args.confirm) return confirmFirst(`Move ${c.name} from ${from} to ${stage.name} for ${target.title} (stage automations may email the candidate).`);
      await api.changeStage(placement.id, stage.id);
      return { done: true, candidate: c.name, job: target.title, from, to: stage.name };
    },
  );
}
