// Inside the screenshot VM (as the test user): a Strata-like machine with the author's real model line-up
// (names, quants, providers and sizes from their discovery; weights are empty sparse files of the real size,
// GGUFs carry real-shaped headers). Strata itself is the fake CLI/server from fake-strata/.
import { closeSync, cpSync, chmodSync, mkdirSync, openSync, ftruncateSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = homedir();
const here = dirname(fileURLToPath(import.meta.url));
const app = join(home, "Strata");
cpSync(join(here, "fake-strata"), app, { recursive: true });
chmodSync(join(app, "bin", "strata"), 0o755);
mkdirSync(join(home, ".config/strata"), { recursive: true });
writeFileSync(join(home, ".config/strata/settings.json"), JSON.stringify({ installs: [app] }));

const GB = 1e9;
const sparse = (file, bytes, head = Buffer.alloc(0)) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, head);
  const fd = openSync(file, "r+");
  ftruncateSync(fd, Math.max(bytes, head.length));
  closeSync(fd);
};
const str = (s) => { const b = Buffer.from(s); const n = Buffer.alloc(8); n.writeBigUInt64LE(BigInt(b.length)); return Buffer.concat([n, b]); };
const gguf = (kvs) => {
  const head = Buffer.alloc(24);
  head.write("GGUF", 0, "latin1"); head.writeUInt32LE(3, 4); head.writeBigUInt64LE(0n, 8); head.writeBigUInt64LE(BigInt(kvs.length), 16);
  const t = Buffer.alloc(4); t.writeUInt32LE(8);
  return Buffer.concat([head, ...kvs.flatMap(([k, v]) => [str(k), t, str(v)])]);
};
const hub = join(home, ".cache/huggingface/hub");
const config = (id, args) => writeFileSync(join(app, `strata-${id}.json`), JSON.stringify({ exe: join(app, "engine", "strata"), args, model_name: id, port: 8080 }));

const ggufs = [
  ["gyro-s-tq1_0", "Agention", "Qwen3.8-Flash-Next-Gyro-S-TQ1_0.gguf", 58.5, 1],
  ["gyro-m-tq2_0", "Agention", "Qwen3.8-Flash-Next-Gyro-M-TQ2_0.gguf", 92.0, 1],
  ["iq3_xxs", "ISTA DASLab", "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS", 75.8, 2],
  ["iq3_s", "ISTA DASLab", "Qwen3.8-Flash-Next-GSQ-RCO-IQ3_S", 83.6, 2],
];
for (const [id, by, file, gb, parts] of ggufs) {
  const dir = join(home, "Models");
  const names = parts === 1 ? [file] : Array.from({ length: parts }, (_, i) => `${file}-0000${i + 1}-of-0000${parts}.gguf`);
  names.forEach((n, i) => sparse(join(dir, n), (gb * GB) / parts, i ? undefined : gguf([["general.basename", "Qwen3.8-Flash-Next"], ["general.quantized_by", by]])));
  config(id, ["--native", join(dir, names[0])]);
}
const exl3 = [
  ["sc-exl3-2.05-h8", "scorpoon", 2.05, 8, 75.8],
  ["sc-exl3-3.05-h8", "scorpoon", 3.05, 8, 92.3],
  ["td-exl3-2.18-h6", "turboderp", 2.18, 6, 90.5],
  ["td-exl3-2.66-h6", "turboderp", 2.66, 6, 98.3],
];
for (const [id, org, bits, head, gb] of exl3) {
  const dir = join(hub, `models--${org}--Qwen3.8-Flash-Next-exl3`, "snapshots", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "quantization_config.json"), JSON.stringify({ quant_method: "exl3", bits, head_bits: head }));
  writeFileSync(join(dir, "README.md"), "---\nbase_model: Qwen/Qwen3.8-Flash-Next\n---\n");
  for (let i = 1; i <= 4; i++) sparse(join(dir, `model-0000${i}-of-00004.safetensors`), (gb * GB) / 4);
  config(id, ["--exl3", dir]);
}
console.log("demo machine ready");
