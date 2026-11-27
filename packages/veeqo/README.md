**Unofficial.** Not affiliated with, endorsed by or sponsored by Veeqo. Veeqo is a trademark of its owner.

# Tethlo MCP server for Veeqo (unofficial)

Run your e-commerce back office from Claude or ChatGPT: "How many orders are waiting to ship?", "Where is order #1042?", "What is low on stock?", "Set MUG-RED to 15 after the stock take". [Veeqo](https://www.veeqo.com) is inventory and order management software for sellers on several channels (Shopify, Amazon, eBay...).

This is an independent, open-source [Model Context Protocol](https://modelcontextprotocol.io) server. It works with
Claude, ChatGPT and any MCP client, using **your own Veeqo credentials**. It only calls the public, documented
Veeqo API.

## Why this one

- **8 tools for daily operations**: fulfilment queue, order lookup, stock, reorder list, warehouses, buyers, stock takes, notes.
- **Computed answers**: stock summed across warehouses, available vs. on hand, low-stock list sorted for reordering, orders counted per channel.
- **Plain words work**: orders by number (`#1042`, `AMZ-202-77`) or id; warehouses by name; SKUs case-insensitive.
- **Safe**: overwriting a stock count needs `confirm: true` after a preview showing before and after.

## Install

```bash
npx -y @tethlo/mcp-for-veeqo
```

Requirements: Node.js 20 or later, and a Veeqo API key (generated for your user in Veeqo's settings).

## Configure

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings > Developer > Edit Config), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "veeqo": {
      "command": "npx",
      "args": ["-y", "@tethlo/mcp-for-veeqo"],
      "env": {
        "VEEQO_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add veeqo -e VEEQO_API_KEY=your-api-key -- npx -y @tethlo/mcp-for-veeqo
```

### Other MCP clients (Cursor, VS Code, Windsurf, Cline, Zed...)

Use the same command (`npx -y @tethlo/mcp-for-veeqo`) and environment variables in the client's MCP settings
(`mcpServers` in Cursor's `mcp.json`, `servers` in VS Code's `mcp.json`).

### Remote mode (Streamable HTTP)

```bash
npx -y @tethlo/mcp-for-veeqo --http        # POST http://127.0.0.1:3000/mcp, GET /health
```

Stateless Streamable HTTP (one server per request, JSON responses). Two ways to authenticate:

- **Per user**: no credentials on the server; each client sends its own in the `x-veeqo-api-key` headers.
- **Single tenant**: set the credentials and `MCP_ACCESS_TOKEN` on the server; clients send
  `Authorization: Bearer <MCP_ACCESS_TOKEN>`. The server refuses to start with credentials but no access token.

Put it behind HTTPS before exposing it beyond your machine.

### Environment variables

| Variable | Required | What it is |
|---|---|---|
| `VEEQO_API_KEY` | yes | Veeqo API key. |
| `VEEQO_BASE_URL` | no | Override of the API base URL. Default: https://api.veeqo.com |
| `VEEQO_READ_ONLY` | no | `true` exposes only the read tools. |
| `MCP_ACCESS_TOKEN`, `PORT`, `HOST` | HTTP mode | See remote mode above. |

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `list_orders` | read | Orders by status (default: awaiting fulfilment), since a date, counted per channel. |
| `get_order` | read | One order by number or id: items, customer, destination, notes. |
| `find_products` | read | Products and variants by name or SKU with price and stock per warehouse. |
| `get_low_stock` | read | Variants at or below a stock threshold, lowest first. |
| `list_warehouses` | read | Warehouses with ids. |
| `find_customers` | read | Buyers by name or email. |
| `set_stock_level` | destructive | Overwrite the on-hand count of a SKU in a warehouse. Needs `confirm`. |
| `add_order_note` | write | Add an internal employee note to an order. |

Tools that email or notify someone, or that delete, cancel or refund, take a `confirm` parameter: without
`confirm: true` they only return a preview of what would happen and change nothing.

## Example requests

- "How many orders are waiting to be shipped, per sales channel?"
- "A buyer asks where order #1042 is: what's its status and what's in it?"
- "What is low on stock and needs reordering?"
- "After the stock take, set MUG-RED to 15 in the main warehouse."
- "Add a note on order 5002: hold until Monday."

## Limits

- Shipping labels, purchase orders, returns and product creation are not covered in this version.
- `get_low_stock` scans the first page of products (up to 100); large catalogues need a narrower query.
- Order notes use the order update endpoint with employee notes, as described in Veeqo's API docs.
- Rate limits: on HTTP 429 the server waits (honouring `Retry-After`) and retries up to 3 times; reads are
  also retried on server errors, writes never are (no duplicates).

## Privacy

- No data is stored: no database, no cache on disk, no logs of your data. Credentials stay in your environment.
- No telemetry, no analytics, no calls to anything other than the Veeqo API.
- Tool results only contain the fields needed for the task.

## Development

This package lives in the [tethlo/connectors](https://github.com/tethlo/connectors) monorepo.

```bash
npm ci               # at the repository root
cd packages/veeqo
npm test             # unit tests on a simulated API, stdio and HTTP transports, offline agent evaluation
npm run typecheck
npm run eval:claude  # optional live evaluation with Claude (needs ANTHROPIC_API_KEY); tools run on the simulated API
```

`eval/tasks.ts` holds 10 natural-language tasks with the expected tool. Offline, the tests check that each expected
call solves its task and that a word-overlap router (no LLM) picks the right tool from the descriptions alone.

## Disclaimer

This is an independent open-source project by Tethlo. It is not made, reviewed or supported by Veeqo.
You connect it with your own Veeqo account and API credentials; your use of the Veeqo API stays subject to
your agreement with Veeqo. The software is provided as is, without warranty (see LICENSE).

## License

MIT

---

Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com/?utm_source=connector-readme&utm_campaign=veeqo
