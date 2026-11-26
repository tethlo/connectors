// Agent evaluation: 10 realistic requests, the tool an agent should call first, and arguments that solve the task.
// `expect` must appear in the tool result when called with `args` on the fake API.
export interface EvalTask {
  id: string;
  prompt: string;
  tool: string;
  args: Record<string, unknown>;
  expect: string;
}

export const TASKS: EvalTask[] = [
  { id: "overview", prompt: "How is hiring going overall? Who is stuck waiting?", tool: "get_hiring_summary", args: {}, expect: "Claire Martin" },
  { id: "new-applicants", prompt: "How many new applicants did we get in the last 7 days across our openings? Hiring summary please.", tool: "get_hiring_summary", args: {}, expect: "\"new_last_7_days\":1" },
  { id: "open-jobs", prompt: "Which job openings are published right now?", tool: "list_jobs", args: {}, expect: "Backend Developer" },
  { id: "pipeline", prompt: "Where are we on the Sales Manager pipeline, stage by stage?", tool: "get_job_pipeline", args: { job: "Sales Manager" }, expect: "Hugo Bernard" },
  { id: "find", prompt: "Search the candidates for Ines.", tool: "search_candidates", args: { query: "Ines" }, expect: "Backend Developer" },
  { id: "profile", prompt: "Before my interview, give me Hugo Bernard's profile and the team's notes.", tool: "get_candidate", args: { candidate: "Hugo Bernard" }, expect: "expects 55k" },
  { id: "referral", prompt: "Add a referral as a new candidate: Lea Moreau, lea@example.test, for the Backend Developer job.", tool: "add_candidate", args: { name: "Lea Moreau", email: "lea@example.test", job: "Backend Developer" }, expect: "\"action\":\"created\"" },
  { id: "feedback", prompt: "Add a note to Claire Martin: good culture fit, check references.", tool: "add_candidate_note", args: { candidate: "Claire Martin", note: "Good culture fit, check references." }, expect: "\"done\":true" },
  { id: "advance", prompt: "Move candidate 201 to the Interview stage.", tool: "move_candidate", args: { candidate: 201, stage: "Interview" }, expect: "\"needs_confirmation\":true" },
  { id: "advance-confirmed", prompt: "Confirmed: move candidate 202 to the Offer stage now.", tool: "move_candidate", args: { candidate: 202, stage: "Offer", confirm: true }, expect: "\"to\":\"Offer\"" },
];
