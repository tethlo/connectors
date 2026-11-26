// Thin client for the Zammad REST API v1 (documented endpoints only).
// Docs: https://docs.zammad.org/en/latest/api/intro.html
import type { HttpClient } from "./core.ts";

/** With expand=true, Zammad adds the names of related records (state, priority, group, owner, customer). */
export interface Ticket {
  id: number;
  number: string;
  title: string;
  state: string;
  priority: string;
  group: string;
  owner?: string;
  customer?: string;
  customer_id?: number;
  owner_id?: number;
  created_at: string;
  updated_at: string;
  article_count?: number;
}

export interface Article {
  id: number;
  from?: string;
  to?: string;
  subject?: string;
  body: string;
  content_type?: string;
  type: string;
  internal: boolean;
  sender: string;
  created_at: string;
}

export interface User {
  id: number;
  firstname: string;
  lastname: string;
  email: string;
  phone?: string;
  organization?: string;
}

export interface Group {
  id: number;
  name: string;
  active?: boolean;
}

export class ZammadApi {
  readonly http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  searchTickets(query: string, limit = 50): Promise<Ticket[]> {
    return this.http.get("/tickets/search", { query, limit, expand: true, sort_by: "created_at", order_by: "desc" });
  }

  getTicket(id: number): Promise<Ticket> {
    return this.http.get(`/tickets/${id}`, { expand: true });
  }

  articles(ticketId: number): Promise<Article[]> {
    return this.http.get(`/ticket_articles/by_ticket/${ticketId}`);
  }

  searchUsers(query: string, limit = 20): Promise<User[]> {
    return this.http.get("/users/search", { query, limit, expand: true });
  }

  groups(): Promise<Group[]> {
    return this.http.get("/groups");
  }

  async createTicket(input: { title: string; group: string; customer_id: string; article: { subject: string; body: string; type: "note" | "phone" | "web"; internal: boolean } }): Promise<Ticket> {
    return (await this.http.request<Ticket>("POST", "/tickets", { body: input })).data;
  }

  async updateTicket(id: number, changes: { state?: string; priority?: string; owner_id?: number }): Promise<Ticket> {
    return (await this.http.request<Ticket>("PUT", `/tickets/${id}`, { body: changes })).data;
  }

  async addArticle(input: { ticket_id: number; body: string; type: "note" | "email"; internal: boolean; to?: string; subject?: string; content_type: "text/plain" }): Promise<Article> {
    return (await this.http.request<Article>("POST", "/ticket_articles", { body: input })).data;
  }
}
