import type { AnalyzerIndex, Edge, EdgeKind } from "./model";

export interface RouteOptions {
  kinds: Set<EdgeKind>;
  /** Allow edges that are inside if/menu branches. */
  conditional: boolean;
}

/** Shortest static route (fewest transfers) from `from` to `to`, or null when unreachable. */
export function shortestRoute(index: AnalyzerIndex, from: string, to: string, opts: RouteOptions): Edge[] | null {
  if (from === to) return [];
  const out = new Map<string, Edge[]>();
  for (const e of index.edges) {
    if (e.dynamic || !opts.kinds.has(e.kind) || (!opts.conditional && e.conditional)) continue;
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
  }
  const prev = new Map<string, Edge>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift()!;
    for (const e of out.get(n) ?? []) {
      if (seen.has(e.to)) continue;
      seen.add(e.to);
      prev.set(e.to, e);
      if (e.to === to) {
        const path: Edge[] = [];
        for (let cur = to; cur !== from; cur = prev.get(cur)!.from) path.unshift(prev.get(cur)!);
        return path;
      }
      queue.push(e.to);
    }
  }
  return null;
}
