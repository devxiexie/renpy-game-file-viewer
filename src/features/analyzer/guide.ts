import type { AnalyzerIndex, ChoiceItem, Edge, LabelInfo, MenuInfo, VariableInfo, Via } from "./model";

/**
 * Walkthrough data derived from the index: the game's endings, the route to any label with
 * the fewest decisions (menu options to pick and conditions to pass), the variables those
 * conditions need and which choices change them, and a story-order guide of every menu.
 */

const SYSTEM_LABELS = new Set(["splashscreen", "main_menu", "before_main_menu", "after_load", "after_warp", "quit", "_start"]);

export function startLabels(index: AnalyzerIndex): string[] {
  if (index.labels.some((l) => l.name === "start")) return ["start"];
  return index.labels.filter((l) => l.entry && !SYSTEM_LABELS.has(l.name)).map((l) => l.name);
}

export interface Route {
  start: string;
  edges: Edge[];
  /** Menu options and conditions along the route. */
  decisions: number;
}

export interface RouteTree {
  starts: string[];
  dist: Map<string, number>;
  prev: Map<string, Edge>;
}

const cost = (e: Edge) => e.via?.length ?? 0;

/** Shortest-decision routes from the start label(s) to every label (Dial's algorithm, small integer costs). */
export function routeTree(index: AnalyzerIndex, starts = startLabels(index)): RouteTree {
  const out = new Map<string, Edge[]>();
  for (const e of index.edges) if (!e.dynamic) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e);
  const dist = new Map<string, number>();
  const prev = new Map<string, Edge>();
  const buckets: string[][] = [[...starts]];
  for (const s of starts) dist.set(s, 0);
  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let i = 0; i < bucket.length; i++) {
      const n = bucket[i];
      if (dist.get(n) !== d) continue;
      for (const e of out.get(n) ?? []) {
        const nd = d + cost(e);
        if (nd < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, nd);
          prev.set(e.to, e);
          (buckets[nd] ??= []).push(e.to);
        }
      }
    }
  }
  return { starts, dist, prev };
}

export function routeFromTree(tree: RouteTree, target: string): Route | null {
  const d = tree.dist.get(target);
  if (d === undefined) return null;
  const edges: Edge[] = [];
  let cur = target;
  for (let guard = 0; !tree.starts.includes(cur) && guard < 100_000; guard++) {
    const e = tree.prev.get(cur);
    if (!e) break;
    edges.unshift(e);
    cur = e.from;
  }
  return { start: cur, edges, decisions: d };
}

export function routeTo(index: AnalyzerIndex, target: string): Route | null {
  return routeFromTree(routeTree(index), target);
}

export interface RouteDecision {
  label: string;
  edge: Edge;
  via: Via;
}

/** The menu options to pick and conditions to pass along a route, in order. */
export function routeDecisions(route: Route): RouteDecision[] {
  return route.edges.flatMap((edge) => (edge.via ?? []).map((via) => ({ label: edge.from, edge, via })));
}

export function viaText(v: Via): string {
  if (v.kind === "choice") return v.text;
  if (v.kind === "condition") return v.code;
  return v.not.length ? `not (${v.not.join(" or ")})` : "else";
}

export interface ChoiceRef {
  menu: MenuInfo;
  item: number;
}

export interface Requirement {
  variable: VariableInfo;
  /** Conditions on the route that test this variable. */
  conditions: string[];
  /** Menu options that change the variable. */
  changedBy: ChoiceRef[];
}

function variableMatcher(index: AnalyzerIndex) {
  const vars = index.variables.filter((v) => v.declared !== "define" || v.refs.some((r) => r.kind === "write"));
  const res = vars.map((v) => [v, new RegExp(`(?<![\\w.])${v.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`)] as const);
  return (code: string) => res.filter(([, re]) => re.test(code)).map(([v]) => v);
}

/** Variables tested by the conditions on a route, with the choices that change them. */
export function routeRequirements(index: AnalyzerIndex, route: Route): Requirement[] {
  const find = variableMatcher(index);
  const byVar = new Map<string, Requirement>();
  for (const d of routeDecisions(route)) {
    const code = d.via.kind === "choice" ? d.via.condition : d.via.kind === "condition" ? d.via.code : d.via.not.length ? viaText(d.via) : null;
    if (!code) continue;
    for (const v of find(code)) {
      let r = byVar.get(v.name);
      if (!r) byVar.set(v.name, (r = { variable: v, conditions: [], changedBy: [] }));
      if (!r.conditions.includes(code)) r.conditions.push(code);
    }
  }
  for (const r of byVar.values()) {
    for (const menu of index.menus) menu.items.forEach((it, i) => it.writes.includes(r.variable.name) && r.changedBy.push({ menu, item: i }));
  }
  return [...byVar.values()];
}

export type EndingTone = "good" | "bad" | "true" | "secret" | "normal";

export interface Ending {
  label: LabelInfo;
  how: "return" | "restart" | "end-of-script";
  tone: EndingTone | null;
  route: Route | null;
}

export function endingTone(name: string, last?: string | null): EndingTone | null {
  const n = name.toLowerCase();
  if (/true/.test(n)) return "true";
  if (/secret|hidden/.test(n)) return "secret";
  if (/bad|death|dead|die|fail|game_?over|worst/.test(n)) return "bad";
  if (/good|happy|best|perfect/.test(n)) return "good";
  if (/normal|neutral|regular/.test(n)) return "normal";
  const m = last ? /\b(good|happy|true|bad|normal|neutral|secret)\s+end(?:ing)?\b/i.exec(last) : null;
  if (m) return ({ happy: "good", neutral: "normal" } as Record<string, EndingTone>)[m[1].toLowerCase()] ?? (m[1].toLowerCase() as EndingTone);
  if (last && /game over|you died/i.test(last)) return "bad";
  return null;
}

function bfs(out: Map<string, string[]>, starts: string[]): Set<string> {
  const seen = new Set<string>(starts);
  const queue = [...starts];
  while (queue.length) for (const m of out.get(queue.shift()!) ?? []) if (!seen.has(m)) (seen.add(m), queue.push(m));
  return seen;
}

/**
 * Labels where a playthrough ends: they `return` to the main menu (and aren't part of a
 * `call`), restart / quit the game, or run off the end of the script.
 */
export function findEndings(index: AnalyzerIndex, tree = routeTree(index)): Ending[] {
  const called = new Set(index.edges.filter((e) => e.kind === "call" && !e.dynamic).map((e) => e.to));
  const flow = new Map<string, string[]>();
  for (const e of index.edges) if (!e.dynamic && e.kind !== "call") (flow.get(e.from) ?? flow.set(e.from, []).get(e.from)!).push(e.to);
  const callScope = bfs(flow, [...called]);
  const mainScope = bfs(flow, tree.starts);
  const out: Ending[] = [];
  for (const l of index.labels) {
    if (SYSTEM_LABELS.has(l.name) || (l.dialogue === 0 && !l.endsGame)) continue;
    let how: Ending["how"] | null = null;
    if (l.endsGame) how = "restart";
    else if (l.ending === "return" && (mainScope.has(l.name) || !callScope.has(l.name))) how = "return";
    else if (l.ending === "fallthrough" && !called.has(l.name) && !index.edges.some((e) => e.from === l.name && e.kind !== "call")) how = "end-of-script";
    if (!how) continue;
    out.push({ label: l, how, tone: endingTone(l.name, l.last?.what), route: routeFromTree(tree, l.name) });
  }
  return out.sort((a, b) => (a.route ? 0 : 1) - (b.route ? 0 : 1) || (a.route?.decisions ?? 0) - (b.route?.decisions ?? 0) || a.label.name.localeCompare(b.label.name));
}

/** For every label, the endings reachable from it (strongly connected components, then a DAG pass). */
export function endingsReachable(index: AnalyzerIndex, endings: Ending[]): Map<string, Set<string>> {
  const names = index.labels.map((l) => l.name);
  const out = new Map<string, string[]>(names.map((n) => [n, []]));
  for (const e of index.edges) if (!e.dynamic && out.has(e.from) && out.has(e.to)) out.get(e.from)!.push(e.to);
  // Tarjan's SCC, iteratively.
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comp = new Map<string, number>();
  const comps: string[][] = [];
  let counter = 0;
  for (const root of names) {
    if (idx.has(root)) continue;
    const work: { n: string; i: number }[] = [{ n: root, i: 0 }];
    idx.set(root, counter);
    low.set(root, counter++);
    stack.push(root);
    onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const next = out.get(top.n)![top.i++];
      if (next !== undefined) {
        if (!idx.has(next)) {
          idx.set(next, counter);
          low.set(next, counter++);
          stack.push(next);
          onStack.add(next);
          work.push({ n: next, i: 0 });
        } else if (onStack.has(next)) low.set(top.n, Math.min(low.get(top.n)!, idx.get(next)!));
        continue;
      }
      work.pop();
      if (work.length) low.set(work[work.length - 1].n, Math.min(low.get(work[work.length - 1].n)!, low.get(top.n)!));
      if (low.get(top.n) === idx.get(top.n)) {
        const c: string[] = [];
        let m: string;
        do {
          m = stack.pop()!;
          onStack.delete(m);
          comp.set(m, comps.length);
          c.push(m);
        } while (m !== top.n);
        comps.push(c);
      }
    }
  }
  // Tarjan emits components in reverse topological order: successors come first.
  const endingNames = new Set(endings.map((e) => e.label.name));
  const reach: Set<string>[] = [];
  comps.forEach((c, ci) => {
    const s = new Set<string>();
    for (const n of c) {
      if (endingNames.has(n)) s.add(n);
      for (const m of out.get(n)!) {
        const cm = comp.get(m)!;
        if (cm !== ci) for (const x of reach[cm]) s.add(x);
      }
    }
    reach[ci] = s;
  });
  return new Map(names.map((n) => [n, reach[comp.get(n)!]]));
}

export interface GuideOption {
  item: ChoiceItem;
  /** Endings only this option can lead to. */
  endings: string[];
}

export interface GuideMenu {
  menu: MenuInfo;
  /** Fewest decisions needed to reach the menu's label (null when unreachable). */
  depth: number | null;
  options: GuideOption[];
}

/** Every menu in story order, with the endings each option exclusively leads to. */
export function choiceGuide(index: AnalyzerIndex, endings: Ending[], tree = routeTree(index)): GuideMenu[] {
  const reach = endingsReachable(index, endings);
  const order = new Map<string, number>();
  [...tree.dist.entries()].sort((a, b) => a[1] - b[1]).forEach(([n], i) => order.set(n, i));
  const continuation = (m: MenuInfo) => (m.label ? index.edges.filter((e) => e.from === m.label && !e.conditional && !e.dynamic && e.kind !== "call").map((e) => e.to) : []);
  const guide = index.menus.map((menu) => {
    const cont = continuation(menu);
    const sets = menu.items.map((it) => {
      const s = new Set<string>();
      for (const t of it.targets.length ? it.targets : cont) for (const x of reach.get(t) ?? []) s.add(x);
      return s;
    });
    return {
      menu,
      depth: menu.label ? (tree.dist.get(menu.label) ?? null) : null,
      options: menu.items.map((item, i) => ({ item, endings: [...sets[i]].filter((x) => sets.every((o, j) => j === i || !o.has(x))) })),
    };
  });
  const key = (g: GuideMenu) => (g.menu.label && order.has(g.menu.label) ? order.get(g.menu.label)! : Infinity);
  return guide.sort((a, b) => key(a) - key(b) || a.menu.loc.file.localeCompare(b.menu.loc.file) || a.menu.loc.line - b.menu.loc.line);
}
