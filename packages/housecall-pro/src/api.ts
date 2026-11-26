// Thin client for the Housecall Pro public API (documented endpoints only).
// Docs: https://docs.housecallpro.com/
import type { HttpClient, Query } from "./core.ts";

export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email?: string | null;
  mobile_number?: string | null;
  company?: string | null;
  addresses?: Address[];
}

export interface Person {
  id: string;
  first_name: string;
  last_name: string;
  role?: string;
}

export type WorkStatus = "unscheduled" | "scheduled" | "in_progress" | "complete unrated" | "complete rated" | "user canceled" | "pro canceled";

export interface Job {
  id: string;
  invoice_number?: string;
  description?: string;
  customer: Pick<Customer, "id" | "first_name" | "last_name">;
  address?: Address;
  work_status: WorkStatus;
  schedule?: { scheduled_start?: string | null; scheduled_end?: string | null };
  total_amount?: number;
  outstanding_balance?: number;
  assigned_employees?: Person[];
  notes?: Array<{ id: string; content: string }>;
}

export interface Estimate {
  id: string;
  estimate_number?: string;
  customer: Pick<Customer, "id" | "first_name" | "last_name">;
  work_status?: string;
  options?: Array<{ name?: string; total_amount?: number; approval_status?: string | null }>;
  schedule?: { scheduled_start?: string | null };
}

interface Page {
  page?: number;
  total_pages?: number;
  total_items?: number;
}

export class HousecallProApi {
  readonly http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  async listCustomers(query: { q?: string; page_size?: number }): Promise<Customer[]> {
    return (await this.http.get<{ customers: Customer[] } & Page>("/customers", { page_size: 25, ...query })).customers;
  }

  async createCustomer(input: { first_name: string; last_name?: string; email?: string; mobile_number?: string; company?: string; notifications_enabled: boolean; addresses?: Address[] }): Promise<Customer> {
    return (await this.http.request<Customer>("POST", "/customers", { body: input })).data;
  }

  async listJobs(query: Query): Promise<Job[]> {
    return (await this.http.get<{ jobs: Job[] } & Page>("/jobs", { page_size: 100, ...query })).jobs;
  }

  getJob(id: string): Promise<Job> {
    return this.http.get(`/jobs/${encodeURIComponent(id)}`);
  }

  async addJobNote(id: string, content: string): Promise<unknown> {
    return (await this.http.request("POST", `/jobs/${encodeURIComponent(id)}/notes`, { body: { content } })).data;
  }

  async listEstimates(query: Query): Promise<Estimate[]> {
    return (await this.http.get<{ estimates: Estimate[] } & Page>("/estimates", { page_size: 50, ...query })).estimates;
  }

  async listEmployees(): Promise<Person[]> {
    return (await this.http.get<{ employees: Person[] } & Page>("/employees", { page_size: 100 })).employees;
  }
}
