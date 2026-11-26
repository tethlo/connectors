**Unofficial.** Not affiliated with, endorsed by or sponsored by Recruitee. Recruitee is a trademark of its owner.

# Tethlo MCP server for Recruitee (unofficial)

Run hiring from Claude or ChatGPT: "How is hiring going, who is stuck?", "Where are we on the Sales Manager role?", "Give me Hugo's profile before my interview", "Move Claire to Interview". [Recruitee](https://recruitee.com) is an applicant tracking system (ATS) for small and mid-size companies.

This is an independent, open-source [Model Context Protocol](https://modelcontextprotocol.io) server. It works with
Claude, ChatGPT and any MCP client, using **your own Recruitee credentials**. It only calls the public, documented
Recruitee API.

## Why this one

- **8 tools for the hiring team**: jobs, pipeline per job, search, profile, overview, add, note, move.
- **Computed answers**: `get_hiring_summary` returns candidates per stage, new applicants this week and who has been waiting more than 7 days.
- **Plain words work**: jobs and stages by name, candidates by name, email or id; ambiguous names return the candidates.
- **Safe**: moving a candidate can trigger stage automations (emails), so it needs `confirm: true` after a preview. Notes stay internal. Nothing is deleted.

## Install

```bash
npx -y @tethlo/mcp-for-recruitee
```

Requirements: Node.js 20 or later, and your Recruitee company id and a personal API token (Settings > Apps and plugins > Personal API tokens).

## Configure

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "recruitee": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-recruitee"],
      "env": {
        "RECRUITEE_COMPANY_ID": "12345",
        "RECRUITEE_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add recruitee -e RECRUITEE_COMPANY_ID=12345 -e RECRUITEE_API_TOKEN=your-api-token -- npx -y @tethlo/mcp-for-recruitee
```

### Other MCP clients (Cursor, VS Code, Windsurf, Cline, Zed...)

Use the same command (`npx -y @tethlo/mcp-for-recruitee`) and environment variables in the client's MCP settings
(`mcpServers` in Cursor's `mcp.json`, `servers` in VS Code's `mcp.json`).

### Remote mode (Streamable HTTP)

```bash
npx -y @tethlo/mcp-for-recruitee --http        # POST http://127.0.0.1:3000/mcp, GET /health
```

Stateless Streamable HTTP (one server per request, JSON responses). Two ways to authenticate:

- **Per user**: no credentials on the server; each client sends its own in the `x-recruitee-company-id`, `x-recruitee-api-token` headers.
- **Single tenant**: set the credentials and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with credentials but no access token.

Put it behind HTTPS before exposing it beyond your machine.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `RECRUITEE_COMPANY_ID` | yes | Recruitee company id (shown with the personal API token). |
| `RECRUITEE_API_TOKEN` | yes | Recruitee personal API token. |
| `RECRUITEE_BASE_URL` | no | Override of the API base URL. Default: https://api.recruitee.com |
| `RECRUITEE_READ_ONLY` | no | `true` exposes only the read tools. |
| `MCP_ACCESS_TOKEN`, `PORT`, `HOST` | HTTP mode | See remote mode above. |

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `list_jobs` | read | Job openings by status (published by default). |
| `get_job_pipeline` | read | One job's pipeline: candidates per stage with days in stage. |
| `search_candidates` | read | Candidates by name, email or keyword, optionally for one job. |
| `get_candidate` | read | A candidate's contact, jobs, current stages and latest team notes. |
| `get_hiring_summary` | read | Published jobs: candidates per stage, new this week, waiting over 7 days. |
| `add_candidate` | write | Add a candidate, optionally to a job; returns the existing one if the email is known. |
| `add_candidate_note` | write | Add an internal note to a candidate. |
| `move_candidate` | send | Move a candidate to another stage (automations may email them). Needs `confirm`. |

Tools that email or notify someone, or that delete, cancel or refund, take a `confirm` parameter: without
`confirm: true` they only return a preview of what would happen and change nothing.

## Example requests

- "How is hiring going? Who has been waiting too long?"
- "Where are we on the Sales Manager pipeline?"
- "Give me Hugo Bernard's profile and the team's notes before my interview."
- "Add Lea Moreau (lea@example.com) as a referral for the Backend Developer job."
- "Move Claire Martin to the Interview stage."

## Limits

- Interviews scheduling, emails to candidates, evaluations, offers and disqualification are not covered in this version.
- Candidate data is personal data: use an AI provider and settings your company has approved for HR data.
- Lists return the first 100 candidates per request; search by job or name on large accounts.
- Rate limits: on HTTP 429 the server waits (honouring `Retry-After`) and retries up to 3 times; reads are
  also retried on server errors, writes never are (no duplicates).

## Privacy

- No data is stored: no database, no cache on disk, no logs of your data. Credentials stay in your environment.
- No telemetry, no analytics, no calls to anything other than the Recruitee API.
- Tool results only contain the fields needed for the task.

## Development

This package lives in the [tethlo/connectors](https://github.com/tethlo/connectors) monorepo.

```bash
npm ci               # at the repository root
cd packages/recruitee
npm test             # unit tests on a simulated API, stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # optional live evaluation with Claude (needs ANTHROPIC_API_KEY); tools run on the simulated API
```

`eval/tasks.ts` holds 10 natural-language tasks with the expected tool. Offline, the tests check that each expected
call solves its task and that a word-overlap router (no LLM) picks the right tool from the descriptions alone.

## Disclaimer

This is an independent open-source project by Tethlo. It is not made, reviewed or supported by Recruitee.
You connect it with your own Recruitee account and API credentials; your use of the Recruitee API stays subject to
your agreement with Recruitee. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com
