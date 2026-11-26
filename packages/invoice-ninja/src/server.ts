import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InvoiceNinjaApi, type InvoiceNinjaApiOptions } from "./api.ts";
import { registerTools, type ToolOptions } from "./tools.ts";

export const SERVER_INFO = { name: "tethlo-mcp-for-invoice-ninja", version: "0.1.0" } as const;

const INSTRUCTIONS = [
  "Tools for Invoice Ninja, an invoicing and payments app for small businesses and freelancers.",
  "Clients and invoices can be named in plain words: tools accept a client name or email and an invoice number.",
  "Amounts are in each client's currency.",
  "Use get_receivables_summary for questions about money owed overall, list_invoices for a client's invoices.",
  "create_invoice saves a draft unless send is true: confirm amounts and recipient with the user before sending anything.",
].join(" ");

export function createServer(api: InvoiceNinjaApi, options: ToolOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerTools(server, api, options);
  return server;
}

export function apiFromEnv(env: NodeJS.ProcessEnv = process.env, overrides: Partial<InvoiceNinjaApiOptions> = {}): InvoiceNinjaApi {
  return new InvoiceNinjaApi({
    token: overrides.token ?? env.INVOICENINJA_API_TOKEN ?? "",
    baseUrl: overrides.baseUrl ?? env.INVOICENINJA_BASE_URL,
    ...overrides,
  });
}
