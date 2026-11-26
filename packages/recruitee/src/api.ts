// Thin client for the Recruitee ATS API (documented endpoints only).
// Docs: https://docs.recruitee.com/reference
import type { HttpClient, Query } from "./core.ts";

export interface Stage {
  id: number;
  name: string;
  category?: string;
}

export interface Offer {
  id: number;
  title: string;
  status: string;
  department?: string | null;
  location?: string | null;
  created_at: string;
  pipeline_template?: { stages: Stage[] };
}

export interface Placement {
  id: number;
  offer_id: number;
  stage_id: number | null;
  disqualified_at?: string | null;
  updated_at?: string;
}

export interface Candidate {
  id: number;
  name: string;
  emails: string[];
  phones: string[];
  created_at: string;
  source?: string | null;
  placements: Placement[];
}

export interface Note {
  id: number;
  body: string;
  created_at: string;
}

export class RecruiteeApi {
  readonly http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  async offers(scope?: string): Promise<Offer[]> {
    return (await this.http.get<{ offers: Offer[] }>("/offers", { scope })).offers;
  }

  async offer(id: number): Promise<Offer> {
    return (await this.http.get<{ offer: Offer }>(`/offers/${id}`)).offer;
  }

  async candidates(query: Query): Promise<Candidate[]> {
    return (await this.http.get<{ candidates: Candidate[] }>("/candidates", { limit: 100, ...query })).candidates;
  }

  async candidate(id: number): Promise<Candidate> {
    return (await this.http.get<{ candidate: Candidate }>(`/candidates/${id}`)).candidate;
  }

  async notes(candidateId: number): Promise<Note[]> {
    return (await this.http.get<{ notes: Note[] }>(`/candidates/${candidateId}/notes`)).notes;
  }

  async addNote(candidateId: number, body: string): Promise<Note> {
    return (await this.http.request<{ note: Note }>("POST", `/candidates/${candidateId}/notes`, { body: { note: { body } } })).data.note;
  }

  async createCandidate(candidate: { name: string; emails?: string[]; phones?: string[] }, offerId?: number): Promise<Candidate> {
    const body = { candidate, offers: offerId ? [offerId] : undefined };
    return (await this.http.request<{ candidate: Candidate }>("POST", "/candidates", { body })).data.candidate;
  }

  async changeStage(placementId: number, stageId: number): Promise<Placement> {
    return (await this.http.request<{ placement: Placement }>("PATCH", `/placements/${placementId}/change_stage`, { body: { stage_id: stageId } })).data.placement;
  }
}
