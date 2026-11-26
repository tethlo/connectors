// In-memory imitation of the Cliniko API v1, for the tests and the agent evaluation.
// Shapes follow the public docs (docs.api.cliniko.com); the q[] filter syntax is implemented for the operators used here.
import type { Appointment, AppointmentType, Business, Patient, Practitioner } from "../src/api.ts";

export const NOW = "2026-11-24T08:00:00Z";
const KEY = "MS0xLXRlc3Qta2V5-uk1";
export const TEST_ENV = { CLINIKO_API_KEY: KEY, CLINIKO_BASE_URL: "https://cliniko.test/v1" };
export const PER_USER_HEADERS = { "x-cliniko-api-key": KEY };
const AUTH = `Basic ${Buffer.from(`${KEY}:`).toString("base64")}`;

export const EXPECTED_TOOLS = [
  "find_patients",
  "get_patient",
  "list_appointments",
  "list_practitioners_and_services",
  "find_available_times",
  "book_appointment",
  "cancel_appointment",
];

export const HTTP_PROBE = { tool: "find_patients", args: { query: "Doe" }, expect: /Jane Doe/ };
export const CONFIRM_CALLS = [{ tool: "cancel_appointment", args: { appointment_id: "501" } }];

export interface FakeState {
  patients: Patient[];
  appointments: Appointment[];
  practitioners: Practitioner[];
  types: AppointmentType[];
  businesses: Business[];
  calls: string[];
}

const link = (kind: string, id: string) => ({ links: { self: `https://cliniko.test/v1/${kind}/${id}` } });
const appt = (id: string, starts: string, patient: Patient, practitioner: string, type: string): Appointment => ({
  id, starts_at: starts, ends_at: starts.replace(/T(\d\d)/, (_, h) => `T${String(Number(h) + 1).padStart(2, "0")}`),
  patient_name: `${patient.first_name} ${patient.last_name}`, notes: null, cancelled_at: null, did_not_arrive: false,
  appointment_type: link("appointment_types", type), practitioner: link("practitioners", practitioner),
  patient: link("patients", patient.id), business: link("businesses", "1"),
});

export function seed(): FakeState {
  const jane: Patient = { id: "11", first_name: "Jane", last_name: "Doe", email: "jane@example.test", date_of_birth: "1985-04-02", patient_phone_numbers: [{ number: "07700 900001", phone_type: "Mobile" }] };
  const john: Patient = { id: "12", first_name: "John", last_name: "Doherty", email: "john@example.test", patient_phone_numbers: [] };
  const amy: Patient = { id: "13", first_name: "Amy", last_name: "Stone", email: null, patient_phone_numbers: [{ number: "07700 900003" }] };
  return {
    patients: [jane, john, amy, { id: "14", first_name: "Old", last_name: "Doe", archived_at: "2025-01-01T00:00:00Z" }],
    practitioners: [
      { id: "1", first_name: "Sarah", last_name: "Smith", designation: "Physiotherapist", active: true },
      { id: "2", first_name: "Ben", last_name: "Okafor", designation: "Osteopath", active: true },
    ],
    types: [
      { id: "21", name: "Initial consultation", duration_in_minutes: 60 },
      { id: "22", name: "Follow-up", duration_in_minutes: 30 },
    ],
    businesses: [{ id: "1", business_name: "Riverside Clinic" }],
    appointments: [
      appt("501", "2026-11-25T09:00:00Z", jane, "1", "22"),
      appt("502", "2026-11-25T10:00:00Z", john, "2", "21"),
      appt("503", "2026-12-03T09:00:00Z", jane, "1", "22"),
    ],
    calls: [],
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Applies Cliniko q[] filters: field:=value, field:~value (contains), field:>=value, field:<value. */
function filter<T>(items: T[], filters: string[], value: (item: T, field: string) => string): T[] {
  return items.filter((item) =>
    filters.every((f) => {
      const [, field, op, wanted] = f.match(/^(\w+):(>=|<=|=|~|<|>)(.*)$/) ?? [];
      const actual = value(item, field) ?? "";
      if (op === "=") return actual === wanted;
      if (op === "~") return actual.toLowerCase().includes(wanted.toLowerCase());
      if (op === ">=") return actual >= wanted;
      if (op === "<") return actual < wanted;
      return true;
    }),
  );
}

const TIMES = ["2026-11-26T09:00:00Z", "2026-11-26T11:30:00Z", "2026-11-27T14:00:00Z"];

export function fakeFetch(state: FakeState = seed()): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    state.calls.push(`${method} ${url.pathname}${url.search}`);
    const headers = new Headers(init?.headers);
    if (headers.get("Authorization") !== AUTH) return json(401, { message: "Unauthorized" });
    if (!headers.get("User-Agent")) return json(400, { message: "User-Agent required" });
    const path = url.pathname.replace(/^\/v1/, "");
    const q = url.searchParams.getAll("q[]");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    let m: RegExpMatchArray | null;

    if (path === "/patients") {
      const list = filter(state.patients, q, (p, f) => String((p as unknown as Record<string, unknown>)[f] ?? ""));
      return json(200, { patients: list, total_entries: list.length });
    }
    if ((m = path.match(/^\/patients\/(\w+)$/))) {
      const found = state.patients.find((p) => p.id === m![1]);
      return found ? json(200, found) : json(404, { message: "Not found" });
    }
    if (path === "/individual_appointments" && method === "GET") {
      const list = filter(state.appointments, q, (a, f) =>
        f === "patient_id" ? a.patient.links.self.split("/").pop()! : f === "practitioner_id" ? a.practitioner.links.self.split("/").pop()! : String((a as unknown as Record<string, unknown>)[f] ?? ""),
      ).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
      return json(200, { individual_appointments: list, total_entries: list.length });
    }
    if (path === "/individual_appointments" && method === "POST") {
      if (!TIMES.includes(body.starts_at)) return json(422, { errors: { starts_at: ["is not available"] } });
      const patient = state.patients.find((p) => p.id === body.patient_id);
      if (!patient) return json(422, { errors: { patient: ["must exist"] } });
      const created = appt(String(600 + state.appointments.length), body.starts_at, patient, body.practitioner_id, body.appointment_type_id);
      state.appointments.push(created);
      return json(201, created);
    }
    if ((m = path.match(/^\/individual_appointments\/(\w+)(\/cancel)?$/))) {
      const found = state.appointments.find((a) => a.id === m![1]);
      if (!found) return json(404, { message: "Not found" });
      if (m[2] && method === "PATCH") {
        found.cancelled_at = NOW;
        return new Response(null, { status: 204 });
      }
      return json(200, found);
    }
    if (path === "/practitioners") return json(200, { practitioners: state.practitioners });
    if (path === "/appointment_types") return json(200, { appointment_types: state.types });
    if (path === "/businesses") return json(200, { businesses: state.businesses });
    if ((m = path.match(/^\/businesses\/\w+\/practitioners\/(\w+)\/appointment_types\/\w+\/available_times$/))) {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      const times = m[1] === "1" ? TIMES.filter((t) => t.slice(0, 10) >= from && t.slice(0, 10) <= to) : [];
      return json(200, { available_times: times.map((appointment_start) => ({ appointment_start })), total_entries: times.length });
    }
    return json(404, { message: "Unknown endpoint" });
  };
}
