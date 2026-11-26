// Copies the shared files (shared/) into every connector package (packages/<slug> with src/core.ts), so that each
// package builds and publishes on its own. The demos (healthchecks-io, invoice-ninja) do not use the shared files.
//   node scripts/sync-shared.mjs          write the copies
//   node scripts/sync-shared.mjs --check  exit 1 if a copy differs (also checked by test/connectors.test.mjs)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = join(REPO, 'packages');
const SHARED = join(REPO, 'shared');

/** Every package folder (connectors and demos). */
export function packages() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(ROOT, d.name, 'package.json')))
    .map((d) => d.name)
    .sort();
}

/** Packages built on the shared runtime (they have src/core.ts). */
export function connectors() {
  return packages().filter((name) => existsSync(join(ROOT, name, 'src', 'core.ts')));
}

export function sharedFiles(dir = SHARED) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? sharedFiles(join(dir, d.name)) : [relative(SHARED, join(dir, d.name))],
  );
}

export function differences() {
  const out = [];
  for (const name of connectors()) {
    for (const file of sharedFiles()) {
      const target = join(ROOT, name, file);
      if (!existsSync(target) || readFileSync(target, 'utf8') !== readFileSync(join(SHARED, file), 'utf8')) out.push(`${name}/${file}`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const diff = differences();
    if (diff.length) {
      console.error(`Out of sync with shared/ (run node scripts/sync-shared.mjs):\n${diff.join('\n')}`);
      process.exit(1);
    }
    console.log(`${connectors().length} connectors in sync.`);
  } else {
    for (const name of connectors()) {
      for (const file of sharedFiles()) {
        const target = join(ROOT, name, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, readFileSync(join(SHARED, file)));
      }
    }
    console.log(`Synced ${sharedFiles().length} shared files into ${connectors().length} connectors.`);
  }
}
