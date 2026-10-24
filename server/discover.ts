import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { type ModelCard, cardFor, readRunConfig } from "./models";
import { type Os, appInstallDir, appSettingsFile, settingsFile, systemdUserDir } from "./places";

// Finds every Strata model on this machine, read-only:
//  1. Strata installs, in Strata's own order (explicit STRATA_INSTALL_DIR, installs remembered in its settings
//     file, the desktop app's install), each holding setup-written `strata-<tag>.json` run configs;
//  2. folders the user adds in the plugin settings (any Strata run config JSON in them);
//  3. on Linux, user systemd units whose command or script runs a Strata run config (these keep their unit,
//     so desktop icons and the plugin agree on what is running).

export type Launcher =
  | { kind: "systemd"; unit: string }
  | { kind: "strata"; install: string };

export type Found = ModelCard & { id: string; config: string; launcher: Launcher; source: string };
export type Place = { path: string; source: string; models: number; note?: string };
export type Discovery = { models: Found[]; places: Place[] };

const readJson = async (p: string) => JSON.parse(await readFile(p, "utf8").catch(() => "{}"));
const isDir = async (p: string) => (await stat(p).catch(() => null))?.isDirectory() ?? false;
const real = (p: string) => realpath(p).catch(() => resolve(p));
const list = async (d: string) => (await readdir(d).catch(() => [] as string[])).sort();

/** Strata's rule for a setup-written run config name. */
export const isStrataConfigName = (n: string) =>
  n.startsWith("strata-") && n.endsWith(".json") && !n.endsWith(".shared-settings.json") && n.length > "strata-.json".length;

export async function installPlaces(o: Os): Promise<{ path: string; source: string }[]> {
  if (o.env.STRATA_INSTALL_DIR) return [{ path: o.env.STRATA_INSTALL_DIR, source: "STRATA_INSTALL_DIR" }];
  const out: { path: string; source: string }[] = [];
  const add = (p: unknown, source: string) => {
    if (typeof p === "string" && isAbsolute(p) && !out.some((x) => resolve(x.path) === resolve(p))) out.push({ path: p, source });
  };
  const own = await readJson(settingsFile(o));
  for (const p of Array.isArray(own.installs) ? own.installs.slice(0, 20) : []) add(p, "Strata settings");
  add(resolve(appInstallDir(o)), "Strata app");
  if (!o.env.STRATA_SETTINGS_FILE) {
    const app = await readJson(appSettingsFile(o));
    for (const p of Array.isArray(app.installs) ? app.installs.slice(0, 20) : []) add(p, "Strata app settings");
  }
  return out;
}

// ------------------------------------------------------------------------------------------- systemd units

/** Split an ExecStart= value into argv (systemd quoting: '...' and "..."), dropping prefix characters. */
export function splitExec(value: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(value)); ) out.push(m[1] ?? m[2] ?? m[3]!);
  if (out[0]) out[0] = out[0].replace(/^[-@:+!]+/, "");
  return out;
}

const expandSpecifiers = (s: string, home: string, instance: string | null) =>
  s.replace(/%%|%h|%i|%I/g, (t) => (t === "%%" ? "%" : t === "%h" ? home : instance ?? t));

/** Shell script: the `--config` path it passes, with simple `NAME=value` / `export NAME=value` variables expanded. */
export function configFromScript(text: string, scriptDir: string, env: Record<string, string | undefined> = {}): string | null {
  const vars: Record<string, string> = {};
  let cwd = scriptDir;
  const unq = (v: string) => v.trim().replace(/^"(.*)"$|^'(.*)'$/, "$1$2");
  const sub = (v: string) => v.replace(/\$\{(\w+)\}|\$(\w+)/g, (_, a, b) => vars[a ?? b] ?? env[a ?? b] ?? "");
  for (const line of text.split(/\r?\n/)) {
    const assign = /^\s*(?:export\s+)?([A-Za-z_]\w*)=(.*)$/.exec(line);
    if (assign && !/--config\b/.test(line)) {
      vars[assign[1]!] = sub(unq(assign[2]!.replace(/\s+#.*$/, "")));
      continue;
    }
    const cd = /^\s*cd\s+(.+?)\s*(?:&&.*)?$/.exec(line);
    if (cd) cwd = resolve(cwd, sub(unq(cd[1]!)));
    const cfg = /--config["']?(?:=|\s+)("[^"]+"|'[^']+'|[^\s"']+)/.exec(line);
    if (cfg) {
      const p = sub(unq(cfg[1]!));
      return isAbsolute(p) ? p : resolve(cwd, p);
    }
  }
  return null;
}

async function configForArgv(argv: string[], env: Os["env"]): Promise<string | null> {
  const i = argv.findIndex((a) => a === "--config" || a.startsWith("--config="));
  if (i >= 0) return argv[i]!.includes("=") ? argv[i]!.split("=", 2)[1]! : argv[i + 1] ?? null;
  const script = argv[0];
  if (!script || !isAbsolute(script)) return null;
  const st = await stat(script).catch(() => null);
  if (!st?.isFile() || st.size > 64 << 10) return null;
  const text = await readFile(script, "utf8").catch(() => "");
  if (text.startsWith("\x7fELF") || text.includes("\0")) return null;
  return configFromScript(text, dirname(script), env);
}

export async function systemdUnits(o: Os): Promise<{ unit: string; config: string }[]> {
  if (o.windows || process.platform === "darwin") return [];
  const dir = systemdUserDir(o);
  const out: { unit: string; config: string }[] = [];
  for (const file of await list(dir)) {
    if (!file.endsWith(".service")) continue;
    const text = await readFile(join(dir, file), "utf8").catch(() => "");
    const exec = /^\s*ExecStart\s*=\s*(.+)$/m.exec(text)?.[1];
    if (!exec) continue;
    if (!file.endsWith("@.service")) {
      const config = await configForArgv(splitExec(expandSpecifiers(exec, o.home, null)), { HOME: o.home, ...o.env });
      if (config) out.push({ unit: file, config });
      continue;
    }
    // Template: instances are the values of %i that make its command's file exist (e.g. run-%i.sh).
    const argv = splitExec(expandSpecifiers(exec, o.home, "\0"));
    const at = argv.findIndex((a) => a.includes("\0"));
    if (at < 0) continue;
    const pattern = argv[at]!;
    if (!isAbsolute(pattern) || dirname(pattern).includes("\0")) continue; // %i must name a file, e.g. run-%i.sh
    const [pre, post] = [basename(pattern).split("\0")[0]!, basename(pattern).split("\0")[1] ?? ""];
    for (const name of await list(dirname(pattern))) {
      if (!name.startsWith(pre) || !name.endsWith(post) || name.length <= pre.length + post.length) continue;
      const instance = name.slice(pre.length, name.length - post.length);
      if (!/^[A-Za-z0-9_.-]+$/.test(instance)) continue;
      const config = await configForArgv(splitExec(expandSpecifiers(exec, o.home, instance)), { HOME: o.home, ...o.env });
      if (config) out.push({ unit: file.replace("@.service", `@${instance}.service`), config });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------- everything

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "model";

export async function discover(o: Os, opts: { extraFolders?: string[]; systemd?: boolean } = {}): Promise<Discovery> {
  const places: Place[] = [];
  const byConfig = new Map<string, Found>();
  const firstInstall = { path: null as string | null };

  const addConfig = async (config: string, launcher: Launcher | null, source: string): Promise<boolean> => {
    const key = await real(config);
    if (byConfig.has(key)) return false;
    const rc = await readRunConfig(config);
    if (!rc) return false;
    const card = await cardFor(rc);
    const chosen: Launcher | null = launcher ?? (firstInstall.path ? { kind: "strata", install: firstInstall.path } : null);
    if (!chosen) return false;
    const id = chosen.kind === "systemd" ? `unit:${chosen.unit}` : `cfg:${slug(basename(config, ".json").replace(/^strata-/, ""))}`;
    let unique = id;
    for (let n = 2; [...byConfig.values()].some((f) => f.id === unique); n++) unique = `${id}-${n}`;
    byConfig.set(key, { ...card, id: unique, config, launcher: chosen, source });
    return true;
  };

  if (opts.systemd !== false && !o.windows && process.platform !== "darwin") {
    const units = await systemdUnits(o);
    let n = 0;
    for (const u of units) if (await addConfig(u.config, { kind: "systemd", unit: u.unit }, `service ${u.unit}`)) n++;
    places.push({ path: systemdUserDir(o), source: "systemd user services", models: n });
  }
  for (const p of await installPlaces(o)) {
    const configs = (await list(p.path)).filter(isStrataConfigName);
    if (configs.length && !firstInstall.path) firstInstall.path = p.path;
    let n = 0;
    for (const c of configs) if (await addConfig(join(p.path, c), { kind: "strata", install: p.path }, `Strata install ${p.path}`)) n++;
    places.push({ path: p.path, source: p.source, models: n, note: (await isDir(p.path)) ? undefined : "not found" });
  }
  for (const folder of opts.extraFolders ?? []) {
    let n = 0;
    for (const f of (await list(folder)).filter((x) => x.endsWith(".json") && !x.endsWith(".shared-settings.json"))) {
      if (await addConfig(join(folder, f), null, `folder ${folder}`)) n++;
    }
    const exists = await isDir(folder);
    places.push({
      path: folder, source: "plugin settings", models: n,
      note: !exists ? "not found" : !firstInstall.path && n === 0 ? "needs a Strata install to run configs" : undefined,
    });
  }
  return { models: [...byConfig.values()], places };
}
