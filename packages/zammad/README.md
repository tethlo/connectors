**Unofficial.** Not affiliated with, endorsed by or sponsored by Zammad. Zammad is a trademark of its owner.

# Tethlo MCP server for Zammad (unofficial)

Work your support queue from Claude or ChatGPT: "What needs attention?", "Summarise ticket 31002", "Reply to Jane that the corrected invoice is on its way and close it". [Zammad](https://zammad.org) is an open-source helpdesk, self-hosted or hosted by Zammad GmbH.

This is an independent, open-source [Model Context Protocol](https://modelcontextprotocol.io) server. It works with
Claude, ChatGPT and any MCP client, using **your own Zammad credentials**. It only calls the public, documented
Zammad API.

## Why this one

- **8 tools for the support desk**: search, read, queue overview, create, note, reply, update.
- **Computed answers**: `get_queue_summary` counts open tickets by state, group and priority, unassigned tickets and the oldest ones.
- **Readable conversations**: HTML emails are turned into plain text and long messages are trimmed.
- **Safe**: emailing the customer needs `confirm: true` after showing the draft; internal notes never reach customers.

## Install

```bash
npx -y @tethlo/mcp-for-zammad
```

Requirements: Node.js 20 or later, and your Zammad URL and an access token (Profile > Token Access, with the `ticket.agent` permission).

## Configure

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "zammad": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-zammad"],
      "env": {
        "ZAMMAD_URL": "https://support.example.com",
        "ZAMMAD_TOKEN": "your-token"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add zammad -e ZAMMAD_URL=https://support.example.com -e ZAMMAD_TOKEN=your-token -- npx -y @tethlo/mcp-for-zammad
```

### Other MCP clients (Cursor, VS Code, Windsurf, Cline, Zed...)

Use the same command (`npx -y @tethlo/mcp-for-zammad`) and environment variables in the client's MCP settings
(`mcpServers` in Cursor's `mcp.json`, `servers` in VS Code's `mcp.json`).

### Remote mode (Streamable HTTP)

```bash
npx -y @tethlo/mcp-for-zammad --http        # POST http://127.0.0.1:3000/mcp, GET /health
```

Stateless Streamable HTTP (one server per request, JSON responses). Two ways to authenticate:

- **Per user**: no credentials on the server; each client sends its own in the `x-zammad-token` headers.
- **Single tenant**: set the credentials and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with credentials but no access token.

Put it behind HTTPS before exposing it beyond your machine.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `ZAMMAD_URL` | yes | Your Zammad address, e.g. https://support.example.com. In remote mode this is a server setting. |
| `ZAMMAD_TOKEN` | yes | Zammad access token (Profile > Token Access, permission ticket.agent). |
| `ZAMMAD_READ_ONLY` | no | `true` exposes only the read tools. |
| `MCP_ACCESS_TOKEN`, `PORT`, `HOST` | HTTP mode | See remote mode above. |

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `search_tickets` | read | Find tickets by words, customer email, state, group or priority. |
| `get_ticket` | read | A ticket with its last messages and internal notes as plain text. |
| `find_customers` | read | Look up customers by name, email or organization. |
| `get_queue_summary` | read | Open tickets by state, group and priority; unassigned; oldest. |
| `create_ticket` | write | Open a ticket for a customer email in a group (no email sent). |
| `add_internal_note` | write | Add an internal note (never visible to the customer). |
| `reply_to_customer` | send | Email the customer on a ticket, optionally changing its state. Needs `confirm`. |
| `update_ticket` | write | Change state, priority or owner. |

Tools that email or notify someone, or that delete, cancel or refund, take a `confirm` parameter: without
`confirm: true` they only return a preview of what would happen and change nothing.

## Example requests

- "How is the support queue doing? What needs attention first?"
- "Summarise ticket 31002 and suggest a reply."
- "Which open tickets do we have from globex.com?"
- "Reply to the customer on 31001 that the corrected invoice is on its way, then close it."
- "Assign 31001 to tom@example.com with high priority."

## Limits

- Attachments, tags, macros, time accounting, SLAs and knowledge base are not covered in this version.
- State and priority names are Zammad's defaults (`open`, `pending reminder`, `closed`; `1 low`, `2 normal`, `3 high`).
- In remote mode, `ZAMMAD_URL` is a server setting: one deployment serves one Zammad instance. Nothing is deleted.
- Rate limits: on HTTP 429 the server waits (honouring `Retry-After`) and retries up to 3 times; reads are
  also retried on server errors, writes never are (no duplicates).

## Privacy

- No data is stored: no database, no cache on disk, no logs of your data. Credentials stay in your environment.
- No telemetry, no analytics, no calls to anything other than the Zammad API.
- Tool results only contain the fields needed for the task.

## Development

This package lives in the [tethlo/connectors](https://github.com/tethlo/connectors) monorepo.

```bash
npm ci               # at the repository root
cd packages/zammad
npm test             # unit tests on a simulated API, stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # optional live evaluation with Claude (needs ANTHROPIC_API_KEY); tools run on the simulated API
```

`eval/tasks.ts` holds 10 natural-language tasks with the expected tool. Offline, the tests check that each expected
call solves its task and that a word-overlap router (no LLM) picks the right tool from the descriptions alone.

## Disclaimer

This is an independent open-source project by Tethlo. It is not made, reviewed or supported by Zammad.
You connect it with your own Zammad account and API credentials; your use of the Zammad API stays subject to
your agreement with Zammad. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com/?utm_source=connector-readme&utm_campaign=zammad
