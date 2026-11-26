import assert from "node:assert/strict";
import { test } from "node:test";
import { connect, data, text } from "./helpers.ts";

test("schedule summary groups jobs by technician and flags unassigned ones", async () => {
  const { call, close } = await connect();
  const day = data(await call("get_schedule_summary", {}));
  assert.equal(day.jobs, 3);
  assert.equal(day.booked_revenue, 450);
  assert.deepEqual(day.by_technician.map((t: any) => [t.technician, t.count]), [["Carlos Diaz", 1], ["Amy Chen", 1]]);
  assert.equal(day.unassigned[0].description, "Leaking faucet");
  assert.equal(day.unscheduled_waiting, 1);
  await close();
});

test("list_jobs converts cents and filters by technician", async () => {
  const { call, state, close } = await connect();
  const amy = data(await call("list_jobs", { technician: "Amy" }));
  assert.deepEqual(amy.jobs.map((j: any) => j.id), ["job_2"]);
  assert.equal(amy.total, 120);
  assert.ok(state.calls.some((c) => c.includes("work_status%5B%5D=unscheduled&work_status%5B%5D=scheduled")));
  const done = data(await call("list_jobs", { status: "completed", from: "2026-11-01", to: "2026-11-30" }));
  assert.equal(done.balance_due, 150);
  await close();
});

test("ambiguous customers list the candidates", async () => {
  const { call, close } = await connect();
  assert.match(text(await call("list_jobs", { customer: "Robert" })), /matches 2 customers/);
  await close();
});

test("create_customer turns notifications off and avoids duplicates", async () => {
  const { call, state, close } = await connect();
  assert.equal(data(await call("create_customer", { first_name: "Rob", email: "rsmith@example.test" })).action, "existing");
  data(await call("create_customer", { first_name: "Mike", email: "mike@example.test", street: "77 Pine Rd" }));
  assert.equal((state.customers[3] as any).notifications_enabled, false);
  await close();
});

test("job notes are added and canceled jobs refused", async () => {
  const { call, state, close } = await connect();
  data(await call("add_job_note", { job_id: "job_1", note: "Bring a 50 gal tank." }));
  assert.deepEqual(data(await call("get_job", { job_id: "job_1" })).notes, ["Bring a 50 gal tank."]);
  state.jobs[1].work_status = "pro canceled";
  assert.match(text(await call("add_job_note", { job_id: "job_2", note: "x" })), /is canceled/);
  await close();
});
