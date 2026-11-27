// Shared file (source: shared/ at the repository root). Do not edit a copy.
// Rules every connector follows: tool design, safety, packaging, README and registry metadata.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { CONNECTOR } from "../src/server.ts";
import { CONFIRM_CALLS, connect, EXPECTED_TOOLS, text } from "./helpers.ts";

const root = new URL("../", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const serverJson = JSON.parse(read("server.json"));
const readme = read("README.md");

test("5 to 10 agent-oriented tools with descriptions and annotations", async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED_TOOLS].sort());
  assert.ok(tools.length >= 5 && tools.length <= 10, `${tools.length} tools`);
  for (const tool of tools) {
    assert.match(tool.name, /^[a-z]+(_[a-z]+)+$/, `${tool.name}: verb_object names`);
    assert.ok((tool.description ?? "").length >= 80, `${tool.name} needs a real description`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} needs annotations`);
  }
  assert.ok(tools.filter((t) => t.annotations?.readOnlyHint).length >= tools.length / 2, "read tools first");
  await close();
});

/** A call that changes data: not a GET, and not a search sent with POST (".../QUERY", ".../search"). */
const isWrite = (call: string) => !call.startsWith("GET ") && !/\/(QUERY|search)(\?|$)/.test(call);

test("send and destructive tools require confirm and change nothing without it", async () => {
  const { client, call, state, close } = await connect();
  const { tools } = await client.listTools();
  const gated = tools.filter((t) => t.annotations?.destructiveHint || "confirm" in ((t.inputSchema.properties as object) ?? {}));
  for (const tool of tools.filter((t) => t.annotations?.destructiveHint)) {
    assert.ok("confirm" in ((tool.inputSchema.properties as object) ?? {}), `${tool.name} must take confirm`);
  }
  assert.deepEqual(CONFIRM_CALLS.map((c) => c.tool).sort(), gated.map((t) => t.name).sort());
  for (const { tool, args } of CONFIRM_CALLS) {
    const before = state.calls.filter(isWrite).length;
    const result = await call(tool, args);
    assert.notEqual(result.isError, true, `${tool}: ${text(result)}`);
    assert.match(text(result), /"needs_confirmation":true/, tool);
    assert.equal(state.calls.filter(isWrite).length, before, `${tool} wrote without confirm`);
  }
  await close();
});

test("read-only mode removes every write tool", async () => {
  const { client, close } = await connect(undefined, { writes: false });
  const { tools } = await client.listTools();
  assert.ok(tools.length >= 3);
  for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true, tool.name);
  await close();
});

test("package: @tethlo/mcp-for-<slug>, MIT, npx entry, pinned dependencies", () => {
  const slug = CONNECTOR.name.replace(/^tethlo-mcp-for-/, "");
  assert.match(CONNECTOR.name, /^tethlo-mcp-for-[a-z0-9-]+$/);
  assert.equal(pkg.name, `@tethlo/mcp-for-${slug}`);
  assert.equal(pkg.version, CONNECTOR.version);
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.description, /^Unofficial /);
  assert.equal(pkg.private, undefined, "published packages are not private");
  assert.match(read("LICENSE"), /^MIT License/);
  assert.deepEqual(pkg.bin, { [CONNECTOR.name]: "dist/src/cli.js" });
  assert.equal(pkg.mcpName, serverJson.name);
  assert.equal(pkg.repository.url, "git+https://github.com/tethlo/connectors.git");
  assert.equal(pkg.repository.directory, `packages/${slug}`);
  for (const version of Object.values(pkg.dependencies) as string[]) assert.match(version, /^\d+\.\d+\.\d+$/);
});

test("README: disclaimer first, no logo, required sections, Tethlo footer", () => {
  assert.equal(
    readme.split("\n")[0],
    `**Unofficial.** Not affiliated with, endorsed by or sponsored by ${CONNECTOR.product}. ${CONNECTOR.product} is a trademark of its owner.`,
  );
  assert.doesNotMatch(readme, /!\[|<img|\.svg|\.png/i, "no logos or images");
  assert.doesNotMatch(readme, /\b(official|partner|partners|certified|native|natively)\b/i, "no wording that implies a relationship");
  for (const section of ["## Install", "## Configure", "## Tools", "## Example requests", "## Limits", "## Privacy"]) {
    assert.ok(readme.includes(section), `missing ${section}`);
  }
  assert.ok(readme.includes(`npx -y ${pkg.name}`));
  for (const name of EXPECTED_TOOLS) assert.ok(readme.includes(`\`${name}\``), `README lists ${name}`);
  assert.match(
    readme.trimEnd().split("\n").at(-1) ?? "",
    /^Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https:\/\/tethlo\.com\/\?utm_source=connector-readme&utm_campaign=[a-z0-9-]+$/,
  );
  const files = readdirSync(root, { recursive: true }).map(String).filter((f) => !/^(node_modules|dist)([\\/]|$)/.test(f));
  assert.deepEqual(files.filter((f) => /\.(png|jpe?g|svg|ico|gif|webp)$/i.test(f)), []);
});

test("server.json follows the MCP registry schema (2025-12-11)", () => {
  assert.equal(serverJson.$schema, "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
  assert.equal(serverJson.name, `io.github.tethlo/${pkg.name.replace(/^@tethlo\//, "")}`);
  assert.match(serverJson.description, /^Unofficial/);
  assert.ok(serverJson.description.length >= 1 && serverJson.description.length <= 100, "description is 1-100 chars");
  assert.ok(serverJson.title.length <= 100);
  assert.equal(serverJson.version, pkg.version);
  assert.deepEqual(serverJson.repository, {
    url: "https://github.com/tethlo/connectors",
    source: "github",
    subfolder: pkg.repository.directory,
  });
  const [npm] = serverJson.packages;
  assert.equal(npm.registryType, "npm");
  assert.equal(npm.identifier, pkg.name);
  assert.equal(npm.version, pkg.version);
  assert.deepEqual(npm.transport, { type: "stdio" });
  assert.deepEqual(
    npm.environmentVariables.map((v: { name: string }) => v.name),
    CONNECTOR.credentials.map((c) => c.env),
  );
  for (const variable of npm.environmentVariables) {
    const credential = CONNECTOR.credentials.find((c) => c.env === variable.name)!;
    assert.equal(variable.isRequired, !credential.optional, variable.name);
    assert.equal(typeof variable.description, "string");
  }
});
