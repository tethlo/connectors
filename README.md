**Unofficial.** Every server in this repository is unofficial: not affiliated with, endorsed by or sponsored by the
companies whose APIs it calls. Their names are trademarks of their owners and are used only to say which product a
server works with.

# Tethlo connectors

Open-source [Model Context Protocol](https://modelcontextprotocol.io) (MCP) servers that let Claude, ChatGPT and any
MCP client work with B2B SaaS tools through their public APIs. Each server is a small npm package that you run
yourself, with **your own API key**. Nothing goes through Tethlo.

This monorepo holds the first batch: 6 connectors and 2 demos.

## Servers

| Package | Works with | What it does | Install |
|---|---|---|---|
| [`@tethlo/mcp-for-cliniko`](packages/cliniko) | Cliniko | Clinic front desk: find patients, diary, availability, book and cancel appointments (no clinical notes). | `npx -y @tethlo/mcp-for-cliniko` |
| [`@tethlo/mcp-for-deputy`](packages/deputy) | Deputy | Workforce: roster, open shifts, leave requests and approvals, worked hours. | `npx -y @tethlo/mcp-for-deputy` |
| [`@tethlo/mcp-for-recruitee`](packages/recruitee) | Recruitee | Hiring: jobs, pipelines, candidates, notes and stage moves. | `npx -y @tethlo/mcp-for-recruitee` |
| [`@tethlo/mcp-for-zammad`](packages/zammad) | Zammad | Helpdesk: ticket search, conversations, queue overview, internal notes and replies. | `npx -y @tethlo/mcp-for-zammad` |
| [`@tethlo/mcp-for-veeqo`](packages/veeqo) | Veeqo | Multichannel orders, stock per warehouse, low-stock alerts and order notes. | `npx -y @tethlo/mcp-for-veeqo` |
| [`@tethlo/mcp-for-housecall-pro`](packages/housecall-pro) | Housecall Pro | Home services (US and Canada): customers, jobs, dispatch schedule, estimates and job notes. | `npx -y @tethlo/mcp-for-housecall-pro` |
| [`@tethlo/mcp-for-healthchecks-io`](packages/healthchecks-io) (demo) | Healthchecks.io | Cron job monitoring: what is down and why, pause, create and delete checks. | `npx -y @tethlo/mcp-for-healthchecks-io` |
| [`@tethlo/mcp-for-invoice-ninja`](packages/invoice-ninja) (demo) | Invoice Ninja | Invoicing: clients, invoices, reminders, payments and receivables. | `npx -y @tethlo/mcp-for-invoice-ninja` |

Each package README gives the exact setup for Claude Desktop, Claude Code, Cursor and other clients, the
environment variables, the tools, examples and limits. The two demos show how Tethlo builds MCP servers: they are
tested and usable, with a smaller scope and no read-only switch.

Requirements: Node.js 22.18 or later (the connectors also run on Node.js 20).

## Bring your own API key

- Every user creates an API key or token in **their own account** of the product (each README says where) and puts
  it in the environment of the MCP client, for example in `claude_desktop_config.json`:

  ```json
  {
    "mcpServers": {
      "cliniko": {
        "command": "npx",
        "args": ["-y", "@tethlo/mcp-for-cliniko"],
        "env": { "CLINIKO_API_KEY": "your-own-key" }
      }
    }
  }
  ```

- The key carries the permissions of the user who created it. Use a key with the smallest permissions that does the
  job (a read-only key where the product offers one).
- The servers call only the public, documented API of the product. Your use of that API stays subject to your own
  agreement with the product's company.
- No Tethlo account, no proxy, no telemetry: the server runs on your machine (stdio) or on your own server (Streamable
  HTTP) and talks only to the product's API.

## Security

- **Confirmations on destructive tools.** Tools that delete, cancel, refund, or email or notify someone take a
  `confirm` parameter. Without `confirm: true` they return a preview and change nothing, so the assistant must show
  the preview and get your approval first. Destructive tools also carry the MCP `destructiveHint` annotation; read
  tools carry `readOnlyHint`.
- **Read-only mode.** In the 6 connectors, `<PRODUCT>_READ_ONLY=true` (for example `CLINIKO_READ_ONLY=true`) removes
  every write tool. The demos have no switch: use a read-only key where the product offers one (Healthchecks.io does).
- **No duplicates.** In the 6 connectors and the Invoice Ninja demo, write requests are never retried automatically;
  reads are retried on rate limits (honouring `Retry-After`) and on server errors. The Healthchecks.io demo retries any
  request once on 429 or 5xx; its write tools are idempotent (create-or-update by name, pause, resume, delete).
- **Remote mode.** The HTTP mode listens on `127.0.0.1` by default and refuses to start with credentials set on the
  server unless `MCP_ACCESS_TOKEN` is also set. Put it behind HTTPS before exposing it.
- **Nothing stored.** No database, no cache on disk, no logs of your data. Tool results keep only the fields the task
  needs.
- Never commit a filled-in `.env`: only empty `.env.example` files are in this repository.

Found a security issue? Open a private security advisory on this repository (Security > Report a vulnerability).

## Names and disclaimer policy

- Packages are named `@tethlo/mcp-for-<product>`: the publisher comes first, the product name only says what the
  server works with.
- The first line of every README is: "**Unofficial.** Not affiliated with, endorsed by or sponsored by
  &lt;Product&gt;. &lt;Product&gt; is a trademark of its owner." The npm description and the MCP Registry description
  start with "Unofficial".
- No logos, colours or screenshots of the products, and no wording that suggests a relationship with them. A test
  (`test/repo.test.mjs`) checks these rules on every README.
- If you represent one of these companies and want a change (wording, name, removal), open an issue and we will
  answer quickly.

## Development

```bash
npm ci
npm run typecheck   # tsc in every package
npm test            # repository rules, then every package's tests (simulated APIs, no credentials needed)
npm run build       # plain JavaScript in packages/*/dist
```

- `packages/<slug>/`: one npm package per server.
- `shared/`: runtime, tests and evaluation helpers shared by the 6 connectors. `npm run sync` copies them into each
  connector, so every package builds and publishes on its own; `npm test` fails if a copy differs.
- Releases: `.github/workflows/publish.yml`, run by hand (one package or all). It publishes to npm with provenance,
  then to the MCP Registry under `io.github.tethlo/mcp-for-<slug>` with a GitHub OIDC login.

## License

MIT. See [LICENSE](LICENSE); each package also carries its own MIT license file.

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com
