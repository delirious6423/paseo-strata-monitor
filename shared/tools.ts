import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { benchOptionsSchema, tuneOptionsSchema } from "./options";

// Strata's own maintenance tools, run through its command-line tool: a serving benchmark of the running model,
// autotune (finds the fastest settings and saves them as a preset), the saved presets themselves, and engine
// updates from the signed feed (and back). Also the model's server log, and the idle stop's record.

export const jobSchema = z.object({
  id: z.string(),
  kind: z.enum(["bench", "tune", "update", "recheck", "rollback", "idle"]),
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
  /** The engine version the last update kept; `strata components rollback` returns to it. */
  previous: z.string().nullable(),
});
export type UpdateCheck = z.infer<typeof updateCheckSchema>;

export const strataTools = defineRpc({
  name: "strata.tools",
  input: z.object({}),
  output: z.object({ job: jobSchema.nullable(), history: z.array(jobSchema), update: updateCheckSchema.nullable() }),
});

/** Benchmark the running model (Strata's serving-smoke suite: a few real requests, about a minute). */
export const strataBench = defineRpc({ name: "strata.bench", input: z.object({ id: z.string(), options: benchOptionsSchema.optional() }), output: z.object({ ok: z.literal(true) }) });

/** Autotune a model; stops whatever runs first (it needs the whole GPU). quick ≈ 20 min, thorough ≤ 2 h. */
export const strataTune = defineRpc({
  name: "strata.tune",
  input: z.object({ id: z.string(), mode: z.enum(["quick", "thorough"]), options: tuneOptionsSchema.optional() }),
  output: z.object({ ok: z.literal(true) }),
});

export const strataUpdateCheck = defineRpc({ name: "strata.update.check", input: z.object({}), output: updateCheckSchema });

/** Install the offered engine/control update; stops whatever runs first. */
export const strataUpdate = defineRpc({ name: "strata.update", input: z.object({}), output: z.object({ ok: z.literal(true) }) });

/** Go back to the engine version the last update kept; stops whatever runs first. */
export const strataRollback = defineRpc({ name: "strata.rollback", input: z.object({}), output: z.object({ ok: z.literal(true) }) });

export const presetSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  created: z.string().nullable(),
  /** Measured gain over the standard settings when it was saved, and its decode speed. */
  gainPct: z.number().nullable(),
  decodeTokS: z.number().nullable(),
  notice: z.string().nullable(),
  lastRecheck: z.string().nullable(),
});
export const presetStatusSchema = z.object({
  /** fresh: used at start; soft: used, but the PC or engine changed (a re-check is advised); hard: not used. */
  state: z.string().nullable(),
  reasons: z.array(z.string()),
  presets: z.array(presetSchema),
  switchedOff: z.boolean(),
  canUndo: z.boolean(),
});
export type PresetStatus = z.infer<typeof presetStatusSchema>;

/** The saved tunes for a model's settings (Strata's `presets status <run config>`). */
export const strataPresets = defineRpc({ name: "strata.presets", input: z.object({ id: z.string() }), output: presetStatusSchema });

/** Switch the saved tune off, go back to the previous one, use another, or delete one. Takes effect at the next start. */
export const strataPresetChange = defineRpc({
  name: "strata.presets.change",
  input: z.object({ id: z.string(), action: z.enum(["off", "undo", "apply", "delete"]), preset: z.string().optional() }),
  output: presetStatusSchema,
});

/** Strata's short re-check (about 2 minutes) that a saved preset is still as fast; stops whatever runs first. */
export const strataRecheck = defineRpc({
  name: "strata.recheck",
  input: z.object({ id: z.string(), preset: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

/** The last lines of a model's server log (its unit's journal, or Strata's runtime log). */
export const strataLog = defineRpc({
  name: "strata.log",
  input: z.object({ id: z.string() }),
  output: z.object({ source: z.string(), lines: z.array(z.string()) }),
});

/** Cancel the running tool. Autotune and update leave the settings/engine as they were. */
export const strataCancel = defineRpc({ name: "strata.cancel", input: z.object({}), output: z.object({ ok: z.literal(true) }) });
