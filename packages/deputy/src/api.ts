// Thin client for the Deputy API v1 (documented Resource API and supervise endpoints only).
// Docs: https://developer.deputy.com/
import type { HttpClient } from "./core.ts";

export interface Employee {
  Id: number;
  DisplayName: string;
  FirstName?: string;
  LastName?: string;
  Active: boolean;
  Company?: number;
  Role?: number;
}

export interface Area {
  Id: number;
  OperationalUnitName: string;
  Company: number;
  Active?: boolean;
}

export interface Location {
  Id: number;
  CompanyName: string;
  Active?: boolean;
}

export interface Shift {
  Id: number;
  Employee: number;
  OperationalUnit: number;
  StartTime: number;
  EndTime: number;
  TotalTime?: number;
  Published?: boolean;
  Open?: boolean;
  Comment?: string;
}

export interface Leave {
  Id: number;
  Employee: number;
  Status: number;
  DateStart: string;
  DateEnd: string;
  Days?: number;
  TotalHours?: number;
  Comment?: string;
}

export interface Timesheet {
  Id: number;
  Employee: number;
  Date: string;
  StartTime: number;
  EndTime: number;
  TotalTime: number;
  Cost?: number;
  OperationalUnit: number;
  IsInProgress?: boolean;
  TimeApproved?: boolean;
}

type Condition = { field: string; type: "eq" | "ne" | "ge" | "gt" | "le" | "lt" | "in"; data: unknown };

/** Builds a Resource API QUERY body. */
export function query(conditions: Condition[], sort?: Record<string, "asc" | "desc">, max = 500) {
  return { search: Object.fromEntries(conditions.map((c, i) => [`s${i + 1}`, c])), ...(sort ? { sort } : {}), max };
}

export class DeputyApi {
  readonly http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  async #query<T>(resource: string, body: unknown): Promise<T[]> {
    return (await this.http.request<T[]>("POST", `/resource/${resource}/QUERY`, { body })).data ?? [];
  }

  employees(activeOnly = true): Promise<Employee[]> {
    return this.#query("Employee", query(activeOnly ? [{ field: "Active", type: "eq", data: true }] : [], { DisplayName: "asc" }));
  }

  areas(): Promise<Area[]> {
    return this.http.get("/resource/OperationalUnit");
  }

  locations(): Promise<Location[]> {
    return this.http.get("/resource/Company");
  }

  shifts(from: number, to: number, extra: Condition[] = []): Promise<Shift[]> {
    return this.#query("Roster", query([{ field: "StartTime", type: "ge", data: from }, { field: "StartTime", type: "lt", data: to }, ...extra], { StartTime: "asc" }));
  }

  leaves(conditions: Condition[]): Promise<Leave[]> {
    return this.#query("Leave", query(conditions, { DateStart: "asc" }));
  }

  getLeave(id: number): Promise<Leave> {
    return this.http.get(`/resource/Leave/${id}`);
  }

  async updateLeave(id: number, changes: Partial<Leave>): Promise<Leave> {
    return (await this.http.request<Leave>("POST", `/resource/Leave/${id}`, { body: changes })).data;
  }

  timesheets(fromDate: string, toDate: string, extra: Condition[] = []): Promise<Timesheet[]> {
    return this.#query("Timesheet", query([{ field: "Date", type: "ge", data: fromDate }, { field: "Date", type: "le", data: toDate }, ...extra], { Date: "asc" }));
  }

  async createShift(input: { intStartTimestamp: number; intEndTimestamp: number; intRosterEmployee: number; intOpunitId: number; blnPublish: boolean; intMealbreakMinute?: number; strComment?: string }): Promise<Shift> {
    return (await this.http.request<Shift>("POST", "/supervise/roster", { body: input })).data;
  }
}
