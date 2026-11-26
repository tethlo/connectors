import assert from "node:assert/strict";
import { test } from "node:test";
import { shardOf } from "../src/api.ts";
import { apiFromEnv } from "../src/server.ts";
import { connect, data, seed, text } from "./helpers.ts";

test("the API key's shard selects the regional host", async () => {
  assert.equal(shardOf("abc-uk1"), "uk1");
  assert.equal(shardOf("no-shard"), "au1");
  const seen: string[] = [];
  const api = apiFromEnv({ CLINIKO_API_KEY: "abc-ca1", CLINIKO_CONTACT_EMAIL: "ops@clinic.test" }, {
    fetch: async (input, init) => {
      seen.push(`${String(input)} ${new Headers(init?.headers).get("User-Agent")}`);
      return new Response(JSON.stringify({ practitioners: [] }), { status: 200 });
    },
  });
  await api.listPractitioners();
  assert.equal(seen[0], "https://api.ca1.cliniko.com/v1/practitioners?per_page=100 tethlo-mcp-for-cliniko/0.1.0 (ops@clinic.test)");
});

test("find_patients searches names in both orders and skips archived patients", async () => {
  const { call, close } = await connect();
  const does = data(await call("find_patients", { query: "Do" }));
  assert.deepEqual(does.patients.map((p: any) => p.name), ["Jane Doe", "John Doherty"]);
  assert.equal(data(await call("find_patients", { query: "amy" })).patients[0].phone, "07700 900003");
  await close();
});

test("appointments show names, not links, and hide cancellations by default", async () => {
  const { call, close } = await connect();
  const before = data(await call("list_appointments", {}));
  assert.deepEqual(before.appointments[0], { id: "501", starts_at: "2026-11-25T09:00:00Z", ends_at: "2026-11-25T10:00:00Z", patient: "Jane Doe", patient_id: "11", practitioner: "Sarah Smith", service: "Follow-up" });
  data(await call("cancel_appointment", { appointment_id: "501", confirm: true }));
  assert.equal(data(await call("list_appointments", {})).count, 1);
  assert.equal(data(await call("list_appointments", { include_cancelled: true })).appointments[0].cancelled, true);
  assert.equal(data(await call("cancel_appointment", { appointment_id: "501" })).already_cancelled, true);
  await close();
});

test("booking resolves names, rejects taken times, and asks to choose a location when there are several", async () => {
  const { call, state, close } = await connect();
  const taken = await call("book_appointment", { patient_id: "11", practitioner: "Sarah", service: "Follow-up", starts_at: "2026-11-26T10:00:00Z" });
  assert.match(text(taken), /starts_at: is not available/);
  const booked = data(await call("book_appointment", { patient_id: "11", practitioner: "Sarah", service: "Follow-up", starts_at: "2026-11-26T09:00:00Z" }));
  assert.equal(booked.appointment.practitioner, "Sarah Smith");
  assert.equal(state.appointments.length, 4);
  const two = seed();
  two.businesses.push({ id: "2", business_name: "Hilltop Clinic" });
  const other = await connect(two);
  assert.match(text(await other.call("find_available_times", { practitioner: "Sarah", service: "Follow-up" })), /matches 2 locations/);
  await other.close();
  await close();
});

test("availability is limited to 7 days per request", async () => {
  const { call, close } = await connect();
  assert.match(text(await call("find_available_times", { practitioner: "Sarah", service: "Follow-up", from: "2026-11-24", to: "2026-12-10" })), /at most 7 days/);
  await close();
});
