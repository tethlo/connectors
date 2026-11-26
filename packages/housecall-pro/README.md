**Unofficial.** Not affiliated with, endorsed by or sponsored by Housecall Pro. Housecall Pro is a trademark of its owner.

# Tethlo MCP server for Housecall Pro (unofficial)

Run dispatch from Claude or ChatGPT: "What does today look like per tech?", "Which quotes are still waiting?", "Add a note to the Smith job: gate code 4512". [Housecall Pro](https://www.housecallpro.com) is field service management software for home service businesses (plumbing, HVAC, electrical, cleaning...).

This is an independent, open-source [Model Context Protocol](https://modelcontextprotocol.io) server. It works with
Claude, ChatGPT and any MCP client, using **your own Housecall Pro credentials**. It only calls the public, documented
Housecall Pro API.

## Why this one

- **8 tools for the office**: customers, jobs, the day's dispatch, quotes, staff, new customer, job notes.
- **Computed answers**: `get_schedule_summary` returns jobs per technician, unassigned jobs, unscheduled backlog and booked revenue.
- **Dollars, not cents**: amounts are converted from the API's cents.
- **Quiet by default**: customers created here have automatic notifications off; notes are internal. Nothing is deleted.

## Install

```bash
npx -y @tethlo/mcp-for-housecall-pro
```

Requirements: Node.js 20 or later, and a Housecall Pro API key, created by an admin in My Apps > API Key Management (the public API is available on the MAX plan at the time of writing; a read-only key works with `HOUSECALLPRO_READ_ONLY=true`).

## Configure

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "housecallpro": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-housecall-pro"],
      "env": {
        "HOUSECALLPRO_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add housecallpro -e HOUSECALLPRO_API_KEY=your-api-key -- npx -y @tethlo/mcp-for-housecall-pro
```

### Other MCP clients (Cursor, VS Code, Windsurf, Cline, Zed...)

Use the same command (`npx -y @tethlo/mcp-for-housecall-pro`) and environment variables in the client's MCP settings
(`mcpServers` in Cursor's `mcp.json`, `servers` in VS Code's `mcp.json`).

### Remote mode (Streamable HTTP)

```bash
npx -y @tethlo/mcp-for-housecall-pro --http        # POST http://127.0.0.1:3000/mcp, GET /health
```

Stateless Streamable HTTP (one server per request, JSON responses). Two ways to authenticate:

- **Per user**: no credentials on the server; each client sends its own in the `x-housecallpro-api-key` headers.
- **Single tenant**: set the credentials and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with credentials but no access token.

Put it behind HTTPS before exposing it beyond your machine.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `HOUSECALLPRO_API_KEY` | yes | Housecall Pro API key (My Apps > API Key Management). |
| `HOUSECALLPRO_BASE_URL` | no | Override of the API base URL. Default: https://api.housecallpro.com |
| `HOUSECALLPRO_READ_ONLY` | no | `true` exposes only the read tools. |
| `MCP_ACCESS_TOKEN`, `PORT`, `HOST` | HTTP mode | See remote mode above. |

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `find_customers` | read | Search customers by name, email, phone or address. |
| `list_jobs` | read | Jobs by date range, status, customer or technician, with totals and balance due. |
| `get_job` | read | One job: schedule, address, techs, amounts, notes. |
| `get_schedule_summary` | read | Dispatch view: jobs per tech, unassigned, unscheduled backlog, revenue. |
| `list_estimates` | read | Estimates with options, amounts and approval status. |
| `list_employees` | read | Technicians and office staff with role. |
| `create_customer` | write | Add a customer (notifications off); returns the existing one if the email is known. |
| `add_job_note` | write | Add an internal note to a job. |

Tools that email or notify someone, or that delete, cancel or refund, take a `confirm` parameter: without
`confirm: true` they only return a preview of what would happen and change nothing.

## Example requests

- "What does today's schedule look like per technician? Is anything unassigned?"
- "Which open jobs do we have for Robert Smith, and what does he owe?"
- "Which estimates are still waiting for the customer's approval?"
- "Create a customer: Mike Brown, mike@example.com, 77 Pine Rd, Austin."
- "Add a note to job job_3: gate code is 4512."

## Limits

- Housecall Pro serves businesses in the United States and Canada: this server needs such an account.
- Scheduling or dispatching jobs, invoices, payments and online booking are not covered in this version.
- The `Authorization: Token <key>` scheme follows Housecall Pro's API docs; filter names follow the public reference.
- Lists return the first page (up to 100 jobs); narrow by date or customer on busy accounts.
- Rate limits: on HTTP 429 the server waits (honouring `Retry-After`) and retries up to 3 times; reads are
  also retried on server errors, writes never are (no duplicates).

## Privacy

- No data is stored: no database, no cache on disk, no logs of your data. Credentials stay in your environment.
- No telemetry, no analytics, no calls to anything other than the Housecall Pro API.
- Tool results only contain the fields needed for the task.

## Development

This package lives in the [tethlo/connectors](https://github.com/tethlo/connectors) monorepo.

```bash
npm ci               # at the repository root
cd packages/housecall-pro
npm test             # unit tests on a simulated API, stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # optional live evaluation with Claude (needs ANTHROPIC_API_KEY); tools run on the simulated API
```

`eval/tasks.ts` holds 10 natural-language tasks with the expected tool. Offline, the tests check that each expected
call solves its task and that a word-overlap router (no LLM) picks the right tool from the descriptions alone.

## Disclaimer

This is an independent open-source project by Tethlo. It is not made, reviewed or supported by Housecall Pro.
You connect it with your own Housecall Pro account and API credentials; your use of the Housecall Pro API stays subject to
your agreement with Housecall Pro. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com
