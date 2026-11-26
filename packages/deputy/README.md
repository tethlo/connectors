**Unofficial.** Not affiliated with, endorsed by or sponsored by Deputy. Deputy is a trademark of its owner.

# Tethlo MCP server for Deputy (unofficial)

Manage your team's schedule from Claude or ChatGPT: "Who works on Saturday?", "Any open shifts to cover?", "What leave is waiting for me?", "How many hours did everyone work last week?". [Deputy](https://www.deputy.com) is workforce management software (scheduling, time and attendance) for shift-based businesses.

This is an independent, open-source [Model Context Protocol](https://modelcontextprotocol.io) server. It works with
Claude, ChatGPT and any MCP client, using **your own Deputy credentials**. It only calls the public, documented
Deputy API.

## Why this one

- **8 tools for the manager's week**: roster, gaps, leave, hours, add a shift, decide on leave.
- **Computed answers**: open shifts with who is free that day; hours and cost per employee with unapproved timesheets.
- **Names, not ids**: employees and areas by name; ambiguous names return the candidates.
- **Safe**: publishing shifts and deciding leave notify staff, so they need `confirm: true` after a preview.

## Install

```bash
npx -y @tethlo/mcp-for-deputy
```

Requirements: Node.js 20 or later, and your Deputy install address (e.g. `yourcompany.na.deputy.com`) and a permanent access token created for that install (Deputy recommends permanent tokens for one or two installs or internal connections).

## Configure

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "deputy": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-deputy"],
      "env": {
        "DEPUTY_HOST": "yourcompany.na.deputy.com",
        "DEPUTY_ACCESS_TOKEN": "your-token"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add deputy -e DEPUTY_HOST=yourcompany.na.deputy.com -e DEPUTY_ACCESS_TOKEN=your-token -- npx -y @tethlo/mcp-for-deputy
```

### Other MCP clients (Cursor, VS Code, Windsurf, Cline, Zed...)

Use the same command (`npx -y @tethlo/mcp-for-deputy`) and environment variables in the client's MCP settings
(`mcpServers` in Cursor's `mcp.json`, `servers` in VS Code's `mcp.json`).

### Remote mode (Streamable HTTP)

```bash
npx -y @tethlo/mcp-for-deputy --http        # POST http://127.0.0.1:3000/mcp, GET /health
```

Stateless Streamable HTTP (one server per request, JSON responses). Two ways to authenticate:

- **Per user**: no credentials on the server; each client sends its own in the `x-deputy-access-token` headers.
- **Single tenant**: set the credentials and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with credentials but no access token.

Put it behind HTTPS before exposing it beyond your machine.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `DEPUTY_HOST` | yes | Your Deputy install, e.g. yourcompany.na.deputy.com. In remote mode this is a server setting. |
| `DEPUTY_ACCESS_TOKEN` | yes | Deputy permanent access token. |
| `DEPUTY_BASE_URL` | no | Override of the API base URL. Default: https://<DEPUTY_HOST>/api/v1 |
| `DEPUTY_READ_ONLY` | no | `true` exposes only the read tools. |
| `MCP_ACCESS_TOKEN`, `PORT`, `HOST` | HTTP mode | See remote mode above. |

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `list_employees` | read | Active employees with ids, filtered by name. |
| `list_areas` | read | Locations and their areas (work positions). |
| `get_roster` | read | Shifts between two dates, by employee or area, with total hours. |
| `find_open_shifts` | read | Unfilled shifts and who is not rostered on those days. |
| `list_leave_requests` | read | Leave awaiting approval, approved or declined. |
| `get_hours_summary` | read | Timesheet hours and cost per employee; unapproved and in-progress sheets. |
| `create_shift` | send | Add a shift (or open shift), optionally published. Needs `confirm`. |
| `decide_leave_request` | send | Approve or decline a pending leave request. Needs `confirm`. |

Tools that email or notify someone, or that delete, cancel or refund, take a `confirm` parameter: without
`confirm: true` they only return a preview of what would happen and change nothing.

## Example requests

- "Who works on Saturday, and in which area?"
- "Are there open shifts this week? Who is free to cover them?"
- "What time off is waiting for my approval?"
- "How many hours did each person work last week, and is anything not approved?"
- "Put Leo on a Kitchen shift Monday 10:00 to 18:00 and publish it."

## Limits

- Times are handled in UTC; convert local times before creating shifts.
- Leave status codes follow the Deputy Resource API (0 awaiting, 1 approved, 2 declined); check them once on your install.
- Pay rates, award interpretation, payroll export and employee onboarding are out of scope. Nothing is deleted.
- In remote mode, `DEPUTY_HOST` is a server setting: one deployment serves one install.
- Rate limits: on HTTP 429 the server waits (honouring `Retry-After`) and retries up to 3 times; reads are
  also retried on server errors, writes never are (no duplicates).

## Privacy

- No data is stored: no database, no cache on disk, no logs of your data. Credentials stay in your environment.
- No telemetry, no analytics, no calls to anything other than the Deputy API.
- Tool results only contain the fields needed for the task.

## Development

This package lives in the [tethlo/connectors](https://github.com/tethlo/connectors) monorepo.

```bash
npm ci               # at the repository root
cd packages/deputy
npm test             # unit tests on a simulated API, stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # optional live evaluation with Claude (needs ANTHROPIC_API_KEY); tools run on the simulated API
```

`eval/tasks.ts` holds 10 natural-language tasks with the expected tool. Offline, the tests check that each expected
call solves its task and that a word-overlap router (no LLM) picks the right tool from the descriptions alone.

## Disclaimer

This is an independent open-source project by Tethlo. It is not made, reviewed or supported by Deputy.
You connect it with your own Deputy account and API credentials; your use of the Deputy API stays subject to
your agreement with Deputy. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com
