// Local mode: the MCP client (Claude Desktop, Claude Code, Cursor...) starts this process and talks over stdin/stdout.
// Shared file (source: shared/ at the repository root). Do not edit a copy.
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { missingCredentials, writesEnabled } from "./core.ts";
import { apiFromEnv, CONNECTOR, createServer } from "./server.ts";

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const missing = missingCredentials(CONNECTOR, env);
  if (missing.length) {
    console.error(`${CONNECTOR.name}: set ${missing.join(" and ")} (see the README). Nothing is stored by this server.`);
    process.exit(1);
  }
  const server = createServer(apiFromEnv(env), { writes: writesEnabled(env, CONNECTOR.prefix) });
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel: log to stderr only.
  console.error(`${CONNECTOR.name} ${CONNECTOR.version} running on stdio${writesEnabled(env, CONNECTOR.prefix) ? "" : " (read-only)"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
