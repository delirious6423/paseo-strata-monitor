import type { Engine } from "./control";

export type Group = { title: string; engines: Engine[] };

const size = (e: Engine) => e.sizeBytes ?? Number.POSITIVE_INFINITY;

/** Picker order: one group per quant provider (titled "family · provider" when there are several families).
 *  Smallest model first in a group; groups ordered by their smallest model, keeping each family together
 *  (families ordered by their smallest model). So the smallest model is always on top. */
export function groupEngines(engines: Engine[]): Group[] {
  const families = new Set(engines.map((e) => e.family.toLowerCase()));
  const groups = new Map<string, Group>();
  for (const e of engines) {
    const title = families.size > 1 ? `${e.family} · ${e.provider}` : e.provider;
    const key = title.toLowerCase();
    if (!groups.has(key)) groups.set(key, { title, engines: [] });
    groups.get(key)!.engines.push(e);
  }
  const bySize = (a: Engine, b: Engine) => size(a) - size(b) || a.quant.localeCompare(b.quant) || a.id.localeCompare(b.id);
  const familyMin = new Map<string, number>();
  for (const e of engines) familyMin.set(e.family.toLowerCase(), Math.min(familyMin.get(e.family.toLowerCase()) ?? Infinity, size(e)));
  const fam = (g: Group) => familyMin.get(g.engines[0]!.family.toLowerCase())!;
  return [...groups.values()]
    .map((g) => ({ ...g, engines: g.engines.sort(bySize) }))
    .sort((a, b) => fam(a) - fam(b) || a.engines[0]!.family.localeCompare(b.engines[0]!.family) || bySize(a.engines[0]!, b.engines[0]!));
}

export const gb = (bytes: number | null) => (bytes === null ? "size ?" : `${(bytes / 1e9).toFixed(bytes < 1e10 ? 1 : 0)} GB`);
