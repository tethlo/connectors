// Thin client for the Veeqo public API (documented endpoints only).
// Docs: https://developers.veeqo.com/api
import type { HttpClient, Query } from "./core.ts";

export interface StockEntry {
  warehouse_id: number;
  physical_stock_level: number;
  allocated_stock_level?: number;
  available_stock_level?: number;
  infinite?: boolean;
}

export interface Sellable {
  id: number;
  sku_code: string;
  title?: string;
  product_title?: string;
  price?: string | number;
  stock_entries?: StockEntry[];
}

export interface Product {
  id: number;
  title: string;
  sellables: Sellable[];
}

export interface OrderLine {
  quantity: number;
  price_per_unit?: string | number;
  sellable: Pick<Sellable, "sku_code" | "product_title" | "title">;
}

export interface Order {
  id: number;
  number: string;
  status: string;
  created_at: string;
  total_price?: string | number;
  currency_code?: string;
  channel?: { name: string };
  customer?: { id?: number; email?: string; full_name?: string };
  deliver_to?: { first_name?: string; last_name?: string; city?: string; country?: string };
  line_items: OrderLine[];
  employee_notes?: Array<{ text: string; created_at?: string }>;
  due_date?: string | null;
}

export interface Warehouse {
  id: number;
  name: string;
}

export interface Customer {
  id: number;
  email: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export class VeeqoApi {
  readonly http: HttpClient;
  constructor(http: HttpClient) {
    this.http = http;
  }

  listOrders(query: Query): Promise<Order[]> {
    return this.http.get("/orders", { page_size: 100, ...query });
  }

  getOrder(id: number): Promise<Order> {
    return this.http.get(`/orders/${id}`);
  }

  async addOrderNote(id: number, text: string): Promise<Order> {
    return (await this.http.request<Order>("PUT", `/orders/${id}`, { body: { order: { employee_notes_attributes: [{ text }] } } })).data;
  }

  listProducts(query: Query): Promise<Product[]> {
    return this.http.get("/products", { page_size: 100, ...query });
  }

  listWarehouses(): Promise<Warehouse[]> {
    return this.http.get("/warehouses");
  }

  async setStockLevel(sellableId: number, warehouseId: number, level: number): Promise<StockEntry> {
    const path = `/sellables/${sellableId}/warehouses/${warehouseId}/stock_entry`;
    return (await this.http.request<StockEntry>("PUT", path, { body: { stock_entry: { physical_stock_level: level, infinite: false } } })).data;
  }

  listCustomers(query: string): Promise<Customer[]> {
    return this.http.get("/customers", { query, page_size: 25 });
  }
}
