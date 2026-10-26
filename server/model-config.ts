import { isUtf8 } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fsyncSync, fstatSync, lstatSync, linkSync, mkdirSync, openSync, readdirSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { MAX_CONFIG_BYTES, modelConfigFields, fieldValue, type ModelConfigDocument } from "../shared/model-config";
import { exclusive, findModel, isBusy, listEngines } from "./control";

const note = "Saved configuration is used at the next manual load. Saving never restarts the model. Unknown settings are retained by the main controls; advanced JSON edits the entire document. By default the newest 10 Paseo backups stay beside this config; older Paseo backups are retained in its .paseo-backup-archive directory, never deleted. Permanent deletion requires explicitly selecting the backup deletion checkbox for that save. Legacy and other backups are untouched.";
export const configDigest = (raw: string) => createHash("sha256").update(raw).digest("hex");
const object = (v: unknown): v is ModelConfigDocument => !!v && typeof v === "object" && !Array.isArray(v);
const loopback = (v: unknown) => typeof v === "string" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(v.toLowerCase());
const secretKey = /^(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|cookie|credentials|private[_-]?key)$|(?:^|[_-])(?:api[_-]?key|access[_-]?key|token|secret|password|passwd|credential|private[_-]?key)(?:$|[_-])/i;
function checkSecrets(value: unknown, depth = 0): void {
  if (depth > 40) throw new Error("Configuration nesting exceeds 40 levels");
  if (typeof value === "string") {
    if (/[a-z][a-z0-9+.-]*:\/\/[^\s/]+@|\bBearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:^|[\s?&])(?:--)?(?:api[_-]?key|access[_-]?token|password|authorization)(?:[=\s:])/i.test(value)) {
      throw new Error("Configuration contains credentials; edit this file locally instead. No configuration contents were returned.");
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      if (typeof item === "string" && item.startsWith("--") && secretKey.test(item.slice(2).split("=")[0]!)) {
        throw new Error("Configuration contains credential arguments; edit this file locally instead.");
      }
      checkSecrets(item, depth + 1);
    }
  } else if (object(value)) {
    for (const [key, v] of Object.entries(value)) {
      if (secretKey.test(key) && v !== null && v !== "" && v !== false) {
        throw new Error("Configuration contains credentials (including environment or MCP settings); edit this file locally instead. No configuration contents were returned.");
      }
      checkSecrets(v, depth + 1);
    }
  }
}
export function parseModelConfig(raw: string): ModelConfigDocument {
  if (Buffer.byteLength(raw, "utf8") > MAX_CONFIG_BYTES) throw new Error("Configuration exceeds 256 KiB");
  let c: unknown;
  try { c = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { throw new Error("Configuration must be valid JSON"); }
  if (!object(c)) throw new Error("Configuration must be a JSON object");
  checkSecrets(c);
  if (typeof c.exe !== "string" || !c.exe.trim()) throw new Error("Configuration needs a nonempty exe string");
  for (const key of ["args", "user_args", "args_written"]) {
    if ((key === "args" || key in c) && (!Array.isArray(c[key]) || !(c[key] as unknown[]).every(a => typeof a === "string" && !a.includes("\0")))) {
      throw new Error(`${key} must be an array of strings without NUL characters`);
    }
  }
  return c;
}

/** Local-only policy is deliberate: this editor has no secure remote binding workflow. */
export function validateModelConfig(c: ModelConfigDocument): void {
  checkSecrets(c);
  if ("host" in c && !loopback(c.host)) throw new Error("Only loopback host bindings are supported by this editor");
  for (const key of ["args", "user_args"]) {
    const args = c[key] as string[] | undefined;
    for (let i = 0; i < (args?.length ?? 0); i++) {
      const a = args![i]!;
      if ((a === "--host" && !loopback(args![i + 1])) || (a.startsWith("--host=") && !loopback(a.slice(7)))) {
        throw new Error("Engine arguments may only bind to loopback hosts");
      }
      if (a === "--listen" || a.startsWith("--listen=")) throw new Error("Alternate listen bindings are not supported by this editor");
    }
  }
  if ("port" in c && (!Number.isInteger(c.port) || Number(c.port) < 1 || Number(c.port) > 65535)) throw new Error("port must be a whole number from 1 to 65535");
  for (const field of modelConfigFields) {
    const value = fieldValue(c, field);
    if (value === undefined) continue;
    if (field.kind === "boolean" && typeof value !== "boolean") throw new Error(`${field.label} must be true or false`);
    if (field.kind === "choice" && !field.choices?.includes(String(value))) throw new Error(`${field.label} has an unsupported value`);
    if (field.kind === "number") {
      const n = field.flag && typeof value === "string" && value.trim() ? Number(value) : value;
      if (typeof n !== "number" || !Number.isFinite(n) || (field.integer && !Number.isInteger(n)) || (field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) throw new Error(`${field.label} is outside its supported range`);
    }
  }
  if (c.vision !== undefined && !object(c.vision)) throw new Error("vision must be an object or removed to disable it");
  if (c.lazy_load === true && c.vision) throw new Error("Lazy loading cannot be combined with vision");
  if (c.gpu !== undefined && !(Number.isInteger(c.gpu) && Number(c.gpu) >= 0) && !(typeof c.gpu === "string" && /^\d+(?:,\s*\d+)*$/.test(c.gpu)) && !(Array.isArray(c.gpu) && c.gpu.length > 0 && c.gpu.every(n => Number.isInteger(n) && n >= 0))) throw new Error("gpu must be a nonnegative index, index array, or comma list");
  if (c.sampling !== undefined) {
    if (!object(c.sampling)) throw new Error("sampling must be an object");
    for (const [key, min, max, whole, openMin] of [["temperature", 0, Infinity, false, false], ["top_p", 0, 1, false, true], ["top_k", 1, 64, true, false], ["min_p", 0, 1, false, false]] as const) {
      const n = c.sampling[key];
      if (n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n < min || (openMin && n === min) || n > max || (whole && !Number.isInteger(n)))) throw new Error(`sampling.${key} is outside its supported range`);
    }
  }
}

// Bounded descriptor reads also protect against symlink replacement and unexpectedly growing files.
function readConfigFile(path: string): { raw: string; mode: number } {
  if (!lstatSync(path).isFile()) throw new Error("Configuration must be a regular file, not a symlink");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_CONFIG_BYTES) throw new Error("Configuration must be a regular file no larger than 256 KiB");
    const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const n = readSync(fd, bytes, length, bytes.length - length, null);
      if (!n) break;
      length += n;
    }
    if (length > MAX_CONFIG_BYTES) throw new Error("Configuration exceeds 256 KiB");
    if (!isUtf8(bytes.subarray(0, length))) throw new Error("Configuration must be UTF8 text");
    return { raw: bytes.toString("utf8", 0, length), mode: st.mode & 0o777 };
  } finally { closeSync(fd); }
}
const writeSynced = (path: string, raw: string, mode: number) => {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, raw, "utf8");
    fchmodSync(fd, mode);
    fsyncSync(fd);
  } catch (error) {
    unlinkSync(path);
    throw error;
  } finally { closeSync(fd); }
};

// Only our namespaced backups qualify; old .bak files have no reliable ownership marker.
function backupFiles(config: string, dir: string) {
  const prefix = `${basename(config)}.bak-paseo-`;
  return readdirSync(dir).filter(name => name.startsWith(prefix) && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(name.slice(prefix.length)))
    .map(name => ({ name, path: join(dir, name), stat: lstatSync(join(dir, name)) })).filter(f => f.stat.isFile());
}
function archiveBackups(config: string, newest: string): void {
  const dir = dirname(config);
  const candidates = backupFiles(config, dir)
    .sort((a, b) => Number(b.path === newest) - Number(a.path === newest) || b.stat.mtimeMs - a.stat.mtimeMs || b.name.localeCompare(a.name));
  if (candidates.length <= 10) return;
  const archive = `${config}.paseo-backup-archive`;
  try { mkdirSync(archive, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  if (!lstatSync(archive).isDirectory()) throw new Error("Backup archive must be a directory, not a symlink");
  for (const { name } of candidates.slice(10)) {
    const source = join(dir, name);
    // Hard-link first: never overwrite an existing archive file or risk losing the only copy.
    linkSync(source, join(archive, name));
    unlinkSync(source);
  }
}

function pruneBackups(config: string, newest: string): void {
  const candidates = backupFiles(config, dirname(config));
  const archive = `${config}.paseo-backup-archive`;
  let archiveStat;
  try { archiveStat = lstatSync(archive); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  if (archiveStat) {
    if (!archiveStat.isDirectory()) throw new Error("Backup archive must be a directory, not a symlink");
    candidates.push(...backupFiles(config, archive));
  }
  candidates.sort((a, b) => Number(b.path === newest) - Number(a.path === newest) || b.stat.mtimeMs - a.stat.mtimeMs || b.name.localeCompare(a.name));
  for (const candidate of candidates.slice(10)) {
    // Recheck identity: never remove a symlink or a different file swapped in since enumeration.
    if (dirname(candidate.path) === archive) {
      const current = lstatSync(archive);
      if (!current.isDirectory() || current.ino !== archiveStat!.ino || current.dev !== archiveStat!.dev) throw new Error("Backup archive changed");
    }
    const current = lstatSync(candidate.path);
    if (!current.isFile() || current.ino !== candidate.stat.ino || current.dev !== candidate.stat.dev || current.mtimeMs !== candidate.stat.mtimeMs || current.size !== candidate.stat.size) throw new Error("Backup changed");
    if (candidate.path !== newest) unlinkSync(candidate.path);
  }
}

type Dependencies = {
  find: typeof findModel;
  listing: typeof listEngines;
  busy: typeof isBusy;
  withLock: <T>(fn: () => Promise<T>) => Promise<T>;
};
/** Default lock is the same queue as Load/Stop; dependencies allow tests to use only temporary fixtures. */
export function createModelConfigService(deps: Partial<Dependencies> = {}) {
  const { find, listing, busy, withLock }: Dependencies = { find: findModel, listing: listEngines, busy: isBusy, withLock: exclusive, ...deps };
  const read = async ({ id }: { id: string }) => {
    const model = await find(id); // Never accept a path from the caller.
    const { raw } = readConfigFile(model.config);
    const parsed = parseModelConfig(raw); // Fail closed; never send raw text (duplicate JSON keys can hide secrets).
    const json = JSON.stringify(parsed, null, 2) + "\n";
    if (Buffer.byteLength(json) > MAX_CONFIG_BYTES) throw new Error("Formatted configuration exceeds 256 KiB");
    return { id, json, digest: configDigest(raw), note };
  };
  const save = async ({ id, json, digest, pruneBackups: prune = false }: { id: string; json: string; digest: string; pruneBackups?: boolean }) => {
    if (typeof prune !== "boolean") throw new Error("Backup deletion requires a boolean opt-in");
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid configuration revision");
    const next = parseModelConfig(json);
    validateModelConfig(next);
    return withLock(async () => {
      if (busy()) throw new Error("A tool is running; wait or cancel it before saving configuration");
      const model = await find(id);
      const state = await listing(true);
      if (!state.engines.some(e => e.id === id)) throw new Error("Model is no longer available; search again");
      if (state.elsewhere.length || state.engines.some(e => e.state !== "stopped" && e.state !== "failed")) throw new Error("Stop all models before saving configuration");
      // No await below: tools cannot claim their slot between the last busy check and atomic replacement.
      if (busy()) throw new Error("A tool started; wait or cancel it before saving configuration");
      const { raw, mode } = readConfigFile(model.config);
      parseModelConfig(raw);
      if (configDigest(raw) !== digest) throw new Error("Configuration changed on disk. Reload it before saving; your draft has not been written.");
      const suffix = randomUUID();
      const backup = `${model.config}.bak-paseo-${suffix}`;
      const temp = join(dirname(model.config), `.${basename(model.config)}.${suffix}.tmp`);
      const formatted = JSON.stringify(next, null, 2) + "\n";
      if (Buffer.byteLength(formatted) > MAX_CONFIG_BYTES) throw new Error("Formatted configuration exceeds 256 KiB");
      let tempOwned = false;
      try {
        // Backups are immutable unique files, not a followed .bak symlink. Always private.
        writeSynced(backup, raw, 0o600);
        writeSynced(temp, formatted, mode & 0o600);
        tempOwned = true;
        if (configDigest(readConfigFile(model.config).raw) !== digest) throw new Error("Configuration changed while saving. Reload before saving again.");
        renameSync(temp, model.config);
        tempOwned = false;
      } finally {
        if (tempOwned) unlinkSync(temp);
      }
      let savedNote = note;
      try {
        if (prune) {
          pruneBackups(model.config, backup);
          savedNote += " Backup deletion was enabled for this save: only the newest 10 plugin backups are retained across the config directory and archive.";
        } else archiveBackups(model.config, backup);
      } catch {
        // Saving already succeeded. Retention failure must not look like an unsuccessful config save.
        savedNote += prune ? " Backup pruning could not finish; some older backups remain. Configuration save succeeded." : " Backup archiving could not finish; all unarchived backups remain beside the config.";
      }
      return { id, json: formatted, digest: configDigest(formatted), note: savedNote, backup: basename(backup), restartRequired: true as const };
    });
  };
  return { read, save };
}
