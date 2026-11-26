#!/usr/bin/env node
// Entry point of the npm package: stdio by default, Streamable HTTP with --http.
// Shared file (source: shared/ at the repository root). Do not edit a copy.
if (process.argv.includes("--http")) {
  const { main } = await import("./http.ts");
  await main();
} else {
  const { main } = await import("./stdio.ts");
  await main();
}
