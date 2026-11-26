// Thin, typed client for the Invoice Ninja v5 REST API.
// Docs: https://invoiceninja.github.io/en/api-reference/ (OpenAPI: invoiceninja/invoiceninja, openapi/api-docs.yaml)

export interface Contact {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  is_primary?: boolean;
}

export interface Client {
  id: string;
  name: string;
  display_name?: string;
  balance: number;
  paid_to_date: number;
  contacts: Contact[];
  is_deleted?: boolean;
}

export interface LineItem {
  product_key: string;
  notes: string;
  cost: number;
  quantity: number;
  line_total?: number;
}

export interface Invitation {
  link?: string;
}

export interface Invoice {
  id: string;
  number: string;
  client_id: string;
  /** "1" draft, "2" sent, "3" partial, "4" paid, "5" cancelled, "6" reversed */
  status_id: string;
  amount: number;
  balance: number;
  paid_to_date: number;
  date: string;
  due_date: string;
  po_number?: string;
  public_notes?: string;
  line_items: LineItem[];
  invitations?: Invitation[];
  is_deleted?: boolean;
  client?: Client;
}

export interface Payment {
  id: string;
  number: string;
  amount: number;
  date: string;
  client_id: string;
  transaction_reference?: string;
}

export interface Page<T> {
  data: T[];
  meta?: { pagination?: { total: number; current_page: number; total_pages: number } };
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface InvoiceNinjaApiOptions {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_BASE_URL = "https://invoicing.co";

function explain(status: number, detail: string): string {
  switch (status) {
    case 401:
      return "The Invoice Ninja API token is missing or invalid. Create one in Settings > Account Management > API Tokens.";
    case 403:
      return "Access denied. The token's user lacks this permission, or the hosted plan does not include API access (Pro or Enterprise).";
    case 404:
      return "Not found. It may have been deleted or archived; search again by name or number.";
    case 422:
      return `Invoice Ninja rejected the data: ${detail || "validation failed"}.`;
    case 429:
      return "Rate limited by Invoice Ninja. Wait a minute, then retry.";
    default:
      return status >= 500
        ? `Invoice Ninja is temporarily unavailable (HTTP ${status}). Retry in a few minutes.`
        : `Unexpected response from Invoice Ninja (HTTP ${status}).`;
  }
}

/** Turns Laravel-style validation errors into one readable line. */
function validationDetail(body: unknown): string {
  const parsed = body as { message?: string; errors?: Record<string, string[]> };
  if (parsed?.errors) {
    return Object.entries(parsed.errors)
      .map(([field, messages]) => `${field}: ${messages.join(" ")}`)
      .join("; ");
  }
  return parsed?.message ?? "";
}

export class InvoiceNinjaApi {
  readonly #token: string;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;

  constructor(options: InvoiceNinjaApiOptions) {
    if (!options.token) throw new ApiError(401, explain(401, ""));
    this.#token = options.token;
    this.#baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#retryDelayMs = options.retryDelayMs ?? 1_000;
  }

  async #request<T>(method: string, path: string, query: Record<string, string | number | undefined> = {}, body?: unknown): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    const url = `${this.#baseUrl}/api/v1${path}${params.size ? `?${params}` : ""}`;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.#fetch(url, {
          method,
          headers: {
            "X-API-TOKEN": this.#token,
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "failed";
        throw new ApiError(0, `The request to Invoice Ninja ${reason}. Check the network or INVOICENINJA_BASE_URL, then retry.`);
      }
      // Only retry reads: retrying a POST could create a duplicate invoice or payment.
      if ((res.status === 429 || res.status >= 500) && attempt === 0 && method === "GET") {
        await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs));
        continue;
      }
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        if (res.ok) throw new ApiError(res.status, "Invoice Ninja returned a response that is not JSON. Check INVOICENINJA_BASE_URL.");
      }
      if (!res.ok) throw new ApiError(res.status, explain(res.status, validationDetail(parsed)));
      return parsed as T;
    }
  }

  listClients(query: { filter?: string; balance?: string; per_page?: number; sort?: string }): Promise<Page<Client>> {
    return this.#request("GET", "/clients", { per_page: 20, ...query, status: "active" });
  }

  async getClient(id: string): Promise<Client> {
    return (await this.#request<{ data: Client }>("GET", `/clients/${encodeURIComponent(id)}`)).data;
  }

  async createClient(input: { name: string; contacts: Partial<Contact>[]; phone?: string; website?: string }): Promise<Client> {
    return (await this.#request<{ data: Client }>("POST", "/clients", {}, input)).data;
  }

  listInvoices(query: {
    client_id?: string;
    client_status?: string;
    status_id?: number;
    filter?: string;
    number?: string;
    per_page?: number;
    page?: number;
    include?: string;
  }): Promise<Page<Invoice>> {
    return this.#request("GET", "/invoices", { per_page: 20, sort: "date|desc", ...query });
  }

  async getInvoice(id: string): Promise<Invoice> {
    return (await this.#request<{ data: Invoice }>("GET", `/invoices/${encodeURIComponent(id)}`, { include: "client" })).data;
  }

  async createInvoice(
    input: { client_id: string; line_items: LineItem[]; due_date?: string; po_number?: string; public_notes?: string },
    options: { send_email?: boolean },
  ): Promise<Invoice> {
    const query = options.send_email ? { send_email: "true" } : {};
    return (await this.#request<{ data: Invoice }>("POST", "/invoices", query, input)).data;
  }

  async bulkInvoices(action: "email" | "send_email", ids: string[], emailType?: string): Promise<void> {
    await this.#request("POST", "/invoices/bulk", {}, { action, ids, ...(emailType ? { email_type: emailType } : {}) });
  }

  async createPayment(
    input: { client_id: string; amount: number; date: string; transaction_reference?: string; invoices: { invoice_id: string; amount: number }[] },
    options: { email_receipt?: boolean },
  ): Promise<Payment> {
    const query = { email_receipt: options.email_receipt ? "true" : "false" };
    return (await this.#request<{ data: Payment }>("POST", "/payments", query, input)).data;
  }
}
