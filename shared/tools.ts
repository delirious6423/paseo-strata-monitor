import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Strata's own maintenance tools, run through its command-line tool: a serving benchmark of the running model,
// autotune (finds the fastest settings and saves them as a preset), and engine updates from the signed feed.

export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(["bench", "tune", "update"]),
  modelId: z.string().nullable(),
  model: z.string().nullable(),
  startedMs: z.number(),
  endedMs: z.number().nullable(),
  state: z.enum(["running", "done", "failed", "cancelled"]),
  pct: z.number().nullable(),
  message: z.string(),
  minutesLeft: z.number().nullable(),
  /** One-line result, e.g. "Faster settings found". */
  outcome: z.string().nullable(),
  details: z.array(z.string()),
  error: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

const part = z.object({ installed: z.string().nullable(), offered: z.string().nullable(), status: z.string() });
export const updateCheckSchema = z.object({
  checkedMs: z.number(),
  engine: part,
  control: part,
  downloadBytes: z.number().nullable(),
  /** False when no found model runs an engine from Strata's component folder: an update would not change them. */
  reachesModels: z.boolean(),
  available: z.boolean(),
});
export type UpdateCheck = z.infer<typeof updateCheckSchema>;

export const strataTools = defineRpc({
  name: "strata.tools",
  input: z.object({}),
  output: z.object({ job: jobSchema.nullable(), history: z.array(jobSchema), update: updateCheckSchema.nullable() }),
});

/** Benchmark the running model (Strata's serving-smoke suite: a few real requests, about a minute). */
export const strataBench = defineRpc({ name: "strata.bench", input: z.object({ id: z.string() }), output: z.object({ ok: z.literal(true) }) });

/** Autotune a model; stops whatever runs first (it needs the whole GPU). quick ≈ 20 min, thorough ≤ 2 h. */
export const strataTune = defineRpc({
  name: "strata.tune",
  input: z.object({ id: z.string(), mode: z.enum(["quick", "thorough"]) }),
  output: z.object({ ok: z.literal(true) }),
});

export const strataUpdateCheck = defineRpc({ name: "strata.update.check", input: z.object({}), output: updateCheckSchema });

/** Install the offered engine/control update; stops whatever runs first. */
export const strataUpdate = defineRpc({ name: "strata.update", input: z.object({}), output: z.object({ ok: z.literal(true) }) });

/** Cancel the running tool. Autotune and update leave the settings/engine as they were. */
export const strataCancel = defineRpc({ name: "strata.cancel", input: z.object({}), output: z.object({ ok: z.literal(true) }) });
