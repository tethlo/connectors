**Unofficial.** Not affiliated with, endorsed by or sponsored by Invoice Ninja. Invoice Ninja is a trademark of its owner.

# Tethlo MCP server for Invoice Ninja (unofficial demo)

Run your invoicing from Claude, ChatGPT or any MCP client: "How much are we owed, and who should I
chase first?", "Bill Bluebird 450 for the logo animation", "Acme just wired 1,000 for invoice 0041".

[Invoice Ninja](https://invoiceninja.com) is an open-source invoicing, quotes and payments app for
freelancers and small businesses (hosted at invoicing.co or self-hosted). This server exposes it to
AI agents through the [Model Context Protocol](https://modelcontextprotocol.io).

> **Demo.** This server is a demonstration of how Tethlo builds MCP servers. It is tested and usable, but it has
> fewer guarantees than the connectors in this repository (no read-only switch, smaller scope).

## Why this server is different

- **Tools built for the job, not for the endpoints.** 8 tools cover the daily invoicing loop
  (find, bill, send, get paid, chase) instead of mirroring the hundreds of API endpoints.
  `get_receivables_summary` computes aging buckets and top debtors that the API does not return directly.
- **Plain words work.** Clients by name, part of the name or contact email; invoices by number
  (`0042`, `#0042`) or id. Ambiguous matches return the candidates with their emails.
- **Short, structured answers.** Status derived for humans (`overdue`, `partial`, `draft`…), days
  overdue, rounded amounts, compact JSON also sent as `structuredContent`.
- **Safe money handling.** Invoices are drafts unless `send: true`; payments cannot exceed the
  balance; nothing is sent to a client without an email; write requests are never retried
  automatically (no duplicate invoices or payments).
- **Errors an agent can act on.** Validation errors become one readable line; a 403 explains the
  hosted plan requirement.
- **Measured.** 10-task agent evaluation, checked offline in CI and runnable live against Claude.

## Tools

| Tool | What it does |
|---|---|
| `find_clients` | Search customers by name or email, with balance and paid to date; or list who owes money. |
| `create_client` | Add a customer with a primary contact; returns the existing one instead of a duplicate. |
| `list_invoices` | Invoices by client and status (draft, sent, partial, unpaid, overdue, paid), with totals and days overdue. |
| `get_invoice` | One invoice: client email, line items, totals, balance, status, portal link. |
| `create_invoice` | Bill a client from line items; draft by default, or create and email it. |
| `send_invoice` | Email an invoice, or a reminder (reminder1/2/3 templates). |
| `record_payment` | Record money received against an invoice (full balance by default). |
| `get_receivables_summary` | Total outstanding and overdue, aging buckets, top debtors, oldest overdue invoices. |

## Install

Requirements: Node.js 22.18 or later and an Invoice Ninja API
token (Settings > Account Management > API Tokens). On the hosted service, API access needs the Pro or
Enterprise plan; a self-hosted install is free.

```bash
npx -y @tethlo/mcp-for-invoice-ninja
```

The server reads `INVOICENINJA_API_TOKEN` from its environment: each user brings their own credentials.

### Local (stdio): Claude Desktop, Claude Code, Cursor

```json
{
  "mcpServers": {
    "invoiceninja": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-invoice-ninja"],
      "env": { "INVOICENINJA_API_TOKEN": "your-token" }
    }
  }
}
```

Claude Code: `claude mcp add invoiceninja -e INVOICENINJA_API_TOKEN=your-token -- npx -y @tethlo/mcp-for-invoice-ninja`

### Remote (Streamable HTTP): ChatGPT, Claude.ai connectors, hosted agents

```bash
npm run start:http        # POST http://127.0.0.1:3000/mcp, GET /health
```

From a clone of the repository (`cd packages/invoice-ninja`). Stateless Streamable HTTP, JSON responses, one MCP server per request. Two ways to authenticate:

- **Per user**: no token on the server; each client sends its own token in `X-InvoiceNinja-Api-Token`.
- **Single tenant**: set `INVOICENINJA_API_TOKEN` and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with a token but no access token.

For a public listing (ChatGPT app directory, Claude connector directory), put OAuth 2.1 in front of
the endpoint so users sign in instead of pasting tokens (not included in this demo).

To build plain JavaScript: `npm run build` (output in `dist/`).

## Limits

- This server only calls the API of your own Invoice Ninja account or instance; it does not host Invoice Ninja.
- No read-only switch in this demo: sending and payment tools are guarded by drafts, balance checks and no automatic retries on writes.

## Example conversation

> **User:** How much are customers owing us, and who should I chase first?
>
> *Claude calls `get_receivables_summary` →*
> `{"open_invoices":3,"total_outstanding":5400,"total_overdue":3700,"aging":{"not_due":1700,"1_30":0,"31_60":2500,"61_90":0,"over_90":1200},"top_debtors":[{"client":"Acme Corp","owed":4200},{"client":"Bluebird Studio","owed":1200}],"oldest_overdue":[{"number":"0043","client":"Bluebird Studio","days_overdue":102},{"number":"0041","client":"Acme Corp","days_overdue":54}]}`
>
> **Claude:** You are owed 5,400, of which 3,700 is overdue.
> Start with **Bluebird Studio**: invoice 0043 (1,200) is 102 days late. Then **Acme Corp**:
> invoice 0041 (2,500) is 54 days late. Acme's other open invoice (0042) is not due yet.
>
> **User:** Send Acme a polite reminder for 0041.
>
> *Claude calls `send_invoice {"invoice":"0041","template":"reminder1"}`* → **Claude:** Reminder sent to jane@acme.test.

(Data from the test fixtures.)

## Tests and evaluation

```bash
npm ci               # at the repository root
cd packages/invoice-ninja
npm test             # unit tests (fake API), stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # live evaluation: needs ANTHROPIC_API_KEY; tools run on the fake API, never your account
```

- `test/fake-api.ts` imitates the Invoice Ninja v5 API (shapes from Invoice Ninja's published OpenAPI file,
  simplified filters, 401/404/422 errors).
- `eval/tasks.ts` holds 10 natural-language tasks with the expected tool and arguments. Offline, the test
  suite checks that each expected call solves its task and that a word-overlap router (`eval/router.ts`, no LLM)
  picks the right tool from the descriptions alone.
- `eval/run-claude.ts` asks Claude (default `claude-opus-5-5`, override with `EVAL_MODEL`) to handle each task
  with the real tool list, runs the call it chose on the fake API and prints the score
  (correct tool and working arguments). It exits with 1 below `EVAL_MIN_SCORE` (default 0.9).

## Disclaimer

This is an independent open-source demo by Tethlo. It is not made, reviewed or supported by Invoice Ninja.
You connect it with your own Invoice Ninja account and API credentials; your use of the Invoice Ninja API stays subject to
your agreement with Invoice Ninja. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com/?utm_source=connector-readme&utm_campaign=invoice-ninja
