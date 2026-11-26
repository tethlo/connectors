import assert from "node:assert/strict";
import { test } from "node:test";
import { apiFromEnv } from "../src/server.ts";
import { connect, data, text } from "./helpers.ts";

test("the host setting builds the install URL", async () => {
  const seen: string[] = [];
  const api = apiFromEnv({ DEPUTY_HOST: "https://acme.eu.deputy.com/", DEPUTY_ACCESS_TOKEN: "t" }, { fetch: async (input) => (seen.push(String(input)), new Response("[]")) });
  await api.areas();
  assert.equal(seen[0], "https://acme.eu.deputy.com/api/v1/resource/OperationalUnit");
});

test("get_roster names people and areas and totals hours", async () => {
  const { call, close } = await connect();
  const roster = data(await call("get_roster", { from: "2026-11-28", to: "2026-11-29" }));
  assert.equal(roster.count, 3);
  assert.equal(roster.total_hours, 22);
  assert.deepEqual(roster.shifts[0], { id: 501, employee: "Maya Patel", area: "Front of house", start: "2026-11-28T08:00Z", end: "2026-11-28T16:00Z", hours: 8, published: true });
  assert.equal(roster.shifts[2].employee, "(open shift)");
  await close();
});

test("find_open_shifts lists who is free on those days", async () => {
  const { call, close } = await connect();
  const gaps = data(await call("find_open_shifts", {}));
  assert.equal(gaps.open_shifts.length, 1);
  assert.deepEqual(gaps.free_staff_by_day, [{ day: "2026-11-29", not_rostered: ["Maya Patel", "Leo Martin", "Sara Kim"] }]);
  await close();
});

test("hours summary flags unapproved and in-progress timesheets", async () => {
  const { call, close } = await connect();
  const hours = data(await call("get_hours_summary", {}));
  assert.equal(hours.from, "2026-11-18");
  assert.deepEqual(hours.by_employee[0], { employee: "Maya Patel", hours: 15.5, cost: 310, timesheets: 2 });
  assert.equal(hours.not_approved, 1);
  assert.deepEqual(hours.in_progress, ["Sara Kim"]);
  await close();
});

test("create_shift handles overnight shifts and rejects absurd lengths", async () => {
  const { call, state, close } = await connect();
  const night = data(await call("create_shift", { area: "kitchen", date: "2026-11-30", start: "22:00", end: "06:00", confirm: true }));
  assert.equal(night.shift.end, "2026-12-01T06:00Z");
  assert.equal(night.shift.employee, "(open shift)");
  assert.equal(state.shifts.length, 5);
  assert.match(text(await call("create_shift", { area: "kitchen", date: "2026-11-30", start: "06:00", end: "23:30", confirm: true })), /longer than 16 hours/);
  await close();
});

test("leave decisions only apply to pending requests", async () => {
  const { call, close } = await connect();
  assert.match(text(await call("decide_leave_request", { leave_id: 72, decision: "decline", confirm: true })), /already approved/);
  assert.equal(data(await call("decide_leave_request", { leave_id: 71, decision: "decline", confirm: true })).leave.status, "declined");
  await close();
});
