import { open } from "node:fs/promises";

// Reads the `general.*` key/values of a GGUF header, never tensors, so new quant types can't break it. All
// key/values are walked: some writers put `general.quantized_by` after the multi-MB tokenizer arrays.

const MAX_BYTES = 64 << 20;
const SIZES: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };

export type GgufMeta = Record<string, string | number | boolean>;

export function parseGgufHeader(buf: Buffer): GgufMeta {
  if (buf.length < 24 || buf.toString("latin1", 0, 4) !== "GGUF") throw new Error("not a GGUF file");
  const version = buf.readUInt32LE(4);
  let pos = 8;
  const need = (n: number) => {
    if (pos + n > buf.length) throw new RangeError("header truncated");
  };
  const u64 = () => {
    need(8);
    const v = Number(buf.readBigUInt64LE(pos));
    pos += 8;
    return v;
  };
  const u32 = () => {
    need(4);
    const v = buf.readUInt32LE(pos);
    pos += 4;
    return v;
  };
  const len = () => (version === 1 ? u32() : u64());
  const str = () => {
    const n = len();
    need(n);
    const s = buf.toString("utf8", pos, pos + n);
    pos += n;
    return s;
  };
  const scalar = (t: number): string | number | boolean => {
    if (t === 8) return str();
    const n = SIZES[t];
    if (n === undefined) throw new Error(`bad GGUF type ${t}`);
    need(n);
    const at = pos;
    pos += n;
    switch (t) {
      case 0: return buf.readUInt8(at);
      case 1: return buf.readInt8(at);
      case 2: return buf.readUInt16LE(at);
      case 3: return buf.readInt16LE(at);
      case 4: return buf.readUInt32LE(at);
      case 5: return buf.readInt32LE(at);
      case 6: return buf.readFloatLE(at);
      case 7: return buf.readUInt8(at) !== 0;
      case 10: return Number(buf.readBigUInt64LE(at));
      case 11: return Number(buf.readBigInt64LE(at));
      default: return buf.readDoubleLE(at);
    }
  };
  len(); // tensor count
  const kvs = len();
  const out: GgufMeta = {};
  for (let i = 0; i < kvs; i++) {
    const key = str();
    const type = u32();
    const general = key.startsWith("general.");
    if (type === 9) {
      const inner = u32();
      const count = len();
      for (let j = 0; j < count; j++) scalar(inner); // skipped (tags, languages)
      continue;
    }
    const value = scalar(type);
    if (general) out[key.slice(8)] = typeof value === "string" ? value.slice(0, 200) : value;
  }
  return out;
}

export async function readGgufMeta(path: string): Promise<GgufMeta | null> {
  let fh;
  try {
    fh = await open(path, "r");
    for (let size = 64 << 10; size <= MAX_BYTES; size *= 4) {
      const buf = Buffer.alloc(size);
      const { bytesRead } = await fh.read(buf, 0, size, 0);
      try {
        return parseGgufHeader(buf.subarray(0, bytesRead));
      } catch (e) {
        if (!(e instanceof RangeError) || bytesRead < size) return null;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}
