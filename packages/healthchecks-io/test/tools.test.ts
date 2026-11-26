import assert from "node:assert/strict";
import { test } from "node:test";
import { seed } from "./fake-api.ts";
import { connect, data, text } from "./helpers.ts";

test("exposes 7 documented tools with safety annotations", async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "create_or_update_check",
    "delete_check",
    "diagnose_failures",
    "get_check_details",
    "list_checks",
    "list_notification_channels",
    "pause_or_resume_check",
  ]);
  for (const tool of tools) {
    assert.ok((tool.description ?? "").length > 80, `${tool.name} needs a real description`);
    assert.ok(tool.annotations, `${tool.name} needs annotations`);
  }
  assert.equal(tools.find((t) => t.name === "delete_check")?.annotations?.destructiveHint, true);
  assert.equal(tools.find((t) => t.name === "list_checks")?.annotations?.readOnlyHint, true);
  await close();
});

test("list_checks puts failing checks first and counts every status", async () => {
  const { call, close } = await connect();
  const result = data(await call("list_checks"));
  assert.equal(result.total_in_project, 5);
  assert.deepEqual(result.counts, { down: 1, grace: 1, new: 0, paused: 1, up: 2 });
  assert.deepEqual(result.checks.slice(0, 2).map((c: any) => c.name), ["Nightly DB backup", "Search reindex"]);
  assert.equal(result.checks[0].schedule, 'cron "15 2 * * *" (Europe/Paris)');
  const paused = data(await call("list_checks", { status: ["paused"] }));
  assert.deepEqual(paused.checks.map((c: any) => c.name), ["Newsletter sender"]);
  const limited = data(await call("list_checks", { limit: 2 }));
  assert.equal(limited.truncated, true);
  await close();
});

test("get_check_details finds a check from plain words", async () => {
  const { call, close } = await connect();
  const result = data(await call("get_check_details", { check: "invoice" }));
  assert.equal(result.check.name, "Invoice sync");
  assert.equal(result.check.schedule, "every 1h");
  assert.equal(result.average_run_seconds, 39.5);
  assert.equal(result.recent_pings.length, 3);
  await close();
});

test("an ambiguous name returns a helpful error, not a guess", async () => {
  const { call, close } = await connect();
  const result = await call("get_check_details", { check: "backup" });
  assert.equal(result.isError, true);
  assert.match(text(result), /matches 2 checks: "Nightly DB backup", "Staging backup"/);
  const missing = await call("get_check_details", { check: "payroll" });
  assert.match(text(missing), /No check matches "payroll"\. Existing checks:/);
  await close();
});

test("diagnose_failures explains each failing job with its logged output", async () => {
  const { call, close } = await connect();
  const result = data(await call("diagnose_failures"));
  assert.equal(result.all_ok, false);
  assert.equal(result.failing_count, 2);
  const [backup, reindex] = result.failing;
  assert.equal(backup.name, "Nightly DB backup");
  assert.match(backup.cause, /exit status 2/);
  assert.match(backup.failure_output, /password authentication failed/);
  assert.equal(backup.down_since, "2026-11-24T01:16:40+00:00");
  assert.match(reindex.cause, /started but never reported success/);
  const healthy = data(await call("diagnose_failures", { tag: "billing" }));
  assert.equal(healthy.all_ok, true);
  await close();
});

test("create_or_update_check creates a cron check and explains how to ping it", async () => {
  const { call, state, close } = await connect();
  const result = data(
    await call("create_or_update_check", { name: "Weekly report", cron: "0 8 * * 1", timezone: "Europe/Paris", tags: ["reports"] }),
  );
  assert.equal(result.action, "created");
  assert.equal(result.check.schedule, 'cron "0 8 * * 1" (Europe/Paris)');
  assert.match(result.how_to_ping, /curl -fsS -m 10 --retry 5/);
  const created = state.checks.find((c) => c.name === "Weekly report");
  assert.equal(created?.channels?.split(",").length, 2, "new checks alert every channel by default");
  await close();
});

test("create_or_update_check updates an existing check with the same name", async () => {
  const { call, state, close } = await connect();
  const result = data(await call("create_or_update_check", { name: "invoice sync", period_seconds: 1800, notify: ["#alerts"] }));
  assert.equal(result.action, "updated");
  assert.equal(state.checks.length, 5);
  assert.equal(state.checks[1].timeout, 1800);
  assert.equal(state.checks[1].channels, "11111111-0000-4000-8000-000000000002");
  await close();
});

test("create_or_update_check rejects bad combinations with clear errors", async () => {
  const { call, close } = await connect();
  const both = await call("create_or_update_check", { name: "X", cron: "* * * * *", period_seconds: 60 });
  assert.match(text(both), /exactly one of period_seconds or cron/);
  const channel = await call("create_or_update_check", { name: "X", period_seconds: 60, notify: ["Pager"] });
  assert.match(text(channel), /Unknown notification channel\(s\): Pager\. Available: "Ops email", "#alerts"/);
  const tooShort = await call("create_or_update_check", { name: "X", period_seconds: 5 });
  assert.equal(tooShort.isError, true);
  await close();
});

test("pause_or_resume_check pauses, resumes and handles 'not paused'", async () => {
  const { call, close } = await connect();
  assert.equal(data(await call("pause_or_resume_check", { check: "reindex", action: "pause" })).check.status, "paused");
  assert.equal(data(await call("pause_or_resume_check", { check: "newsletter", action: "resume" })).check.status, "new");
  assert.match(data(await call("pause_or_resume_check", { check: "Invoice sync", action: "resume" })).note, /not paused/);
  await close();
});

test("delete_check requires explicit confirmation", async () => {
  const { call, state, close } = await connect();
  const refused = await call("delete_check", { check: "Staging backup" });
  assert.equal(refused.isError, true);
  assert.equal(state.checks.length, 5);
  const done = data(await call("delete_check", { check: "Staging backup", confirm: true }));
  assert.equal(done.name, "Staging backup");
  assert.equal(state.checks.length, 4);
  await close();
});

test("list_notification_channels returns names and kinds", async () => {
  const { call, close } = await connect();
  const result = data(await call("list_notification_channels"));
  assert.deepEqual(result.channels.map((c: any) => `${c.name}:${c.kind}`), ["Ops email:email", "#alerts:slack"]);
  await close();
});

test("API failures become tool errors the agent can relay", async () => {
  const state = seed();
  const { call, close } = await connect(state);
  state.failNext = 403;
  const result = await call("list_checks");
  assert.equal(result.isError, true);
  assert.match(text(result), /Access denied/);
  await close();
});
