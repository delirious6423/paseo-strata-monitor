import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const discoverySettings = defineSettings({
  id: "discovery",
  scope: "host",
  version: 1,
  schema: z.object({
    // Folders with Strata run configs that no Strata install lists (one absolute path per entry).
    extraFolders: z.array(z.string()).default([]),
    // Strata servers the scan can't see, e.g. on another machine (http(s) roots).
    extraUrls: z.array(z.string()).default([]),
    // Linux: start/stop models through the user systemd units that already run them.
    useSystemd: z.boolean().default(true),
  }),
});

export const engineSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string(),
  provider: z.string(),
  quant: z.string(),
  format: z.enum(["gguf", "exl3", "other"]),
  sizeBytes: z.number().nullable(),
  port: z.number(),
  config: z.string(),
  launcher: z.string(),
  source: z.string(),
  state: z.enum(["stopped", "loading", "ready", "stopping", "failed"]),
  sinceMs: z.number().nullable(),
  error: z.string().nullable(),
});

export type Engine = z.infer<typeof engineSchema>;

export const placeSchema = z.object({ path: z.string(), source: z.string(), models: z.number(), note: z.string().optional() });

export const strataEngines = defineRpc({
  name: "strata.engines",
  input: z.object({ rescan: z.boolean().optional() }),
  output: z.object({
    engines: z.array(engineSchema),
    places: z.array(placeSchema),
    /** Strata servers on this machine that no listed model accounts for; Load is refused while any runs. */
    elsewhere: z.array(z.object({ url: z.string(), model: z.string().nullable() })),
  }),
});

// Load stops any other running Strata model first: each needs the whole GPU.
export const strataLoad = defineRpc({
  name: "strata.load",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});

// Abort a load in progress, or stop a running model.
export const strataStop = defineRpc({
  name: "strata.stop",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.literal(true) }),
});
