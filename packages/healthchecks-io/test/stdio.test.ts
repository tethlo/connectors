import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = fileURLToPath(new URL("../src/stdio.ts", import.meta.url));

test("starts over stdio and lists its tools", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--no-warnings", entry],
    env: { PATH: process.env.PATH ?? "", HEALTHCHECKS_API_KEY: "test-key", HEALTHCHECKS_BASE_URL: "http://127.0.0.1:9" },
    stderr: "ignore",
  });
  const client = new Client({ name: "stdio-test", version: "0.0.0" });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 7);
  assert.match(client.getInstructions() ?? "", /diagnose_failures/);
  await client.close();
});
