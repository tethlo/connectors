#!/usr/bin/env node
// Local mode: the MCP client (Claude Desktop, Claude Code, Cursor...) starts this process.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apiFromEnv, createServer } from "./server.ts";

if (!process.env.INVOICENINJA_API_TOKEN) {
  console.error("INVOICENINJA_API_TOKEN is not set. Create a token in Invoice Ninja > Settings > Account Management > API Tokens.");
  process.exit(1);
}

const server = createServer(apiFromEnv());
await server.connect(new StdioServerTransport());
// stdout is the protocol channel: log to stderr only.
console.error("tethlo-mcp-for-invoice-ninja running on stdio");
