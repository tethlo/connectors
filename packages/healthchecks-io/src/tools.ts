import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ApiError, type Check, type CheckInput, type HealthchecksApi, type Ping } from "./api.ts";

/** A problem with the agent's input that it can fix (wrong name, ambiguous match...). */
export class ToolError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS_ORDER = ["down", "grace", "new", "paused", "up"] as const;
const DAY = 86_400;

function ok(data: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

async function run(fn: () => Promise<Record<string, unknown>>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    const message =
      error instanceof ApiError || error instanceof ToolError
        ? error.message
        : "Unexpected error in the Healthchecks MCP server. Retry once; if it persists, report it to the server owner.";
    return { isError: true, content: [{ type: "text", text: message }] };
  }
}

export function humanDuration(seconds: number): string {
  if (seconds % DAY === 0) return `${seconds / DAY}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function schedule(check: Check): string {
  if (check.schedule) return `cron "${check.schedule}" (${check.tz ?? "UTC"})`;
  return check.timeout ? `every ${humanDuration(check.timeout)}` : "unknown";
}

function idOf(check: Check): string {
  return check.uuid ?? check.unique_key ?? check.slug;
}

function summary(check: Check) {
  return {
    id: idOf(check),
    name: check.name || "(unnamed)",
    status: check.status,
    schedule: schedule(check),
    grace: humanDuration(check.grace),
    tags: check.tags ? check.tags.split(" ").filter(Boolean) : [],
    last_ping: check.last_ping,
    next_ping: check.next_ping,
  };
}

function names(checks: Check[], max = 10): string {
  const list = checks.slice(0, max).map((c) => `"${c.name || c.slug}"`);
  return checks.length > max ? `${list.join(", ")} and ${checks.length - max} more` : list.join(", ") || "none";
}

/** Find a check from what the user said: uuid, slug, exact name, or an unambiguous part of the name. */
export async function resolveCheck(api: HealthchecksApi, ref: string): Promise<Check> {
  const wanted = ref.trim();
  if (UUID_RE.test(wanted)) return api.getCheck(wanted);
  const all = await api.listChecks();
  const lower = wanted.toLowerCase();
  const exact = all.filter((c) => c.slug === wanted || c.unique_key === wanted || c.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const candidates = exact.length
    ? exact
    : all.filter((c) => c.name.toLowerCase().includes(lower) || (c.slug && c.slug.includes(lower)));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    throw new ToolError(`No check matches "${wanted}". Existing checks: ${names(all)}.`);
  }
  throw new ToolError(
    `"${wanted}" matches ${candidates.length} checks: ${names(candidates)}. Ask the user which one, or pass the exact name or id.`,
  );
}

function writableId(check: Check): string {
  if (!check.uuid) {
    throw new ToolError("This action needs a read-write API key (the current key is read-only).");
  }
  return check.uuid;
}

function lastOf(pings: Ping[], type: Ping["type"]): Ping | undefined {
  return pings.find((p) => p.type === type);
}

function truncate(text: string, max: number): string {
  const clean = text.trim();
  return clean.length > max ? `${clean.slice(0, max)}… (${clean.length - max} more characters)` : clean;
}

export function registerTools(server: McpServer, api: HealthchecksApi): void {
  server.registerTool(
    "list_checks",
    {
      title: "List checks",
      description:
        "List the monitored jobs (checks) in the Healthchecks.io project with their current status, schedule and last ping. " +
        "Use it for overviews ('is everything up?', 'show my backup jobs', 'which checks are paused?'). " +
        "Failing checks come first. To learn WHY a job fails, use diagnose_failures instead.",
      inputSchema: {
        status: z
          .array(z.enum(["up", "down", "grace", "paused", "new"]))
          .optional()
          .describe("Only return checks in these states. 'grace' means late but not yet down."),
        tag: z.string().optional().describe("Only checks with this tag, e.g. 'prod'."),
        search: z.string().optional().describe("Case-insensitive text to match in the check name."),
        limit: z.number().int().min(1).max(200).default(50).describe("Maximum number of checks to return."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ status, tag, search, limit }) =>
      run(async () => {
        const all = await api.listChecks({ tags: tag ? [tag] : [] });
        const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, all.filter((c) => c.status === s).length]));
        const term = search?.toLowerCase();
        const matching = all
          .filter((c) => !status?.length || status.includes(c.status))
          .filter((c) => !term || c.name.toLowerCase().includes(term))
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
        return {
          total_in_project: all.length,
          counts,
          returned: Math.min(matching.length, limit),
          truncated: matching.length > limit,
          checks: matching.slice(0, limit).map(summary),
        };
      }),
  );

  server.registerTool(
    "get_check_details",
    {
      title: "Get check details",
      description:
        "Everything about ONE check: configuration, ping URL, recent pings (start, success, fail, with durations) and " +
        "status changes over the last 30 days. Use it to answer 'when did the backup last run?', 'how long does it take?' " +
        "or 'how often was it down this month?'. Accepts the check name, slug or id.",
      inputSchema: {
        check: z.string().min(1).describe("Check name (or part of it), slug, or uuid."),
        pings: z.number().int().min(0).max(50).default(10).describe("How many recent pings to include."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ check, pings }) =>
      run(async () => {
        const found = await resolveCheck(api, check);
        const [log, flips] = await Promise.all([
          found.uuid && pings > 0 ? api.listPings(found.uuid) : Promise.resolve([] as Ping[]),
          api.listFlips(idOf(found), 30 * DAY),
        ]);
        const durations = log.filter((p) => p.type === "success" && p.duration).map((p) => p.duration as number);
        return {
          check: summary(found),
          description: found.desc || undefined,
          ping_url: found.ping_url,
          total_pings: found.n_pings,
          manual_resume: found.manual_resume,
          average_run_seconds: durations.length
            ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10
            : undefined,
          recent_pings: log.slice(0, pings).map((p) => ({
            type: p.type,
            date: p.date,
            duration_seconds: p.duration === undefined ? undefined : Math.round(p.duration * 10) / 10,
            exit_status: p.exitstatus,
          })),
          status_changes_30d: flips.map((f) => ({ at: f.timestamp, became: f.up ? "up" : "down" })),
          outages_30d: flips.filter((f) => !f.up).length,
        };
      }),
  );

  server.registerTool(
    "diagnose_failures",
    {
      title: "Diagnose failing jobs",
      description:
        "Find which jobs are failing or late right now and why. For every check that is down or in its grace period, " +
        "returns since when, the likely cause (job reported a failure, job started but never finished, or no ping at all) " +
        "and the output the job logged with its last failure. Use it first when the user asks what is broken, what is wrong, " +
        "or why they received an alert email or notification.",
      inputSchema: {
        tag: z.string().optional().describe("Only look at checks with this tag."),
        include_output: z.boolean().default(true).describe("Include the logged output of the last failed run."),
        max_output_chars: z.number().int().min(50).max(4000).default(600).describe("Truncate each logged output."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ tag, include_output, max_output_chars }) =>
      run(async () => {
        const all = await api.listChecks({ tags: tag ? [tag] : [] });
        const failing = all
          .filter((c) => c.status === "down" || c.status === "grace")
          .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
        const diagnosed = await Promise.all(
          failing.slice(0, 10).map(async (check) => {
            const pings = check.uuid ? await api.listPings(check.uuid) : [];
            const flips = await api.listFlips(idOf(check), 30 * DAY);
            const lastFail = lastOf(pings, "fail");
            const lastSuccess = lastOf(pings, "success");
            const lastStart = lastOf(pings, "start");
            const failedAfterSuccess = lastFail && (!lastSuccess || lastFail.date > lastSuccess.date);
            const hungAfterStart = lastStart && (!lastSuccess || lastStart.date > lastSuccess.date) && !failedAfterSuccess;
            let cause: string;
            if (failedAfterSuccess) {
              cause = lastFail.exitstatus !== undefined
                ? `The job reported a failure (exit status ${lastFail.exitstatus}).`
                : "The job reported a failure.";
            } else if (hungAfterStart) {
              cause = "The job started but never reported success: it may hang, crash or exceed its time limit.";
            } else if (check.status === "grace") {
              cause = "The job is late: the expected ping has not arrived yet (grace period running).";
            } else {
              cause = "No ping arrived on time: the job did not run, or could not reach Healthchecks.io.";
            }
            let output: string | undefined;
            if (include_output && failedAfterSuccess && check.uuid && lastFail.body_url) {
              const body = await api.getPingBody(check.uuid, lastFail.n);
              output = body ? truncate(body, max_output_chars) : undefined;
            }
            const lastDown = flips.find((f) => !f.up);
            return {
              ...summary(check),
              down_since: check.status === "down" ? lastDown?.timestamp : undefined,
              cause,
              last_success: lastSuccess?.date,
              last_failure: lastFail?.date,
              failure_output: output,
            };
          }),
        );
        return {
          checks_examined: all.length,
          all_ok: failing.length === 0,
          failing_count: failing.length,
          failing: diagnosed,
          note: failing.length > 10 ? "Only the first 10 failing checks are diagnosed; filter by tag for the rest." : undefined,
        };
      }),
  );

  server.registerTool(
    "create_or_update_check",
    {
      title: "Create or update a check",
      description:
        "Start monitoring a cron job or scheduled task, or change an existing check with the same name. " +
        "Give either period_seconds (simple 'every N' jobs) or cron (+ timezone). Returns the ping URL and the exact " +
        "command to add at the end of the job. New checks alert every notification channel unless 'notify' says otherwise.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Human-readable name, e.g. 'Nightly DB backup'. Also used to find an existing check."),
        period_seconds: z.number().int().min(60).max(31_536_000).optional().describe("Expected time between runs, in seconds."),
        cron: z.string().min(1).optional().describe("Cron expression of the job, e.g. '15 2 * * *'."),
        timezone: z.string().optional().describe("IANA timezone of the cron expression, e.g. 'Europe/Paris'. Default UTC."),
        grace_seconds: z.number().int().min(60).max(31_536_000).optional().describe("How late a ping may be before alerting."),
        tags: z.array(z.string().regex(/^\S+$/, "tags cannot contain spaces")).optional().describe("Tags, e.g. ['prod','backup']."),
        description: z.string().max(10_000).optional(),
        notify: z
          .union([z.enum(["all", "none"]), z.array(z.string().min(1)).min(1)])
          .optional()
          .describe("'all', 'none', or a list of integration names from list_notification_channels."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args) =>
      run(async () => {
        if ((args.period_seconds === undefined) === (args.cron === undefined)) {
          throw new ToolError("Give exactly one of period_seconds or cron.");
        }
        if (args.timezone && !args.cron) throw new ToolError("timezone only applies with cron.");
        let channels: string | undefined;
        if (Array.isArray(args.notify)) {
          const available = await api.listChannels();
          const unknown = args.notify.filter((n) => !available.some((c) => c.name === n));
          if (unknown.length) {
            throw new ToolError(
              `Unknown notification channel(s): ${unknown.join(", ")}. Available: ${available.map((c) => `"${c.name}"`).join(", ") || "none"}.`,
            );
          }
          channels = args.notify.map((n) => available.find((c) => c.name === n)!.id).join(",");
        } else if (args.notify) {
          channels = args.notify === "all" ? "*" : "";
        }
        const fields: Partial<CheckInput> = {
          name: args.name,
          tags: args.tags?.join(" "),
          desc: args.description,
          grace: args.grace_seconds,
          ...(args.cron ? { schedule: args.cron, tz: args.timezone ?? "UTC" } : { timeout: args.period_seconds }),
          channels,
        };
        const existing = (await api.listChecks()).find((c) => c.name.toLowerCase() === args.name.toLowerCase());
        let check: Check;
        let created: boolean;
        if (existing) {
          check = await api.updateCheck(writableId(existing), fields);
          created = false;
        } else {
          ({ check, created } = await api.upsertCheck({ ...fields, name: args.name, channels: channels ?? "*", unique: ["name"] }));
        }
        return {
          action: created ? "created" : "updated",
          check: summary(check),
          ping_url: check.ping_url,
          how_to_ping: check.ping_url
            ? `Add at the end of the job: curl -fsS -m 10 --retry 5 -o /dev/null ${check.ping_url}  (send ${check.ping_url}/fail on error, ${check.ping_url}/start at the beginning to measure run time)`
            : undefined,
        };
      }),
  );

  server.registerTool(
    "pause_or_resume_check",
    {
      title: "Pause or resume a check",
      description:
        "Pause monitoring of a check (no alerts, e.g. during maintenance or while a job is disabled) or resume it. " +
        "A paused check also resumes by itself on its next ping unless it was set to manual resume.",
      inputSchema: {
        check: z.string().min(1).describe("Check name (or part of it), slug, or uuid."),
        action: z.enum(["pause", "resume"]),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ check, action }) =>
      run(async () => {
        const found = await resolveCheck(api, check);
        const id = writableId(found);
        if (action === "resume" && found.status !== "paused") {
          return { check: summary(found), note: "The check is not paused; nothing to resume." };
        }
        const updated = action === "pause" ? await api.pauseCheck(id) : await api.resumeCheck(id);
        return { action, check: summary(updated) };
      }),
  );

  server.registerTool(
    "delete_check",
    {
      title: "Delete a check",
      description:
        "Permanently delete a check and its ping history. Irreversible. Only call it after the user explicitly confirmed " +
        "the deletion of this exact check; to stop alerts temporarily, use pause_or_resume_check instead.",
      inputSchema: {
        check: z.string().min(1).describe("Exact check name, slug, or uuid."),
        confirm: z.literal(true).describe("Must be true: the user explicitly confirmed the deletion."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ check }) =>
      run(async () => {
        const found = await resolveCheck(api, check);
        const deleted = await api.deleteCheck(writableId(found));
        return { deleted: true, name: deleted.name, id: deleted.uuid };
      }),
  );

  server.registerTool(
    "list_notification_channels",
    {
      title: "List notification channels",
      description:
        "List the alert integrations of the project (email, Slack, SMS, webhook...) with their names. " +
        "Use it to answer 'who gets alerted?' or before create_or_update_check to pick the 'notify' names.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      run(async () => {
        const channels = await api.listChannels();
        return { count: channels.length, channels: channels.map((c) => ({ name: c.name || "(unnamed)", kind: c.kind, id: c.id })) };
      }),
  );
}
