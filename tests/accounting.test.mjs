import assert from "node:assert/strict";
import test from "node:test";
import { usd, purposeName, filterRequests, isAccountingSnapshot } from "../web/js/lib/accounting.js";
import { refreshAccounting } from "../web/js/api.js";
import { state } from "../web/js/state.js";

function snapshot() {
  const totals = { attempts: 1, calls: 1, failures: 0, pending: 0, cost: 0.02,
    unknownCostCount: 0, input: 10, output: 5, reasoning: 0, unattributed: 0 };
  return { apiVersion: 1, available: true, generated: 1790500000,
    generated_at: "2026-09-27T12:00:00Z", scope: "recorded_requests", recentLimit: 100,
    totals, purposes: [{ ...totals, purpose: "chat_reply" }],
    models: [{ ...totals, model: "fixture-model" }], recent: [{
      requestId: "req-1", timestamp: "2026-09-27T12:00:00Z", purpose: "chat_reply",
      model: "fixture-model", status: "success", cost: 0.02, input: 10,
      output: 5, reasoning: null, seconds: 1,
    }] };
}

const malformed = [
  data => { data.totals = {}; },
  data => { data.totals.cost = "0.02"; },
  data => { data.totals.input = NaN; },
  data => { data.purposes[0].attempts = null; },
  data => { data.models[0].model = {}; },
  data => { data.recent[0] = null; },
  data => { delete data.recent[0].cost; },
  data => { data.recent[0].bot = {}; },
  data => { data.recent[0].timestamp = "invalid"; },
  data => { data.recent.push({ ...data.recent[0] }); },
  data => { data.generated_at = "invalid"; },
  data => { data.apiVersion = 2; },
];

test("snapshot validation accepts nullable usage and rejects malformed rendered fields", () => {
  assert.equal(isAccountingSnapshot(snapshot()), true);
  const unknown = snapshot();
  unknown.recent[0].cost = null;
  unknown.extra = "future optional field";
  assert.equal(isAccountingSnapshot(unknown), true);
  unknown.recent[0].cost = 0;
  assert.equal(isAccountingSnapshot(unknown), true);
  for (const corrupt of malformed) {
    const data = snapshot();
    corrupt(data);
    assert.equal(isAccountingSnapshot(data), false, String(corrupt));
  }
  for (const data of [null, [], {}, false]) assert.equal(isAccountingSnapshot(data), false);
});

test("refresh keeps the last valid snapshot on malformed data and recovers", async t => {
  const good = snapshot();
  let response = good;
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => response }));
  await refreshAccounting();
  assert.equal(state.accounting, good);
  for (const corrupt of malformed) {
    response = snapshot();
    corrupt(response);
    await refreshAccounting();
    assert.equal(state.accounting, good, String(corrupt));
    assert.notEqual(state.accountingError, "");
  }
  response = snapshot();
  response.available = false;
  response.totals = Object.fromEntries(Object.keys(response.totals).map(key => [key, 0]));
  response.recent = [];
  response.purposes = [];
  response.models = [];
  await refreshAccounting();
  assert.equal(state.accounting, response);
  assert.equal(state.accountingError, "");
});

test("unknown billing is never displayed as a free call", () => {
  assert.equal(usd(null), "Unknown");
  assert.equal(usd(undefined), "Unknown");
  assert.equal(usd(NaN), "Unknown");
  assert.equal(usd(0), "$0.00");
  assert.equal(usd(0.000123), "$0.000123");
  assert.equal(purposeName("unknown"), "Unattributed");
});

test("recent request search combines actor, purpose and model filters", () => {
  const rows = [
    { bot: "Ayla", purpose: "lore_backstory", model: "one", stage: "write" },
    { guild: "Wayfarers", purpose: "lore_guild", model: "two", stage: "judge" },
    { bot: "Ayla", purpose: "chat_reply", model: "two", stage: "reply" },
  ];
  assert.deepEqual(filterRequests(rows, { query: "AYLA", model: "one" }), [rows[0]]);
  assert.deepEqual(filterRequests(rows, { query: "judge", purpose: "lore_guild" }), [rows[1]]);
  assert.deepEqual(filterRequests(rows, { query: "Ayla", purpose: "lore_guild" }), []);
  assert.equal(filterRequests(rows).length, 3);
});
