// Shared file (source: shared/ at the repository root). Do not edit a copy.
// Live agent evaluation with Claude: for each task, does the model pick the right tool, with arguments that work?
// Needs ANTHROPIC_API_KEY (or an `ant auth login` profile). Tools run against the in-memory fake API, never a real account.
//
//   npm run eval:claude                  # default model
//   EVAL_MODEL=claude-sonnet-5-5 npm run eval:claude
import Anthropic from "@anthropic-ai/sdk";
import { CONNECTOR } from "../src/server.ts";
import { connect, text } from "../test/helpers.ts";
import { TASKS } from "./tasks.ts";

const MODEL = process.env.EVAL_MODEL ?? "claude-opus-5-5";
const MIN_SCORE = Number(process.env.EVAL_MIN_SCORE ?? 0.9);

const anthropic = new Anthropic();
const probe = await connect();
const { tools } = await probe.client.listTools();
const instructions = probe.client.getInstructions() ?? "";
await probe.close();

const claudeTools: Anthropic.Beta.Messages.BetaTool[] = tools.map((tool) => ({
  name: tool.name,
  description: tool.description ?? "",
  input_schema: tool.inputSchema as Anthropic.Beta.Messages.BetaTool.InputSchema,
}));

const results: Array<{ id: string; expected: string; picked: string | null; correct: boolean; executed: boolean; note?: string }> = [];

for (const task of TASKS) {
  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: `You are an assistant connected to the user's ${CONNECTOR.product} account through MCP tools. ${instructions}`,
      tools: claudeTools,
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: task.prompt }],
    });
    if (response.stop_reason === "refusal") {
      results.push({ id: task.id, expected: task.tool, picked: null, correct: false, executed: false, note: "refusal" });
      continue;
    }
    const call = response.content.find((block) => block.type === "tool_use");
    if (!call || call.type !== "tool_use") {
      results.push({ id: task.id, expected: task.tool, picked: null, correct: false, executed: false, note: "no tool call" });
      continue;
    }
    // Run the call the model chose on a fresh fake account to check that its arguments work.
    const session = await connect();
    const outcome = await session.call(call.name, call.input as Record<string, unknown>);
    await session.close();
    results.push({
      id: task.id,
      expected: task.tool,
      picked: call.name,
      correct: call.name === task.tool,
      executed: !outcome.isError,
      note: outcome.isError ? text(outcome).slice(0, 160) : undefined,
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || !(error instanceof Anthropic.APIError)) {
      console.error(`Cannot run the evaluation: ${error instanceof Error ? error.message : String(error)}`);
      console.error("Set ANTHROPIC_API_KEY (or run `ant auth login`), then retry.");
      process.exit(2);
    }
    results.push({ id: task.id, expected: task.tool, picked: null, correct: false, executed: false, note: `API error ${error.status}` });
  }
}

const score = results.filter((r) => r.correct && r.executed).length / results.length;
console.table(results);
console.log(JSON.stringify({ model: MODEL, tasks: results.length, score }, null, 2));
process.exit(score >= MIN_SCORE ? 0 : 1);
