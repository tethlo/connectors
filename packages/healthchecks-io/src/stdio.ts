#!/usr/bin/env node
// Local mode: the MCP client (Claude Desktop, Claude Code, Cursor...) starts this process.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { apiFromEnv, createServer } from "./server.ts";

if (!process.env.HEALTHCHECKS_API_KEY) {
  console.error("HEALTHCHECKS_API_KEY is not set. Create a key in Healthchecks.io > Project Settings > API Access.");
  process.exit(1);
}

const server = createServer(apiFromEnv());
await server.connect(new StdioServerTransport());
// stdout is the protocol channel: log to stderr only.
console.error("tethlo-mcp-for-healthchecks-io running on stdio");
