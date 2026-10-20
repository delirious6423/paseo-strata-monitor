import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const num = z.number().nullable();

export const snapshotSchema = z.object({
  online: z.boolean(),
  url: z.string().nullable(),
  error: z.string().nullable(),
  model: z.string().nullable(),
  maxContext: num,
  state: z.string().nullable(),
  phase: z.string().nullable(),
  queued: num,
  generated: num,
  maxTokens: num,
  elapsedS: num,
  tokS: num,
  tokSMean: num,
  prefillTokSMean: num,
  lastDecodeTokS: num,
  lastPrefillTokS: num,
  gpu: z.object({
    util: num, tempC: num, powerW: num, memUsed: num, memTotal: num, cpu: num, ramUsed: num, ramTotal: num,
  }),
  totals: z.object({ requests: num, promptTokens: num, outputTokens: num }),
  recent: z.array(
    z.object({ time: num, durationS: num, finish: z.string().nullable(), promptTokens: num, outputTokens: num, tokS: num }),
  ),
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export const strataSnapshot = defineRpc({
  name: "strata.snapshot",
  input: z.object({}),
  output: snapshotSchema,
});
