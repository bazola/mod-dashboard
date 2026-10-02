import { z } from "zod";

const number = z.number().nonnegative();
export const controlState = z.object({
  available: z.boolean(),
  phase: z.enum(["online", "starting", "stopped", "unknown", "unavailable"]),
  checkedAt: number,
  realmRunning: z.boolean(), databaseRunning: z.boolean(),
  logicalCpus: z.number().int().positive().nullable(),
  samples: z.array(z.object({ time: number, cpuPercent: number, memoryBytes: number })).max(120),
});
export const controlJob = z.object({
  id: z.string().min(1), action: z.enum(["start", "stop"]),
  status: z.enum(["running", "done", "failed"]),
});
