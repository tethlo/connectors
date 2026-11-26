**Unofficial.** Not affiliated with, endorsed by or sponsored by Cliniko. Cliniko is a trademark of its owner.

# Tethlo MCP server for Cliniko (unofficial)

Run the front desk of your clinic from Claude or ChatGPT: "Who is booked tomorrow?", "When can Sarah see Jane for a follow-up?", "Cancel 501, the patient is sick". [Cliniko](https://www.cliniko.com) is practice management software for allied health clinics (physiotherapy, chiropractic, osteopathy, psychology...).

This is an independent, open-source [Model Context Protocol](https://modelcontextprotocol.io) server. It works with
Claude, ChatGPT and any MCP client, using **your own Cliniko credentials**. It only calls the public, documented
Cliniko API.

## Why this one

- **Scheduling only, by design**: patients' contact details and appointments. Clinical notes, treatment notes and medical history are never requested.
- **7 tools for the front desk**: find a patient, diary, availability, book, cancel.
- **Names, not links**: Cliniko returns links between records; answers carry practitioner and service names.
- **Safe**: cancelling needs `confirm: true` after a preview; `CLINIKO_READ_ONLY=true` removes write tools.

## Install

```bash
npx -y @tethlo/mcp-for-cliniko
```

Requirements: Node.js 20 or later, and a Cliniko API key (My Info > Manage API keys). The key carries the permissions of its user and ends with your account's region (e.g. `-uk1`), which selects the right API host automatically.

## Configure

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "cliniko": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-cliniko"],
      "env": {
        "CLINIKO_API_KEY": "your-api-key-uk1"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add cliniko -e CLINIKO_API_KEY=your-api-key-uk1 -- npx -y @tethlo/mcp-for-cliniko
```

### Other MCP clients (Cursor, VS Code, Windsurf, Cline, Zed...)

Use the same command (`npx -y @tethlo/mcp-for-cliniko`) and environment variables in the client's MCP settings
(`mcpServers` in Cursor's `mcp.json`, `servers` in VS Code's `mcp.json`).

### Remote mode (Streamable HTTP)

```bash
npx -y @tethlo/mcp-for-cliniko --http        # POST http://127.0.0.1:3000/mcp, GET /health
```

Stateless Streamable HTTP (one server per request, JSON responses). Two ways to authenticate:

- **Per user**: no credentials on the server; each client sends its own in the `x-cliniko-api-key` headers.
- **Single tenant**: set the credentials and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with credentials but no access token.

Put it behind HTTPS before exposing it beyond your machine.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `CLINIKO_API_KEY` | yes | Cliniko API key (My Info > Manage API keys). |
| `CLINIKO_CONTACT_EMAIL` | no | Your email, added to the User-Agent as Cliniko asks API clients to identify themselves. |
| `CLINIKO_BASE_URL` | no | Override of the API base URL. Default: derived from the key, e.g. https://api.uk1.cliniko.com/v1 |
| `CLINIKO_READ_ONLY` | no | `true` exposes only the read tools. |
| `MCP_ACCESS_TOKEN`, `PORT`, `HOST` | HTTP mode | See remote mode above. |

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `find_patients` | read | Search patients by name or email: id, email, phone. |
| `get_patient` | read | One patient's contact details and upcoming appointments. |
| `list_appointments` | read | Diary between two dates (default: next 7 days), by practitioner or patient. |
| `list_practitioners_and_services` | read | Practitioners, appointment types with duration, locations. |
| `find_available_times` | read | Open times for a practitioner and service (7 days max per request). |
| `book_appointment` | write | Book an existing patient at an available time. |
| `cancel_appointment` | destructive | Cancel an appointment with a reason. Needs `confirm`. |

Tools that email or notify someone, or that delete, cancel or refund, take a `confirm` parameter: without
`confirm: true` they only return a preview of what would happen and change nothing.

## Example requests

- "Who is in the diary tomorrow, by practitioner?"
- "Is Jane Doe already a patient? When is her next visit?"
- "When can Sarah Smith see a new patient for an initial consultation this week?"
- "Book patient 13 with Ben for a follow-up on the first free slot on Thursday."
- "Cancel appointment 501, the patient is sick."

## Limits

- No clinical data: treatment notes, medical alerts, attachments and invoices are out of scope on purpose.
- Group appointments, new patient creation and payments are not covered in this version.
- Patient data is health-related personal data: use it with an AI provider and account settings your clinic has approved, and share answers only with authorised staff.
- Rate limits: on HTTP 429 the server waits (honouring `Retry-After`) and retries up to 3 times; reads are
  also retried on server errors, writes never are (no duplicates).

## Privacy

- No data is stored: no database, no cache on disk, no logs of your data. Credentials stay in your environment.
- No telemetry, no analytics, no calls to anything other than the Cliniko API.
- Tool results only contain the fields needed for the task.

## Development

This package lives in the [tethlo/connectors](https://github.com/tethlo/connectors) monorepo.

```bash
npm ci               # at the repository root
cd packages/cliniko
npm test             # unit tests on a simulated API, stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # optional live evaluation with Claude (needs ANTHROPIC_API_KEY); tools run on the simulated API
```

`eval/tasks.ts` holds 10 natural-language tasks with the expected tool. Offline, the tests check that each expected
call solves its task and that a word-overlap router (no LLM) picks the right tool from the descriptions alone.

## Disclaimer

This is an independent open-source project by Tethlo. It is not made, reviewed or supported by Cliniko.
You connect it with your own Cliniko account and API credentials; your use of the Cliniko API stays subject to
your agreement with Cliniko. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com
