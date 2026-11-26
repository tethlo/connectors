**Unofficial.** Not affiliated with, endorsed by or sponsored by Healthchecks.io. Healthchecks.io is a trademark of its owner.

# Tethlo MCP server for Healthchecks.io (unofficial demo)

Talk to your cron job monitoring from Claude, ChatGPT or any MCP client:
"What's broken right now and why?", "Silence the reindex job during tonight's maintenance",
"Start monitoring my weekly report script".

[Healthchecks.io](https://healthchecks.io) watches cron jobs and scheduled tasks: each job pings
a URL when it runs, and you get an alert when a ping is late or reports a failure. This server
exposes that to AI agents through the [Model Context Protocol](https://modelcontextprotocol.io).

> **Demo.** This server is a demonstration of how Tethlo builds MCP servers. It is tested and usable, but it has
> fewer guarantees than the connectors in this repository (no read-only switch, smaller scope).

## Why this server is different

- **Tools built for the task, not for the endpoints.** 7 tools instead of 13 endpoints.
  `diagnose_failures` combines checks, pings, flips and logged output to answer "why is it red?"
  in one call.
- **Plain words work.** Every tool that takes a check accepts its name, a part of the name, the
  slug or the uuid. Ambiguous names return the candidates instead of a guess.
- **Short, structured answers.** Compact JSON (also sent as `structuredContent`), durations like
  `every 1h`, failing checks first, logged output truncated.
- **Errors an agent can act on.** "Access denied. This needs a read-write API key…" instead of a
  bare 403. One automatic retry on 429/5xx.
- **Safe by default.** Read tools are marked `readOnlyHint`; `delete_check` is marked
  destructive and requires `confirm: true`.
- **Measured.** 10-task agent evaluation, checked offline in CI and runnable live against Claude.

## Tools

| Tool | What it does |
|---|---|
| `list_checks` | Overview of checks with status, schedule and last ping. Filters: status, tag, text. Failing first. |
| `get_check_details` | One check: config, ping URL, recent pings with durations, average run time, status changes over 30 days. |
| `diagnose_failures` | Every down or late check, since when, the likely cause and the output logged with the last failure. |
| `create_or_update_check` | Monitor a job (period or cron + timezone), or update the check with the same name. Returns the ping command. |
| `pause_or_resume_check` | Pause alerts (maintenance) or resume them. |
| `delete_check` | Delete a check permanently. Requires `confirm: true`. |
| `list_notification_channels` | Alert integrations (email, Slack, SMS…) by name, for "who gets alerted?" and for `notify`. |

## Install

Requirements: Node.js 22.18 or later, a Healthchecks.io
project API key (Project Settings > API Access; read-write for all tools, read-only for the read tools).

```bash
npx -y @tethlo/mcp-for-healthchecks-io
```

The server reads `HEALTHCHECKS_API_KEY` from its environment: each user brings their own credentials.

### Local (stdio): Claude Desktop, Claude Code, Cursor

```json
{
  "mcpServers": {
    "healthchecks": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-healthchecks-io"],
      "env": { "HEALTHCHECKS_API_KEY": "your-key" }
    }
  }
}
```

Claude Code: `claude mcp add healthchecks -e HEALTHCHECKS_API_KEY=your-key -- npx -y @tethlo/mcp-for-healthchecks-io`

Self-hosted Healthchecks: also set `HEALTHCHECKS_BASE_URL=https://hc.example.com`.

### Remote (Streamable HTTP): ChatGPT, Claude.ai connectors, hosted agents

```bash
npm run start:http        # POST http://127.0.0.1:3000/mcp, GET /health
```

From a clone of the repository (`cd packages/healthchecks-io`). Stateless Streamable HTTP, JSON responses, one MCP server per request. Two ways to authenticate:

- **Per user**: no key on the server; each client sends its own key in `X-Healthchecks-Api-Key`.
- **Single tenant**: set `HEALTHCHECKS_API_KEY` and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with a key but no token.

For a public listing (ChatGPT app directory, Claude connector directory), put OAuth 2.1 in front of
the endpoint so users sign in instead of pasting keys (not included in this demo).

To build plain JavaScript: `npm run build` (output in `dist/`).

## Limits

- Healthchecks.io asks API clients to stay under 100 requests per minute; the tools make one or a few requests per call
  and retry once on 429. Avoid scripts that call the tools in a tight loop.
- No read-only switch in this demo: use a read-only Healthchecks.io API key if you only want the read tools to work.

## Example conversation

> **User:** I just got an alert email. What's broken right now and why?
>
> *Claude calls `diagnose_failures` →*
> `{"failing_count":2,"failing":[{"name":"Nightly DB backup","status":"down","down_since":"2026-11-24T01:16:40+00:00","cause":"The job reported a failure (exit status 2).","failure_output":"pg_dump: error: connection to server at \"db.internal\" failed: FATAL: password authentication failed for user \"backup\""},{"name":"Search reindex","status":"grace","cause":"The job started but never reported success: it may hang, crash or exceed its time limit."}]}`
>
> **Claude:** Two jobs need attention.
> 1. **Nightly DB backup** has been down since 01:16 UTC: `pg_dump` could not log in
>    (password authentication failed for user `backup`). The password probably changed.
> 2. **Search reindex** started at 04:00 but never finished; it is in its grace period.
>
> **User:** Pause the reindex check until we look at it.
>
> *Claude calls `pause_or_resume_check {"check":"reindex","action":"pause"}`* → **Claude:** Done, alerts for Search reindex are paused.

(Data from the test fixtures.)

## Tests and evaluation

```bash
npm ci               # at the repository root
cd packages/healthchecks-io
npm test             # unit tests (fake API), stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # live evaluation: needs ANTHROPIC_API_KEY; tools run on the fake API, never your account
```

- `test/fake-api.ts` imitates the Healthchecks.io API v3 (documented response shapes, errors 401/403/404/409, 503 retry).
- `eval/tasks.ts` holds 10 natural-language tasks with the expected tool and arguments. Offline, the test
  suite checks that each expected call solves its task and that a word-overlap router (`eval/router.ts`, no LLM)
  picks the right tool from the descriptions alone.
- `eval/run-claude.ts` asks Claude (default `claude-opus-5-5`, override with `EVAL_MODEL`) to handle each task
  with the real tool list, runs the call it chose on the fake API and prints the score
  (correct tool and working arguments). It exits with 1 below `EVAL_MIN_SCORE` (default 0.9).

## Disclaimer

This is an independent open-source demo by Tethlo. It is not made, reviewed or supported by Healthchecks.io.
You connect it with your own Healthchecks.io account and API credentials; your use of the Healthchecks.io API stays subject to
your agreement with Healthchecks.io. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com
