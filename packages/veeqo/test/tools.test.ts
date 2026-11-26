import assert from "node:assert/strict";
import { test } from "node:test";
import { connect, data, text } from "./helpers.ts";

test("stock is summed across warehouses and available excludes allocated units", async () => {
  const { call, close } = await connect();
  const mugs = data(await call("find_products", { query: "MUG" }));
  assert.deepEqual(mugs.variants[0], {
    sellable_id: 101, sku: "MUG-BLU", name: "Ceramic mug - Blue", price: 12, on_hand: 34, available: 32,
    by_warehouse: [{ warehouse: "Main warehouse", on_hand: 30 }, { warehouse: "Shop floor", on_hand: 4 }],
  });
  await close();
});

test("low stock lists the lowest first and counts out of stock", async () => {
  const { call, close } = await connect();
  const low = data(await call("get_low_stock", { threshold: 5 }));
  assert.deepEqual(low.variants.map((v: any) => v.sku), ["TOWEL-NAT", "MUG-RED"]);
  assert.equal(low.out_of_stock, 1);
  await close();
});

test("orders are found by id or number", async () => {
  const { call, close } = await connect();
  assert.equal(data(await call("get_order", { order: 5003 })).number, "#1039");
  assert.equal(data(await call("get_order", { order: "AMZ-202-77" })).customer, "Raj Patel");
  assert.match(text(await call("get_order", { order: "#9999" })), /No order matches "9999"/);
  await close();
});

test("set_stock_level previews the change, then writes it", async () => {
  const { call, state, close } = await connect();
  assert.match(data(await call("set_stock_level", { sku: "mug-blu", warehouse: "shop", on_hand: 10 })).would, /from 4 to 10/);
  const done = data(await call("set_stock_level", { sku: "MUG-BLU", warehouse: "Shop floor", on_hand: 10, confirm: true }));
  assert.equal(done.before, 4);
  assert.equal(state.products[0].sellables[0].stock_entries![1].physical_stock_level, 10);
  assert.match(text(await call("set_stock_level", { sku: "MUG", warehouse: "Main", on_hand: 1 })), /No SKU matches "MUG"/);
  await close();
});

test("order notes are added to open orders only", async () => {
  const { call, state, close } = await connect();
  data(await call("add_order_note", { order: "#1042", note: "Gift wrap." }));
  assert.deepEqual(state.orders[0].employee_notes, [{ text: "Gift wrap." }]);
  state.orders[1].status = "cancelled";
  assert.match(text(await call("add_order_note", { order: 5002, note: "x" })), /is cancelled/);
  await close();
});
