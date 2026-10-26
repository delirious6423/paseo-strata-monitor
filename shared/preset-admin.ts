import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PRESET_JSON_LIMIT = 512 * 1024;
const model = { id: z.string().min(1).max(512) };
const selected = { ...model, preset: z.string().regex(/^[a-f0-9]{32}$/i) };
export const presetName = z.string().trim().min(1).max(80).refine((s) => !/[\x00-\x1f\x7f]/.test(s), "Names cannot contain control characters");
export const presetImportInput = z.object({ ...model, json: z.string().min(2).max(PRESET_JSON_LIMIT) });
const jsonOutput = z.object({ json: z.string() });
export const strataPresetDetails = defineRpc({ name: "strata.presets.details", input: z.object(selected), output: jsonOutput });
export const strataPresetExport = defineRpc({ name: "strata.presets.export", input: z.object(selected), output: jsonOutput });
export const strataPresetRename = defineRpc({ name: "strata.presets.rename", input: z.object({ ...selected, name: presetName }), output: z.object({ ok: z.literal(true) }) });
export const strataPresetImport = defineRpc({ name: "strata.presets.import", input: presetImportInput, output: z.object({ name: z.string(), visible: z.boolean() }) });
export const strataPresetEffective = defineRpc({ name: "strata.presets.effective", input: z.object(model), output: jsonOutput });
