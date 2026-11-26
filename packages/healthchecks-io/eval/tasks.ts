// Agent evaluation: 10 realistic requests, the tool an agent should call first, and arguments that solve the task.
// `expect` is a fragment that must appear in the tool result when called with `args` on the fake API.

export interface EvalTask {
  id: string;
  prompt: string;
  tool: string;
  args: Record<string, unknown>;
  expect: string;
}

export const TASKS: EvalTask[] = [
  {
    id: "what-is-broken",
    prompt: "I just got an alert email. What's broken right now and why?",
    tool: "diagnose_failures",
    args: {},
    expect: "password authentication failed",
  },
  {
    id: "overview",
    prompt: "Give me a quick overview of all my monitored jobs and their status.",
    tool: "list_checks",
    args: {},
    expect: "\"total_in_project\":5",
  },
  {
    id: "paused-list",
    prompt: "Which of my checks are currently paused?",
    tool: "list_checks",
    args: { status: ["paused"] },
    expect: "Newsletter sender",
  },
  {
    id: "last-run",
    prompt: "When did the invoice sync job last run, and how long does it usually take?",
    tool: "get_check_details",
    args: { check: "Invoice sync" },
    expect: "average_run_seconds",
  },
  {
    id: "outages-month",
    prompt: "How many times was the nightly DB backup down over the past month?",
    tool: "get_check_details",
    args: { check: "Nightly DB backup" },
    expect: "\"outages_30d\":2",
  },
  {
    id: "monitor-new-cron",
    prompt: "Start monitoring my weekly report script. It runs every Monday at 8:00 Paris time via cron.",
    tool: "create_or_update_check",
    args: { name: "Weekly report", cron: "0 8 * * 1", timezone: "Europe/Paris" },
    expect: "how_to_ping",
  },
  {
    id: "change-period",
    prompt: "The invoice sync now runs every 30 minutes instead of hourly, update its monitoring.",
    tool: "create_or_update_check",
    args: { name: "Invoice sync", period_seconds: 1800 },
    expect: "\"action\":\"updated\"",
  },
  {
    id: "maintenance",
    prompt: "We're doing database maintenance tonight. Silence alerts for the search reindex job.",
    tool: "pause_or_resume_check",
    args: { check: "Search reindex", action: "pause" },
    expect: "\"status\":\"paused\"",
  },
  {
    id: "remove",
    prompt: "We shut down staging. Delete the staging backup check, I confirm.",
    tool: "delete_check",
    args: { check: "Staging backup", confirm: true },
    expect: "\"deleted\":true",
  },
  {
    id: "who-is-alerted",
    prompt: "Who gets notified when a job fails? Is Slack set up?",
    tool: "list_notification_channels",
    args: {},
    expect: "slack",
  },
];
