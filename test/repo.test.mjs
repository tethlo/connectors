// Repository-wide rules: shared files in sync, naming, disclaimers, Tethlo footer, no secrets, registry metadata.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { connectors, differences, packages, REPO, ROOT } from '../scripts/sync-shared.mjs';

/** The first batch: folder -> brand name as written in the disclaimer. */
const BRANDS = {
  cliniko: 'Cliniko',
  deputy: 'Deputy',
  'healthchecks-io': 'Healthchecks.io',
  'housecall-pro': 'Housecall Pro',
  'invoice-ninja': 'Invoice Ninja',
  recruitee: 'Recruitee',
  veeqo: 'Veeqo',
  zammad: 'Zammad',
};
const DEMOS = ['healthchecks-io', 'invoice-ninja'];
const FOOTER = 'Built by Tethlo — MCP servers, ChatGPT apps and Claude connectors for B2B SaaS · https://tethlo.com';
const FORBIDDEN = /\b(official|officially|partner|partners|partnership|certified|native|natively)\b/i;
const read = (...parts) => readFileSync(join(...parts), 'utf8');

test('the first batch holds exactly 8 packages, 6 connectors on the shared runtime and 2 demos', () => {
  assert.deepEqual(packages(), Object.keys(BRANDS).sort());
  assert.deepEqual(connectors(), packages().filter((p) => !DEMOS.includes(p)));
});

test('the copies of the shared files are identical to shared/', () => {
  assert.deepEqual(differences(), []);
});

test('every README starts with the Unofficial disclaimer, has no forbidden words and ends with the Tethlo footer', () => {
  for (const [slug, brand] of Object.entries(BRANDS)) {
    const readme = read(ROOT, slug, 'README.md');
    assert.equal(
      readme.split('\n')[0],
      `**Unofficial.** Not affiliated with, endorsed by or sponsored by ${brand}. ${brand} is a trademark of its owner.`,
      `${slug}: first line`,
    );
    const hit = readme.match(FORBIDDEN);
    assert.equal(hit, null, `${slug}: forbidden word "${hit?.[0]}"`);
    assert.doesNotMatch(readme, /!\[|<img/i, `${slug}: no logos or images`);
    assert.doesNotMatch(readme, /Listed in ChatGPT/i, `${slug}: old showcase wording`);
    assert.equal(readme.trimEnd().split('\n').at(-1), `${FOOTER}/?utm_source=connector-readme&utm_campaign=${slug}`, `${slug}: footer`);
    assert.ok(readme.includes(`npx -y @tethlo/mcp-for-${slug}`), `${slug}: npx install command`);
    if (DEMOS.includes(slug)) assert.match(readme.split('\n')[2], /\(unofficial demo\)$/, `${slug}: marked as a demo`);
  }
});

test('the root README starts with the disclaimer policy, lists every package and has no forbidden words', () => {
  const readme = read(REPO, 'README.md');
  assert.match(readme.split('\n')[0], /^\*\*Unofficial\.\*\* /);
  assert.equal(readme.match(FORBIDDEN), null);
  for (const slug of Object.keys(BRANDS)) assert.ok(readme.includes(`npx -y @tethlo/mcp-for-${slug}`), slug);
  assert.ok(readme.includes('https://tethlo.com'));
  assert.match(read(REPO, 'LICENSE'), /^MIT License\n\nCopyright \(c\) 2026 Adrien Tchinda \(Tethlo\)\n/);
});

test('package.json and server.json: @tethlo names, GitHub namespace, monorepo subfolder, Unofficial first', () => {
  for (const [slug, brand] of Object.entries(BRANDS)) {
    const pkg = JSON.parse(read(ROOT, slug, 'package.json'));
    const server = JSON.parse(read(ROOT, slug, 'server.json'));
    assert.equal(pkg.name, `@tethlo/mcp-for-${slug}`);
    assert.deepEqual(Object.keys(pkg.bin), [`tethlo-mcp-for-${slug}`]);
    assert.equal(pkg.private, undefined, `${slug}: publishable`);
    assert.equal(pkg.license, 'MIT');
    assert.match(read(ROOT, slug, 'LICENSE'), /^MIT License/);
    assert.match(pkg.description, /^Unofficial /);
    assert.equal(pkg.mcpName, `io.github.tethlo/mcp-for-${slug}`);
    assert.deepEqual(pkg.repository, { type: 'git', url: 'git+https://github.com/tethlo/connectors.git', directory: `packages/${slug}` });
    assert.ok(pkg.files.includes('server.json') && pkg.files.includes('dist/src'));
    assert.equal(pkg.scripts.prepublishOnly, 'npm run typecheck && npm test && npm run build');

    assert.equal(server.$schema, 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
    assert.equal(server.name, pkg.mcpName);
    assert.match(server.title, new RegExp(`^Tethlo MCP server for ${brand.replace('.', '\\.')} \\(unofficial( demo)?\\)$`));
    assert.match(server.description, /^Unofficial/);
    assert.ok(server.description.length <= 100, `${slug}: registry description is 100 chars max`);
    assert.deepEqual(server.repository, { url: 'https://github.com/tethlo/connectors', source: 'github', subfolder: `packages/${slug}` });
    assert.equal(server.version, pkg.version);
    assert.equal(server.packages[0].identifier, pkg.name);
    assert.equal(server.packages[0].version, pkg.version);
    for (const v of server.packages[0].environmentVariables) assert.equal(typeof v.isSecret, 'boolean');
    for (const field of [pkg.description, server.title, server.description]) assert.equal(field.match(FORBIDDEN), null, `${slug}: ${field}`);
  }
});

test('no .env files, and every .env.example stays empty', () => {
  for (const slug of packages()) {
    assert.ok(!existsSync(join(ROOT, slug, '.env')), `${slug}: no .env in the repository`);
    const env = read(ROOT, slug, '.env.example');
    for (const line of env.split('\n').filter((l) => l && !l.startsWith('#'))) {
      assert.match(line, /^[A-Z_]+=(\d+|127\.0\.0\.1)?$/, `${slug}: .env.example must stay empty (${line})`);
    }
  }
});

test('the excluded connectors are not in this batch', () => {
  for (const slug of ['acuity', 'copper', 'copper-crm', 'lemonsqueezy', 'lemon-squeezy', 'moneybird']) {
    assert.ok(!existsSync(join(ROOT, slug)), slug);
  }
});

test('workflows: publish is manual, staged on npm, then the MCP Registry with OIDC; no secret value', () => {
  const publish = read(REPO, '.github/workflows/publish.yml');
  assert.match(publish, /workflow_dispatch:/);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /secrets\.NPM_TOKEN/);
  assert.match(publish, /mcp-publisher login github-oidc/);
  assert.match(publish, /npm stage publish --access public/);
  assert.match(publish, /2-mcp-registry/);
  for (const file of ['ci.yml', 'publish.yml']) {
    assert.doesNotMatch(read(REPO, '.github/workflows', file), /npm_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}/, file);
  }
});
