import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const engineSchema = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.string(),
  port: z.number(),
  note: z.string().nullable(),
  state: z.enum(["stopped", "loading", "ready", "stopping", "failed"]),
  sinceMs: z.number().nullable(),
  error: z.string().nullable(),
});

export type Engine = z.infer<typeof engineSchema>;

export const strataEngines = defineRpc({
  name: "strata.engines",
  input: z.object({}),
  output: z.object({ engines: z.array(engineSchema) }),
});

// Load stops any other running Strata engine first: they all need the whole GPU.
export const strataLoad = defineRpc({
  name: "strata.load",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

// Abort a load in progress, or stop a running engine.
export const strataStop = defineRpc({
  name: "strata.stop",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
