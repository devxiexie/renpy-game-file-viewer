import dagre from "@dagrejs/dagre";
import type { AnalyzerIndex, EdgeKind } from "./model";

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  missing: boolean;
  entry: boolean;
  ending: string | null;
  words: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  conditional: boolean;
  count: number;
  points: { x: number; y: number }[];
}

export interface GraphOptions {
  kinds: Set<EdgeKind>;
  /** Hide labels called from many places (shared helpers like `call splash_message`). */
  collapseHelpers: boolean;
}

export const ALL_KINDS: Set<EdgeKind> = new Set(["jump", "call", "fallthrough"]);

/** Labels called from at least this many places count as shared helpers. */
const HELPER_CALLERS = 4;

export function helperLabels(index: AnalyzerIndex): Set<string> {
  const callers = new Map<string, Set<string>>();
  for (const e of index.edges) if (e.kind === "call" && !e.dynamic) (callers.get(e.to) ?? callers.set(e.to, new Set()).get(e.to)!).add(e.from);
  return new Set([...callers].filter(([, s]) => s.size >= HELPER_CALLERS).map(([k]) => k));
}

/** Labels within `depth` steps (either direction) of `focus`; everything when focus is null. */
export function neighborhood(index: AnalyzerIndex, focus: string | null, depth: number, opts: GraphOptions = { kinds: ALL_KINDS, collapseHelpers: false }): Set<string> {
  const helpers = opts.collapseHelpers ? helperLabels(index) : new Set<string>();
  const usable = index.edges.filter((e) => !e.dynamic && opts.kinds.has(e.kind) && !helpers.has(e.to) && !helpers.has(e.from));
  if (!focus) {
    const all = new Set(index.labels.map((l) => l.name).filter((n) => !helpers.has(n)));
    for (const e of usable) all.add(e.to);
    return all;
  }
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
  for (const e of usable) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  const seen = new Set([focus]);
  let frontier = [focus];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const n of frontier) for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), next.push(m));
    frontier = next;
  }
  return seen;
}

/** Layered (Sugiyama) layout of the label graph restricted to `include`. */
export function layoutGraph(index: AnalyzerIndex, include: Set<string>, opts: GraphOptions = { kinds: ALL_KINDS, collapseHelpers: false }): { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number } {
  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const labels = new Map(index.labels.map((l) => [l.name, l]));
  for (const id of include) g.setNode(id, { width: Math.min(260, Math.max(90, id.length * 8 + 30)), height: 44 });
  const edges = new Map<string, GraphEdge>();
  for (const e of index.edges) {
    if (e.dynamic || !opts.kinds.has(e.kind) || !include.has(e.from) || !include.has(e.to)) continue;
    const id = `${e.from}->${e.to}`;
    const prev = edges.get(id);
    if (prev) {
      prev.count++;
      prev.conditional &&= e.conditional;
      if (e.kind === "call") prev.kind = "call";
      continue;
    }
    edges.set(id, { id, from: e.from, to: e.to, kind: e.kind, conditional: e.conditional, count: 1, points: [] });
    if (e.from !== e.to) g.setEdge(e.from, e.to);
  }
  dagre.layout(g);
  for (const e of edges.values()) if (e.from !== e.to) e.points = (g.edge(e.from, e.to)?.points ?? []).map((p: { x: number; y: number }) => ({ x: p.x, y: p.y }));
  const nodes: GraphNode[] = [...include].map((id) => {
    const n = g.node(id);
    const l = labels.get(id);
    return { id, x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height, missing: !l, entry: !!l?.entry, ending: l?.ending ?? null, words: l?.words ?? 0 };
  });
  const gr = g.graph() as { width?: number; height?: number };
  return { nodes, edges: [...edges.values()], width: gr.width ?? 800, height: gr.height ?? 600 };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Standalone SVG of a laid-out graph (used for SVG/PNG/JPG/WebP/HTML export). */
export function graphToSvg(layout: ReturnType<typeof layoutGraph>, title: string): string {
  const { nodes, edges, width, height } = layout;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" font-family="ui-monospace, Menlo, monospace" font-size="12">`,
    `<title>${esc(title)}</title>`,
    `<defs><marker id="a" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#777"/></marker></defs>`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
  ];
  for (const e of edges) {
    if (e.points.length < 2) continue;
    const d = e.points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const dash = e.kind === "fallthrough" ? ` stroke-dasharray="4 4"` : e.conditional ? ` stroke-dasharray="8 3"` : "";
    parts.push(`<path d="${d}" fill="none" stroke="${e.kind === "call" ? "#1c7ed6" : "#777"}" stroke-width="1.4"${dash} marker-end="url(#a)"/>`);
  }
  for (const n of nodes) {
    const fill = n.entry ? "#ffe8d9" : n.ending === "return" ? "#e6fcf5" : n.missing ? "#fff5f5" : "#ffffff";
    parts.push(
      `<g data-label="${esc(n.id)}"><rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" rx="8" fill="${fill}" stroke="${n.missing ? "#c92a2a" : "#888"}"${n.missing ? ` stroke-dasharray="4 3"` : ""}/>` +
        `<text x="${n.x + n.width / 2}" y="${n.y + n.height / 2 + 4}" text-anchor="middle" fill="#222">${esc(n.id)}</text></g>`,
    );
  }
  parts.push("</svg>");
  return parts.join("\n");
}

/** Self-contained HTML page with pan / zoom around the SVG. */
export function graphToHtml(svg: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>html,body{margin:0;height:100%;background:#f4f4f4;font:13px system-ui,sans-serif}#v{width:100%;height:100%;overflow:hidden;cursor:grab}#v svg{transform-origin:0 0}#h{position:fixed;left:8px;bottom:8px;background:#fff;padding:4px 8px;border-radius:6px;box-shadow:0 1px 4px #0003}</style></head>
<body><div id="v">${svg}</div><div id="h">Drag to pan · scroll to zoom</div>
<script>const v=document.getElementById("v"),s=v.querySelector("svg");let x=0,y=0,k=1,d=null;const u=()=>s.style.transform="translate("+x+"px,"+y+"px) scale("+k+")";
v.onwheel=e=>{e.preventDefault();const f=e.deltaY<0?1.1:1/1.1;x=e.clientX-(e.clientX-x)*f;y=e.clientY-(e.clientY-y)*f;k*=f;u()};
v.onpointerdown=e=>{d=[e.clientX-x,e.clientY-y];v.setPointerCapture(e.pointerId)};v.onpointermove=e=>{if(d){x=e.clientX-d[0];y=e.clientY-d[1];u()}};v.onpointerup=()=>d=null;u();</script></body></html>`;
}
