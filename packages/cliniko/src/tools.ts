import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Appointment, type AppointmentType, type Business, type ClinikoApi, linkId, type Patient, type Practitioner } from "./api.ts";
import { confirmFirst, DATE, defineTool, pickOne, type ToolContext, ToolError } from "./core.ts";

export interface ToolOptions {
  writes: boolean;
  now: () => Date;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000));
const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`.trim();

const CANCEL_REASONS = { feeling_better: 10, condition_worse: 20, sick: 30, away: 40, other: 50, work: 60 } as const;

function patientSummary(p: Patient) {
  return { id: p.id, name: fullName(p), email: p.email || undefined, phone: p.patient_phone_numbers?.[0]?.number };
}

interface Directory {
  practitioners: Practitioner[];
  types: AppointmentType[];
  businesses: Business[];
}

async function directory(api: ClinikoApi): Promise<Directory> {
  const [practitioners, types, businesses] = await Promise.all([api.listPractitioners(), api.listAppointmentTypes(), api.listBusinesses()]);
  return {
    practitioners: practitioners.filter((p) => p.active !== false),
    types: types.filter((t) => !t.archived_at),
    businesses: businesses.filter((b) => !b.archived_at),
  };
}

function appointmentSummary(a: Appointment, dir: Directory) {
  const practitioner = dir.practitioners.find((p) => p.id === linkId(a.practitioner));
  return {
    id: a.id,
    starts_at: a.starts_at,
    ends_at: a.ends_at,
    patient: a.patient_name,
    patient_id: linkId(a.patient),
    practitioner: practitioner ? fullName(practitioner) : linkId(a.practitioner),
    service: dir.types.find((t) => t.id === linkId(a.appointment_type))?.name ?? linkId(a.appointment_type),
    location: dir.businesses.length > 1 ? dir.businesses.find((b) => b.id === linkId(a.business))?.business_name : undefined,
    cancelled: a.cancelled_at ? true : undefined,
    did_not_arrive: a.did_not_arrive || undefined,
  };
}

function match<T>(ref: string, items: T[], id: (t: T) => string, name: (t: T) => string, what: string, hint: string): T {
  const wanted = ref.trim().toLowerCase();
  const exact = items.filter((t) => id(t) === ref.trim() || name(t).toLowerCase() === wanted);
  return pickOne(ref, exact.length ? exact : items.filter((t) => name(t).toLowerCase().includes(wanted)), (t) => `"${name(t)}" (${id(t)})`, what, hint);
}

const HINT = "Call list_practitioners_and_services to see the names.";

export function registerTools(server: McpServer, api: ClinikoApi, options: ToolOptions): void {
  const ctx: ToolContext = { server, writes: options.writes, service: "Cliniko" };
  const today = () => iso(options.now());

  defineTool(
    ctx,
    "find_patients",
    {
      title: "Find patients",
      description:
        "Search patients by name or email and get their id and contact details (email, phone). Use it before booking or to " +
        "check whether someone is already a patient. Does not return clinical information.",
      input: {
        query: z.string().min(2).describe("Full name, last name, first name or email."),
        limit: z.number().int().min(1).max(25).default(10),
      },
      kind: "read",
    },
    async ({ query, limit }) => {
      const words = query.trim().split(/\s+/);
      const searches = query.includes("@")
        ? [[`email:=${query.trim()}`]]
        : words.length >= 2
          ? [[`first_name:~${words[0]}`, `last_name:~${words.slice(1).join(" ")}`]]
          : [[`last_name:~${words[0]}`], [`first_name:~${words[0]}`]];
      const found = new Map<string, Patient>();
      for (const filters of searches) for (const p of await api.searchPatients(filters, limit)) if (!p.archived_at) found.set(p.id, p);
      const patients = [...found.values()].slice(0, limit);
      return { count: patients.length, patients: patients.map(patientSummary) };
    },
  );

  defineTool(
    ctx,
    "get_patient",
    {
      title: "Get a patient",
      description:
        "One patient's contact details (name, email, phones, date of birth) and their upcoming appointments, by patient id " +
        "from find_patients. Use it to answer 'when is the next visit of this patient?'.",
      input: { patient_id: z.string().min(1) },
      kind: "read",
    },
    async ({ patient_id }) => {
      const [patient, dir] = await Promise.all([api.getPatient(patient_id), directory(api)]);
      const upcoming = await api.listAppointments([`patient_id:=${patient_id}`, `starts_at:>=${today()}T00:00:00Z`], 10);
      return {
        ...patientSummary(patient),
        date_of_birth: patient.date_of_birth || undefined,
        phones: patient.patient_phone_numbers?.map((p) => p.number),
        upcoming_appointments: upcoming.filter((a) => !a.cancelled_at).map((a) => appointmentSummary(a, dir)),
      };
    },
  );

  defineTool(
    ctx,
    "list_appointments",
    {
      title: "List appointments",
      description:
        "The clinic diary: appointments between two dates (default: today and the next 7 days), oldest first, optionally for " +
        "one practitioner or one patient. Shows cancellations and did-not-arrive. Use it for 'who is booked tomorrow?' or 'show a practitioner's week'.",
      input: {
        from: z.string().regex(DATE).optional().describe("First day, YYYY-MM-DD. Default: today."),
        to: z.string().regex(DATE).optional().describe("Last day, YYYY-MM-DD. Default: from + 7 days."),
        practitioner: z.string().optional().describe("Practitioner name or id."),
        patient_id: z.string().optional(),
        include_cancelled: z.boolean().default(false),
      },
      kind: "read",
    },
    async (args) => {
      const from = args.from ?? today();
      const to = args.to ?? addDays(from, 7);
      const dir = await directory(api);
      const filters = [`starts_at:>=${from}T00:00:00Z`, `starts_at:<${addDays(to, 1)}T00:00:00Z`];
      if (args.practitioner) {
        const p = match(args.practitioner, dir.practitioners, (x) => x.id, fullName, "practitioner", HINT);
        filters.push(`practitioner_id:=${p.id}`);
      }
      if (args.patient_id) filters.push(`patient_id:=${args.patient_id}`);
      const list = (await api.listAppointments(filters, 100)).filter((a) => args.include_cancelled || !a.cancelled_at);
      return { from, to, count: list.length, appointments: list.map((a) => appointmentSummary(a, dir)) };
    },
  );

  defineTool(
    ctx,
    "list_practitioners_and_services",
    {
      title: "List practitioners and services",
      description:
        "Who works at the clinic and what can be booked: active practitioners, appointment types (services) with their " +
        "duration, and business locations. Use it to get exact names or ids.",
      input: {},
      kind: "read",
    },
    async () => {
      const dir = await directory(api);
      return {
        practitioners: dir.practitioners.map((p) => ({ id: p.id, name: fullName(p), designation: p.designation || undefined })),
        services: dir.types.map((t) => ({ id: t.id, name: t.name, minutes: t.duration_in_minutes })),
        locations: dir.businesses.map((b) => ({ id: b.id, name: b.business_name })),
      };
    },
  );

  defineTool(
    ctx,
    "find_available_times",
    {
      title: "Find available times",
      description:
        "Availability: open times for a practitioner and a service (appointment type, e.g. a follow-up) between two dates, " +
        "at most 7 days apart (default: the next 7 days). Use it to answer 'when can the physio see someone new?'.",
      input: {
        practitioner: z.string().describe("Practitioner name or id."),
        service: z.string().describe("Appointment type name or id."),
        location: z.string().optional().describe("Business location name or id; required only with several locations."),
        from: z.string().regex(DATE).optional(),
        to: z.string().regex(DATE).optional(),
      },
      kind: "read",
    },
    async (args) => {
      const dir = await directory(api);
      const practitioner = match(args.practitioner, dir.practitioners, (x) => x.id, fullName, "practitioner", HINT);
      const type = match(args.service, dir.types, (x) => x.id, (x) => x.name, "service", HINT);
      const business = args.location
        ? match(args.location, dir.businesses, (x) => x.id, (x) => x.business_name, "location", HINT)
        : pickOne("location", dir.businesses, (b) => `"${b.business_name}" (${b.id})`, "location", HINT);
      const from = args.from ?? today();
      const to = args.to ?? addDays(from, 6);
      if (Date.parse(to) - Date.parse(from) > 7 * 86_400_000) throw new ToolError("Cliniko returns at most 7 days of availability per request: narrow from/to.");
      const times = await api.availableTimes(business.id, practitioner.id, type.id, from, to);
      return { practitioner: fullName(practitioner), service: type.name, from, to, count: times.length, times: times.slice(0, 30) };
    },
  );

  defineTool(
    ctx,
    "book_appointment",
    {
      title: "Book an appointment",
      description:
        "Book an existing patient (patient_id from find_patients) with a practitioner for a service (e.g. a follow-up) at a time " +
        "(from find_available_times). Returns the new appointment. To cancel later, use cancel_appointment.",
      input: {
        patient_id: z.string().min(1),
        practitioner: z.string().describe("Practitioner name or id."),
        service: z.string().describe("Appointment type name or id."),
        starts_at: z.string().min(16).describe("Start time exactly as returned by find_available_times (ISO 8601)."),
        location: z.string().optional(),
        notes: z.string().max(500).optional().describe("Booking note (not a clinical note)."),
      },
      kind: "write",
    },
    async (args) => {
      const dir = await directory(api);
      const practitioner = match(args.practitioner, dir.practitioners, (x) => x.id, fullName, "practitioner", HINT);
      const type = match(args.service, dir.types, (x) => x.id, (x) => x.name, "service", HINT);
      const business = args.location
        ? match(args.location, dir.businesses, (x) => x.id, (x) => x.business_name, "location", HINT)
        : pickOne("location", dir.businesses, (b) => `"${b.business_name}" (${b.id})`, "location", HINT);
      const created = await api.createAppointment({
        starts_at: args.starts_at,
        patient_id: args.patient_id,
        practitioner_id: practitioner.id,
        appointment_type_id: type.id,
        business_id: business.id,
        notes: args.notes,
      });
      return { done: true, appointment: appointmentSummary(created, dir) };
    },
  );

  defineTool(
    ctx,
    "cancel_appointment",
    {
      title: "Cancel an appointment",
      description:
        "Cancel an appointment with a reason (feeling_better, condition_worse, sick, away, work, other). Destructive: call with " +
        "confirm=false first, present the preview to the user, then call again with confirm=true.",
      input: {
        appointment_id: z.string().min(1),
        reason: z.enum(Object.keys(CANCEL_REASONS) as [keyof typeof CANCEL_REASONS]).default("other"),
        note: z.string().max(500).optional(),
        confirm: z.boolean().default(false),
      },
      kind: "destructive",
    },
    async (args) => {
      const [appointment, dir] = await Promise.all([api.getAppointment(args.appointment_id), directory(api)]);
      const summary = appointmentSummary(appointment, dir);
      if (appointment.cancelled_at) return { done: true, already_cancelled: true, appointment: summary };
      if (!args.confirm) return confirmFirst(`Cancel ${summary.service} for ${summary.patient} with ${summary.practitioner} on ${summary.starts_at} (reason: ${args.reason}).`);
      await api.cancelAppointment(args.appointment_id, CANCEL_REASONS[args.reason as keyof typeof CANCEL_REASONS], args.note);
      return { done: true, cancelled: summary };
    },
  );
}
