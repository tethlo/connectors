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
  { id: "lookup", prompt: "Is Jane Doe already a patient? I need her phone number.", tool: "find_patients", args: { query: "Jane Doe" }, expect: "07700 900001" },
  { id: "lookup-email", prompt: "Which patient has the email john@example.test?", tool: "find_patients", args: { query: "john@example.test" }, expect: "John Doherty" },
  { id: "next-visit", prompt: "When is patient 11's next visit, and what's her date of birth?", tool: "get_patient", args: { patient_id: "11" }, expect: "1985-04-02" },
  { id: "diary", prompt: "Who is booked in the diary tomorrow?", tool: "list_appointments", args: { from: "2026-11-25", to: "2026-11-25" }, expect: "\"count\":2" },
  { id: "diary-practitioner", prompt: "Show Sarah Smith's appointments this week.", tool: "list_appointments", args: { practitioner: "Sarah", from: "2026-11-23", to: "2026-11-29" }, expect: "\"count\":1" },
  { id: "staff", prompt: "Which practitioners work here and which appointment types can be booked?", tool: "list_practitioners_and_services", args: {}, expect: "Osteopath" },
  { id: "availability", prompt: "When does Sarah have availability for a follow-up this week?", tool: "find_available_times", args: { practitioner: "Sarah", service: "Follow-up" }, expect: "2026-11-26T11:30:00Z" },
  { id: "book", prompt: "Book patient 13 with Sarah Smith for a follow-up on Nov 27 at 14:00 UTC.", tool: "book_appointment", args: { patient_id: "13", practitioner: "Sarah Smith", service: "Follow-up", starts_at: "2026-11-27T14:00:00Z" }, expect: "Amy Stone" },
  { id: "cancel-preview", prompt: "Jane is sick: cancel appointment 501.", tool: "cancel_appointment", args: { appointment_id: "501", reason: "sick" }, expect: "\"needs_confirmation\":true" },
  { id: "cancel", prompt: "Yes, confirmed, go ahead and cancel appointment 502 now, the patient is away.", tool: "cancel_appointment", args: { appointment_id: "502", reason: "away", confirm: true }, expect: "\"done\":true" },
];
