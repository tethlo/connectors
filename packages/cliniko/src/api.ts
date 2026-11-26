// Thin client for the Cliniko API v1 (documented endpoints only).
// Docs: https://docs.api.cliniko.com/
import type { HttpClient, Query } from "./core.ts";

export interface Link {
  links: { self: string };
}

export interface Patient {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  date_of_birth?: string | null;
  patient_phone_numbers?: Array<{ number: string; phone_type?: string }>;
  archived_at?: string | null;
}

export interface Appointment {
  id: string;
  starts_at: string;
  ends_at: string;
  patient_name?: string;
  notes?: string | null;
  cancelled_at?: string | null;
  did_not_arrive?: boolean;
  patient_arrived?: boolean;
  appointment_type: Link;
  practitioner: Link;
  patient: Link;
  business: Link;
}

export interface Practitioner {
  id: string;
  first_name: string;
  last_name: string;
  title?: string | null;
  designation?: string | null;
  active?: boolean;
}

export interface AppointmentType {
  id: string;
  name: string;
  duration_in_minutes: number;
  archived_at?: string | null;
}

export interface Business {
  id: string;
  business_name: string;
  archived_at?: string | null;
}

/** The id at the end of a Cliniko link, e.g. ".../practitioners/12" -> "12". */
export const linkId = (link?: Link) => link?.links.self.split("/").pop() ?? "";

/** Cliniko API keys end with the shard of the account, e.g. "...-au1". */
export function shardOf(apiKey: string): string {
  return apiKey.match(/-([a-z]{2}\d+)$/)?.[1] ?? "au1";
}

export class ClinikoApi {
  readonly http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  async searchPatients(filters: string[], perPage = 20): Promise<Patient[]> {
    const data = await this.http.get<{ patients: Patient[] }>("/patients", { "q[]": filters, per_page: perPage, sort: "last_name" });
    return data.patients;
  }

  getPatient(id: string): Promise<Patient> {
    return this.http.get(`/patients/${encodeURIComponent(id)}`);
  }

  async listAppointments(filters: string[], perPage = 50): Promise<Appointment[]> {
    const query: Query = { "q[]": filters, per_page: perPage, sort: "starts_at" };
    return (await this.http.get<{ individual_appointments: Appointment[] }>("/individual_appointments", query)).individual_appointments;
  }

  getAppointment(id: string): Promise<Appointment> {
    return this.http.get(`/individual_appointments/${encodeURIComponent(id)}`);
  }

  async listPractitioners(): Promise<Practitioner[]> {
    return (await this.http.get<{ practitioners: Practitioner[] }>("/practitioners", { per_page: 100 })).practitioners;
  }

  async listAppointmentTypes(): Promise<AppointmentType[]> {
    return (await this.http.get<{ appointment_types: AppointmentType[] }>("/appointment_types", { per_page: 100 })).appointment_types;
  }

  async listBusinesses(): Promise<Business[]> {
    return (await this.http.get<{ businesses: Business[] }>("/businesses", { per_page: 100 })).businesses;
  }

  async availableTimes(businessId: string, practitionerId: string, typeId: string, from: string, to: string): Promise<string[]> {
    const path = `/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${typeId}/available_times`;
    const data = await this.http.get<{ available_times: Array<{ appointment_start: string }> }>(path, { from, to, per_page: 100 });
    return data.available_times.map((t) => t.appointment_start);
  }

  async createAppointment(input: {
    starts_at: string;
    patient_id: string;
    practitioner_id: string;
    appointment_type_id: string;
    business_id: string;
    notes?: string;
  }): Promise<Appointment> {
    return (await this.http.request<Appointment>("POST", "/individual_appointments", { body: input })).data;
  }

  async cancelAppointment(id: string, reason: number, note?: string): Promise<void> {
    await this.http.request("PATCH", `/individual_appointments/${encodeURIComponent(id)}/cancel`, {
      body: { cancellation_reason: reason, cancellation_note: note },
    });
  }
}
