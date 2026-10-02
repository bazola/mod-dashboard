import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { z } from "zod";
import type { Config } from "./config.js";
import { controlJob, controlState } from "./control-contracts.js";

type ControlConfig = NonNullable<Config["control"]>;
const number = z.number().nonnegative();
const adminState = z.looseObject({
  time: number, docker: z.boolean(),
  containers: z.array(z.looseObject({ name: z.string(), Running: z.boolean() })),
  samples: z.array(z.looseObject({ time: number, cpu: number, memory: number })),
  runtime: z.unknown().optional(),
});
const session = z.object({ token: z.string().min(1) });
// The existing admin serializes all tasks in one job slot. Observe other tasks
// without granting the browser permission to submit them or returning their output.
const legacyJob = controlJob.extend({ action: z.string().min(1) });

export function tokenMatches(expected: string, supplied: unknown) {
  if (typeof supplied !== "string") return false;
  const actual = Buffer.from(supplied), wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(wanted, actual);
}

// Fixed backend routes only. Neither backend credentials nor arbitrary commands
// are exposed to the browser. See CONTROL.md for both wire protocols.
export class ControlApi {
  constructor(private readonly config: ControlConfig) {}

  private request(path: "/api/state" | "/api/job" | "/api/session" | "/api/action",
                  method: "GET" | "POST" = "GET", body?: { action: "start" | "stop" }, adminToken?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const target = new URL(path, this.config.origin);
      const transport = target.protocol === "https:" ? https : http;
      const payload = body ? JSON.stringify(body) : undefined;
      const headers: Record<string, string> = { Host: this.config.hostHeader, Accept: "application/json" };
      if (this.config.protocol === "v1") headers.Authorization = `Bearer ${this.config.backendToken ?? ""}`;
      if (payload) headers["Content-Type"] = "application/json";
      if (adminToken) headers["X-Admin-Token"] = adminToken;
      const request = transport.request(target, {
        method, headers, signal: AbortSignal.timeout(20000), agent: false,
      }, response => {
        if (response.statusCode !== 200 && response.statusCode !== 202) {
          response.resume();
          reject(new Error(`Admin service returned HTTP ${String(response.statusCode ?? 0)}`));
          return;
        }
        let text = "";
        let bytes = 0;
        response.setEncoding("utf8");
        response.on("data", (part: string) => {
          text += part;
          bytes += Buffer.byteLength(part);
          if (bytes > 2_000_000) request.destroy(new Error("Admin response too large"));
        });
        response.on("end", () => {
          try { resolve(JSON.parse(text) as unknown); }
          catch { reject(new Error("Admin returned malformed JSON")); }
        });
        response.on("error", reject);
      });
      request.on("error", reject);
      request.end(payload);
    });
  }

  async state() {
    const response = await this.request("/api/state");
    if (this.config.protocol === "v1") {
      const parsed = controlState.safeParse(response);
      if (!parsed.success) throw new Error("Control backend returned an invalid state");
      return parsed.data;
    }
    const parsed = adminState.safeParse(response);
    if (!parsed.success) throw new Error("Admin returned an invalid state");
    const source = parsed.data;
    const realm = source.containers.find(item => item.name === this.config.realmUnit);
    const database = source.containers.find(item => item.name === this.config.databaseUnit);
    const runtime = z.looseObject({
      worldReady: z.boolean().optional(),
      services: z.record(z.string(), z.string()).optional(),
      cpuCount: z.number().int().positive().optional(),
    }).safeParse(source.runtime);
    const world = runtime.success ? runtime.data.services?.world : undefined;
    const ready = Boolean(realm?.Running && runtime.success && runtime.data.worldReady && world === "RUNNING");
    const phase = !source.docker ? "unavailable" : !realm?.Running ? "stopped" : ready ? "online"
      : world === "STARTING" || world === "RUNNING" ? "starting" : world === "STOPPED" || world === "EXITED" || world === "FATAL" ? "stopped" : "unknown";
    return {
      available: source.docker, phase, checkedAt: source.time,
      realmRunning: Boolean(realm?.Running), databaseRunning: Boolean(database?.Running),
      logicalCpus: runtime.success ? runtime.data.cpuCount ?? null : null,
      samples: source.samples.slice(-120).map(item => ({ time: item.time, cpuPercent: item.cpu, memoryBytes: item.memory })),
    };
  }

  async job() {
    const response = await this.request("/api/job");
    if (response === null) return null;
    const parsed = (this.config.protocol === "v1" ? controlJob : legacyJob).safeParse(response);
    if (!parsed.success) throw new Error("Admin returned an invalid job");
    return { id: parsed.data.id, action: parsed.data.action, status: parsed.data.status };
  }

  async action(action: "start" | "stop") {
    if (this.config.protocol === "v1") {
      const response = controlJob.safeParse(await this.request("/api/action", "POST", { action }));
      if (!response.success || response.data.action !== action) throw new Error("Control backend did not accept the operation");
      return response.data;
    }
    const parsed = session.safeParse(await this.request("/api/session"));
    if (!parsed.success) throw new Error("Admin session unavailable");
    const response = controlJob.safeParse(await this.request("/api/action", "POST", { action }, parsed.data.token));
    if (!response.success || response.data.action !== action) throw new Error("Admin did not accept the operation");
    return { id: response.data.id, action: response.data.action, status: response.data.status };
  }
}
