import assert from "node:assert/strict";
import { test } from "node:test";
import { connect, data, text } from "./helpers.ts";

test("requests are scoped to the company id", async () => {
  const { call, state, close } = await connect();
  data(await call("list_jobs", {}));
  assert.equal(state.calls[0], "GET /c/4242/offers");
  await close();
});

test("the pipeline lists candidates per stage with days in stage", async () => {
  const { call, close } = await connect();
  const p = data(await call("get_job_pipeline", { job: "sales" }));
  assert.equal(p.total, 3);
  assert.deepEqual(p.stages.map((s: any) => [s.stage, s.candidates.map((c: any) => c.name)]), [["Applied", []], ["Screening", ["Claire Martin"]], ["Interview", ["Hugo Bernard"]], ["Offer", []]]);
  assert.equal(p.stages[1].candidates[0].days_in_stage, 18);
  assert.equal(p.disqualified, 1);
  await close();
});

test("hiring summary flags candidates waiting more than 7 days", async () => {
  const { call, close } = await connect();
  const s = data(await call("get_hiring_summary"));
  assert.equal(s.open_jobs, 2);
  assert.equal(s.total_candidates, 3);
  assert.deepEqual(s.jobs[0].waiting_over_7_days, [{ name: "Claire Martin", stage: "Screening" }]);
  await close();
});

test("move_candidate resolves the stage in the right job and refuses unknown stages", async () => {
  const { call, state, close } = await connect();
  assert.match(text(await call("move_candidate", { candidate: "Claire Martin", stage: "Hired", confirm: true })), /Stages of Sales Manager: Applied, Screening, Interview, Offer/);
  const moved = data(await call("move_candidate", { candidate: "claire@example.test", stage: "interview", confirm: true }));
  assert.deepEqual([moved.from, moved.to], ["Screening", "Interview"]);
  assert.equal(state.candidates[0].placements[0].stage_id, 3);
  assert.match(text(await call("move_candidate", { candidate: 204, stage: "Interview", confirm: true })), /No active application matches/);
  await close();
});

test("add_candidate avoids duplicates and search needs a query or a job", async () => {
  const { call, state, close } = await connect();
  assert.equal(data(await call("add_candidate", { name: "Claire M.", email: "claire@example.test" })).action, "existing");
  assert.equal(state.candidates.length, 4);
  assert.match(text(await call("search_candidates", {})), /Give a query, a job, or both/);
  await close();
});
