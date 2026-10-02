import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { readConfig } from "../src/config.js";
import { createServer } from "../src/server.js";
import { tokenMatches } from "../src/control.js";

const access = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

await test("control config requires a paired URL and token", () => {
  for (const env of [
    { DASHBOARD_CONTROL_URL: "http://127.0.0.1:8789" },
    { DASHBOARD_CONTROL_TOKEN: access },
    { DASHBOARD_CONTROL_URL: "file:///private", DASHBOARD_CONTROL_TOKEN: access },
    { DASHBOARD_CONTROL_URL: "http://user:pass@localhost:8789", DASHBOARD_CONTROL_TOKEN: access },
    { DASHBOARD_CONTROL_URL: "http://localhost:8789/private", DASHBOARD_CONTROL_TOKEN: access },
    { DASHBOARD_CONTROL_HOST_HEADER: "localhost:8789" },
    { DASHBOARD_CONTROL_PROTOCOL: "v1" },
    { DASHBOARD_CONTROL_URL: "http://localhost:8789", DASHBOARD_CONTROL_TOKEN: access, DASHBOARD_CONTROL_PROTOCOL: "unknown" },
    { DASHBOARD_CONTROL_URL: "http://localhost:8789", DASHBOARD_CONTROL_TOKEN: access, DASHBOARD_CONTROL_PROTOCOL: "v1" },
    { DASHBOARD_CONTROL_URL: "http://localhost:8789", DASHBOARD_CONTROL_TOKEN: access, DASHBOARD_CONTROL_BACKEND_TOKEN: access },
  ]) assert.throws(() => readConfig(env));
  assert.equal(tokenMatches(access, access), true);
  assert.equal(tokenMatches(access, "é".repeat(access.length)), false);
  assert.equal(tokenMatches(access, [access]), false);
});

await test("control routes project status and forward only authorized start/stop", async t => {
  const admin = Fastify();
  const seen: string[] = [];
  let job: { id: string; action: string; status: "running" | "done" } | null = null;
  admin.addHook("onRequest", async (request, reply) => {
    if (request.headers.host !== "127.0.0.1:8789") return reply.code(403).send({ error: "host" });
    seen.push(`${request.method} ${request.url}`);
  });
  admin.get("/api/state", () => ({
    time: 1790500000000, docker: true,
    containers: [{ name: "custom-realm", Running: true }, { name: "custom-db", Running: true }],
    samples: [{ time: 1790500000000, cpu: 165.2, memory: 2147483648 }],
    runtime: { worldReady: true, services: { world: "RUNNING" }, cpuCount: 16, private: "hidden" },
    private: "hidden",
  }));
  admin.get("/api/job", () => job);
  admin.get("/api/session", () => ({ token: "private-admin-session" }));
  admin.post("/api/action", (request, reply) => {
    assert.equal(request.headers["x-admin-token"], "private-admin-session");
    const body = request.body as { action: string };
    assert.ok(body.action === "start" || body.action === "stop");
    job = { id: "42", action: body.action, status: "running" };
    return reply.code(202).send(job);
  });
  const address = await admin.listen({ host: "127.0.0.1", port: 0 });
  const app = createServer(readConfig({
    DASHBOARD_CONTROL_URL: address,
    DASHBOARD_CONTROL_HOST_HEADER: "127.0.0.1:8789",
    DASHBOARD_CONTROL_TOKEN: access,
    DASHBOARD_CONTROL_REALM_UNIT: "custom-realm", DASHBOARD_CONTROL_DATABASE_UNIT: "custom-db",
  }));
  t.after(async () => { await app.close(); await admin.close(); });
  const headers = { "x-control-token": access };
  assert.deepEqual((await app.inject("/host-health")).json<unknown>(), { ok: true, control: true });
  const inject = (method: "GET" | "POST", url: string, payload?: unknown, extra = {}) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
      headers: { ...headers, ...extra, ...(payload === undefined ? {} : { "content-type": "application/json" }) } });

  assert.equal((await inject("GET", "/api/server/state", undefined, { "x-control-token": "wrong" })).statusCode, 401);
  assert.equal((await inject("GET", "/api/server/state", undefined, { origin: "http://evil.example" })).statusCode, 403);
  assert.deepEqual(seen, []);

  const state = await inject("GET", "/api/server/state");
  assert.equal(state.statusCode, 200);
  assert.deepEqual(state.json<unknown>(), {
    available: true, phase: "online", checkedAt: 1790500000000,
    realmRunning: true, databaseRunning: true, logicalCpus: 16,
    samples: [{ time: 1790500000000, cpuPercent: 165.2, memoryBytes: 2147483648 }],
  });
  assert.ok(!state.body.includes("hidden"));
  assert.equal((await inject("GET", "/api/server/job")).body, "null");
  assert.equal((await inject("POST", "/api/server/action", { action: "restart" })).statusCode, 400);
  assert.equal((await inject("POST", "/api/server/action", { action: "start", extra: 1 })).statusCode, 400);
  assert.equal((await inject("POST", "/api/server/action", { action: "stop" }, { origin: "http://evil.example" })).statusCode, 403);
  assert.deepEqual(seen, ["GET /api/state", "GET /api/job"]);

  const started = await inject("POST", "/api/server/action", { action: "start" });
  assert.equal(started.statusCode, 200);
  assert.deepEqual(started.json<unknown>(), { id: "42", action: "start", status: "running" });
  assert.ok(!started.body.includes("private-admin-session"));
  assert.deepEqual((await inject("GET", "/api/server/job")).json<unknown>(), { id: "42", action: "start", status: "running" });
  assert.equal((await inject("POST", "/api/server/action", { action: "stop" })).statusCode, 200);
  assert.deepEqual(seen, ["GET /api/state", "GET /api/job", "GET /api/session", "POST /api/action", "GET /api/job", "GET /api/session", "POST /api/action"]);
  job = { id: "43", action: "console", status: "running" };
  assert.deepEqual((await inject("GET", "/api/server/job")).json<unknown>(), { id: "43", action: "console", status: "running" });
  assert.equal((await inject("GET", "/api/server/state")).statusCode, 200);
  const previous = seen.length;
  assert.equal((await inject("POST", "/api/server/action", { action: "console" })).statusCode, 400);
  assert.equal(seen.length, previous);
});

await test("control reports unavailable admin without leaking upstream details", async t => {
  const admin = Fastify();
  admin.get("/api/state", () => ({ error: "secret path C:/private" }));
  const address = await admin.listen({ host: "127.0.0.1", port: 0 });
  const app = createServer(readConfig({ DASHBOARD_CONTROL_URL: address, DASHBOARD_CONTROL_TOKEN: access }));
  t.after(async () => { await app.close(); await admin.close(); });
  const response = await app.inject({ url: "/api/server/state", headers: { "x-control-token": access } });
  assert.equal(response.statusCode, 503);
  assert.ok(!response.body.includes("private"));

  const unconfigured = createServer(readConfig({}));
  t.after(async () => { await unconfigured.close(); });
  assert.deepEqual((await unconfigured.inject("/host-health")).json<unknown>(), { ok: true, control: false });
  assert.equal((await unconfigured.inject({ url: "/api/server/state", headers: { "x-control-token": access } })).statusCode, 503);
});

await test("portable backend uses bearer auth and validated platform-neutral state", async t => {
  const backend = Fastify();
  const seen: string[] = [];
  let invalid = false;
  backend.addHook("onRequest", (request, _reply, done) => {
    assert.equal(request.headers.authorization, `Bearer ${access}`);
    assert.equal(request.headers["x-control-token"], undefined);
    assert.equal(request.headers["x-admin-token"], undefined);
    seen.push(`${request.method} ${request.url}`);
    done();
  });
  const state = {
    available: true, phase: "stopped", checkedAt: 1000,
    realmRunning: false, databaseRunning: true, logicalCpus: 16,
    samples: [{ time: 1000, cpuPercent: 12.5, memoryBytes: 1024 }],
  };
  backend.get("/api/state", () => invalid ? { ...state, logicalCpus: 0 } : { ...state, secret: "private" });
  backend.get("/api/job", () => null);
  backend.post("/api/action", (request, reply) => {
    assert.deepEqual(request.body, { action: "start" });
    return reply.code(202).send({ id: "systemd-1", action: "start", status: "running", secret: "private" });
  });
  const address = await backend.listen({ host: "127.0.0.1", port: 0 });
  const app = createServer(readConfig({ DASHBOARD_CONTROL_URL: address, DASHBOARD_CONTROL_TOKEN: "browser-token-0123456789abcdef0123456789",
    DASHBOARD_CONTROL_PROTOCOL: "v1", DASHBOARD_CONTROL_BACKEND_TOKEN: access }));
  t.after(async () => { await app.close(); await backend.close(); });
  const headers = { "x-control-token": "browser-token-0123456789abcdef0123456789" };
  assert.deepEqual((await app.inject({ url: "/api/server/state", headers })).json<unknown>(), state);
  assert.equal((await app.inject({ url: "/api/server/job", headers })).body, "null");
  const operation = await app.inject({ method: "POST", url: "/api/server/action", headers, payload: { action: "start" } });
  assert.deepEqual(operation.json<unknown>(), { id: "systemd-1", action: "start", status: "running" });
  assert.deepEqual(seen, ["GET /api/state", "GET /api/job", "POST /api/action"]);
  invalid = true;
  assert.equal((await app.inject({ url: "/api/server/state", headers })).statusCode, 503);
});

await test("control operations never follow redirects or retry rejected delivery", async t => {
  const backend = Fastify();
  let calls = 0;
  backend.post("/api/action", (_request, reply) => {
    calls++;
    return reply.code(302).header("Location", "/redirected").send();
  });
  backend.post("/redirected", () => { throw new Error("redirect followed"); });
  const address = await backend.listen({ host: "127.0.0.1", port: 0 });
  const app = createServer(readConfig({ DASHBOARD_CONTROL_URL: address, DASHBOARD_CONTROL_TOKEN: access,
    DASHBOARD_CONTROL_PROTOCOL: "v1", DASHBOARD_CONTROL_BACKEND_TOKEN: access }));
  t.after(async () => { await app.close(); await backend.close(); });
  const response = await app.inject({ method: "POST", url: "/api/server/action",
    headers: { "x-control-token": access }, payload: { action: "start" } });
  assert.equal(response.statusCode, 503);
  assert.equal(calls, 1);
});
