// Offline agent evaluation (no LLM, no key): every task maps to an existing tool, the expected call solves it,
// and the tool descriptions are distinct enough for a word-overlap router to pick the right tool.
import assert from "node:assert/strict";
import { test } from "node:test";
import { rank } from "../eval/router.ts";
import { TASKS } from "../eval/tasks.ts";
import { connect, text } from "./helpers.ts";

test("the evaluation has 10 tasks covering every tool", async () => {
  const { client, close } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.equal(TASKS.length, 10);
  for (const task of TASKS) assert.ok(names.includes(task.tool), `${task.id}: unknown tool ${task.tool}`);
  assert.deepEqual([...new Set(TASKS.map((t) => t.tool))].sort(), [...names].sort());
  await close();
});

for (const task of TASKS) {
  test(`task "${task.id}": the expected call solves it`, async () => {
    const { call, close } = await connect();
    const result = await call(task.tool, task.args);
    assert.notEqual(result.isError, true, text(result));
    assert.ok(text(result).includes(task.expect), `expected ${task.expect} in ${text(result).slice(0, 300)}`);
    await close();
  });
}

test("tool descriptions route every task to the right tool (offline baseline)", async () => {
  const { client, close } = await connect();
  const { tools } = await client.listTools();
  const misses = TASKS.filter((task) => rank(task.prompt, tools)[0] !== task.tool).map(
    (task) => `${task.id} -> ${rank(task.prompt, tools)[0]} (expected ${task.tool})`,
  );
  assert.deepEqual(misses, []);
  await close();
});
