import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";

// Local TCP listeners that belong to a running Strata server process: how the analytics find a server on
// a port nobody configured. Linux reads /proc; macOS uses lsof + ps; Windows uses PowerShell's
// Get-NetTCPConnection + Win32_Process. Read-only, own processes only, bounded in time.

/** A Strata HTTP server's command line (`serve/server.py`, `-m serve.server`). */
export const STRATA_SERVER = /serve[\\/]server\.py|-m\s+serve\.server\b/;

const exec = (cmd: string, args: string[], timeout = 3000) =>
  new Promise<string>((resolve) => execFile(cmd, args, { timeout, maxBuffer: 4 << 20, windowsHide: true }, (_e, out) => resolve(out ?? "")));

/** `/proc/net/tcp{,6}` rows in LISTEN state on loopback or any address -> socket inode -> port. */
export function parseProcNet(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || f[3] !== "0A") continue;
    const [addr, portHex] = f[1]!.split(":");
    const local = /^(0100007F|00000000|0{24}01000000|0{32}|0{16}FFFF00000100007F)$/i.test(addr!);
    if (local) out.set(f[9]!, parseInt(portHex!, 16));
  }
  return out;
}

async function linux(): Promise<number[]> {
  const inodes = new Map<string, number>();
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) for (const [k, v] of parseProcNet(await readFile(f, "utf8").catch(() => ""))) inodes.set(k, v);
  if (!inodes.size) return [];
  const ports = new Set<number>();
  for (const pid of await readdir("/proc").catch(() => [] as string[])) {
    if (!/^\d+$/.test(pid)) continue;
    const cmd = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).replace(/\0/g, " ");
    if (!STRATA_SERVER.test(cmd)) continue;
    for (const fd of await readdir(`/proc/${pid}/fd`).catch(() => [] as string[])) {
      const m = /^socket:\[(\d+)\]$/.exec(await readlink(`/proc/${pid}/fd/${fd}`).catch(() => ""));
      const port = m && inodes.get(m[1]!);
      if (port) ports.add(port);
    }
  }
  return [...ports];
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` -> pid -> ports (loopback or any address). */
export function parseLsof(text: string): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let pid = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) pid = line.slice(1);
    const m = /^n(\*|127\.0\.0\.1|\[::1?\]|localhost):(\d+)$/.exec(line);
    if (m && pid) out.set(pid, [...(out.get(pid) ?? []), Number(m[2])]);
  }
  return out;
}

async function mac(): Promise<number[]> {
  const byPid = parseLsof(await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpn"]));
  const ports: number[] = [];
  for (const [pid, p] of byPid) if (STRATA_SERVER.test(await exec("ps", ["-o", "command=", "-p", pid]))) ports.push(...p);
  return ports;
}

const PS = `$c=@{};Get-CimInstance Win32_Process|%{$c[[int]$_.ProcessId]=$_.CommandLine};` +
  `Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue|?{$_.LocalAddress -in '127.0.0.1','0.0.0.0','::','::1'}|` +
  `%{[pscustomobject]@{port=$_.LocalPort;cmd=$c[[int]$_.OwningProcess]}}|ConvertTo-Json -Compress`;

async function windows(): Promise<number[]> {
  const out = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS], 8000);
  try {
    const rows = JSON.parse(out || "[]");
    return (Array.isArray(rows) ? rows : [rows]).filter((r) => STRATA_SERVER.test(String(r.cmd ?? ""))).map((r) => Number(r.port));
  } catch {
    return [];
  }
}

export async function strataListeners(): Promise<number[]> {
  const ports = process.platform === "linux" ? await linux() : process.platform === "darwin" ? await mac() : process.platform === "win32" ? await windows() : [];
  return [...new Set(ports)].filter((p) => p > 0 && p < 65536).sort((a, b) => a - b);
}

/** strataListeners, shared by the analytics and the engine listing: a scan younger than `maxAgeMs` is reused. */
let last: { at: number; ports: Promise<number[]> } | null = null;
export function recentListeners(maxAgeMs: number): Promise<number[]> {
  if (!last || Date.now() - last.at > maxAgeMs) last = { at: Date.now(), ports: strataListeners().catch(() => []) };
  return last.ports;
}
