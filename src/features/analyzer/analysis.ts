import type { AnalyzerIndex, ChoiceItem, MenuInfo, VariableCategory, VariableInfo, VariableTag } from "./model";

/**
 * Derived facts computed after the raw index is built: reachability, label ranking,
 * character portraits, choice impact (how branches diverge and rejoin) and variable
 * categories / numeric requirements.
 */
export function analyzeIndex(index: AnalyzerIndex): void {
  const graph = labelGraph(index);
  markReachable(index, graph);
  rankLabels(index);
  characterPortraits(index);
  analyzeChoices(index, graph);
  analyzeVariables(index);
  index.diagnostics.scenesWithVisuals = index.scenes.filter((s) => s.background || s.events.some((e) => e.type === "show")).length;
  index.diagnostics.unreachableLabels = index.labels.filter((l) => !l.reachable).length;
}

type Graph = Map<string, string[]>;

function labelGraph(index: AnalyzerIndex): Graph {
  const g: Graph = new Map(index.labels.map((l) => [l.name, []]));
  for (const e of index.edges) {
    if (e.dynamic || !g.has(e.from)) continue;
    const out = g.get(e.from)!;
    if (!out.includes(e.to)) out.push(e.to);
  }
  return g;
}

/** Breadth-first order of labels reachable from `starts` (inclusive), optionally not expanding `stop`. */
function bfs(graph: Graph, starts: string[], stop?: Set<string>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = [...starts];
  while (queue.length) {
    const n = queue.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    order.push(n);
    if (stop?.has(n)) continue;
    for (const m of graph.get(n) ?? []) if (!seen.has(m)) queue.push(m);
  }
  return order;
}

function markReachable(index: AnalyzerIndex, graph: Graph) {
  const entries = index.labels.filter((l) => l.entry).map((l) => l.name);
  const reach = new Set(bfs(graph, entries));
  for (const l of index.labels) l.reachable = reach.has(l.name);
}

function rankLabels(index: AnalyzerIndex) {
  for (const l of index.labels) {
    l.score = l.words + 40 * l.menus + 15 * Math.min(l.visuals, 10) + (l.background ? 20 : 0) - (l.reachable ? 0 : 30);
  }
}

const FACE_WORDS = /(^|[\s_/-])(face|faces|portrait|avatar|icon|head|bust|side|profile|mugshot)([\s_/.-]|\d|$)/i;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * Pick a picture for each character, best first: a side image (Ren'Py's face portraits),
 * an image tagged with the character's image / variable / name, an image whose name starts
 * with the character's name (e.g. `abigail_dia17_conversa36`), or a file in a folder named
 * after them. Names that look like faces/portraits and frequently shown images win ties.
 */
export function characterPortraits(index: AnalyzerIndex): void {
  const total = index.characters.reduce((n, c) => n + c.lines, 0) || 1;
  const candidates = index.images.filter((i) => i.kind !== "movie" && i.kind !== "solid");
  for (const c of index.characters) {
    c.share = c.lines / total;
    const exact = new Set([c.image, c.id, c.name?.toLowerCase()].filter((t): t is string => !!t && !t.includes("[")).map((t) => t.toLowerCase()));
    // Prefix / folder matching needs a reasonably specific name to avoid false positives.
    const loose = new Set(
      [c.image, c.name, c.name?.split(/\s+/)[0], c.id]
        .filter((t): t is string => !!t && !t.includes("[") && t !== "narrator")
        .map(norm)
        .filter((t) => t.length >= 3),
    );
    let best: { name: string; score: number } | null = null;
    for (const img of candidates) {
      const first = norm(img.name.split(/[\s_-]/)[0] ?? "");
      const folders = (img.file ?? "").toLowerCase().split("/").slice(0, -1).map(norm);
      let score = 0;
      if (img.tag === "side" && exact.has((img.attributes[0] ?? "").toLowerCase())) score = 1000;
      else if (img.tag === "side" && loose.has(norm(img.attributes[0] ?? ""))) score = 950;
      else if (exact.has(img.tag.toLowerCase())) score = 800;
      else if (loose.has(norm(img.tag)) || loose.has(first)) score = 500;
      else if (folders.some((f) => loose.has(f))) score = 400;
      if (!score) continue;
      if (FACE_WORDS.test(img.name) || FACE_WORDS.test(img.file ?? "")) score += 150;
      if (img.file || img.kind === "layered" || img.kind === "composite" || img.kind === "atl") score += 50;
      score += Math.min(img.uses, 50) * 2 - img.attributes.length;
      if (!best || score > best.score) best = { name: img.name, score };
    }
    c.portrait = best?.name ?? null;
  }
}

function analyzeChoices(index: AnalyzerIndex, graph: Graph) {
  const labels = new Map(index.labels.map((l) => [l.name, l]));
  const writesByLabel = new Map<string, Set<string>>();
  for (const v of index.variables) {
    for (const r of v.refs) {
      if (r.kind !== "write" || !r.label) continue;
      (writesByLabel.get(r.label) ?? writesByLabel.set(r.label, new Set()).get(r.label)!).add(v.name);
    }
  }
  // Where execution continues after a menu when an option doesn't jump away: the
  // unconditional flow out of the menu's own label.
  const continuationOf = (m: MenuInfo) =>
    m.label ? index.edges.filter((e) => e.from === m.label && !e.conditional && !e.dynamic && e.kind !== "call").map((e) => e.to) : [];

  const called = new Set(index.edges.filter((e) => e.kind === "call").map((e) => e.to));
  const imagesByLabel = new Map<string, string[]>();
  for (const u of index.imageUses) {
    if (u.statement === "hide" || !u.label) continue;
    const list = imagesByLabel.get(u.label) ?? imagesByLabel.set(u.label, []).get(u.label)!;
    if (!list.includes(u.image)) list.push(u.image);
  }
  for (const menu of index.menus) {
    const cont = continuationOf(menu);
    const starts = menu.items.map((it) => (it.targets.length ? it.targets : cont));
    const reach = starts.map((s) => new Set(bfs(graph, s)));
    menu.items.forEach((item, i) => {
      const others = new Set<string>();
      reach.forEach((r, j) => j !== i && r.forEach((x) => others.add(x)));
      // The first label (in reading order) this option shares with another option.
      const order = bfs(graph, starts[i]);
      item.rejoin = order.find((l) => others.has(l)) ?? null;
      const unique = bfs(graph, starts[i], others).filter((l) => !others.has(l));
      item.uniqueLabels = unique;
      item.uniqueLines = item.lines + unique.reduce((n, l) => n + (labels.get(l)?.dialogue ?? 0), 0);
      item.uniqueWords = item.words + unique.reduce((n, l) => n + (labels.get(l)?.words ?? 0), 0);
      for (const l of unique) for (const w of writesByLabel.get(l) ?? []) if (!item.writes.includes(w)) item.writes.push(w);
      for (const l of unique) for (const img of imagesByLabel.get(l) ?? []) if (!item.visuals.includes(img)) item.visuals.push(img);
      item.outcome = item.uniqueLines === 0 && item.targets.every((t) => others.has(t)) ? "shared" : item.rejoin ? "rejoins" : "distinct";
      if (!item.targets.length && item.lines === 0) item.outcome = "shared";
      // A label that returns is an ending only if nothing calls it (called labels return to the caller).
      const endings = unique.filter((l) => labels.get(l)?.ending === "return" && !called.has(l)).length;
      item.major = item.outcome === "distinct" ? item.uniqueLines > 0 : item.uniqueLines >= 20 || endings > 0;
    });
    const words = menu.items.map((it) => it.uniqueWords);
    menu.impact =
      words.reduce((a, b) => a + b, 0) -
      Math.min(...words) +
      25 * menu.items.filter((it) => it.major).length +
      10 * menu.items.reduce((n, it) => n + it.writes.length, 0) +
      5 * menu.items.filter((it) => it.condition).length;
  }
  // "Meaningful": at least one option has content or state changes of its own.
  for (const m of index.menus) m.important = m.items.some((it: ChoiceItem) => it.uniqueLines > 0 || it.writes.length > 0 || it.major);
}

const CATEGORY_PATTERNS: [VariableCategory, RegExp][] = [
  ["currency", /money|gold|cash|coin|credit|dollar|gem|yen|buck|fund|wallet|cents|silver|euro/i],
  ["relationship", /affection|love|trust|relation|friend|lust|corrupt|romance|attract|approv|bond|_aff\b|^aff|like|intimacy|desire|obedien|submis|lewd|arousal/i],
  ["resource", /energy|stamina|health|\bhp\b|mana|food|ammo|fuel|item|inventory|potion|key|supplies|materials|wood|stone/i],
  ["progress", /day|chapter|quest|progress|stage|level|xp\b|exp\b|week|month|time|count|route|episode|act\b|step|phase|ending/i],
];

function parseNumber(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function analyzeVariables(index: AnalyzerIndex) {
  const characterIds = new Set(index.characters.filter((c) => c.defined).flatMap((c) => [c.id.toLowerCase(), (c.name ?? "").toLowerCase()]).filter((s) => s.length > 1));
  for (const v of index.variables) {
    const esc = v.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const f = v.facts;
    let sum = 0;
    const assigned: number[] = [];
    const bools = new Set<string>();
    const consider = (code: string) => {
      for (const m of code.matchAll(new RegExp(`(?<![\\w.])${esc}\\s*(>=|>|<=|<|==|!=)\\s*(-?\\d+(?:\\.\\d+)?)`, "g"))) {
        const n = parseNumber(m[2])!;
        if (m[1] === ">=" || m[1] === ">") f.needsAtLeast = Math.max(f.needsAtLeast ?? -Infinity, m[1] === ">" ? n + 1 : n);
        if (m[1] === "<=" || m[1] === "<") f.checkedAtMost = Math.min(f.checkedAtMost ?? Infinity, n);
        if (m[1] === "==" && n > 0) f.needsAtLeast = Math.max(f.needsAtLeast ?? -Infinity, n);
      }
      for (const m of code.matchAll(new RegExp(`(-?\\d+(?:\\.\\d+)?)\\s*(<=|<|>=|>)\\s*${esc}(?![\\w.])`, "g"))) {
        const n = parseNumber(m[1])!;
        if (m[2] === "<=" || m[2] === "<") f.needsAtLeast = Math.max(f.needsAtLeast ?? -Infinity, m[2] === "<" ? n + 1 : n);
        else f.checkedAtMost = Math.min(f.checkedAtMost ?? Infinity, n);
      }
    };
    for (const r of v.refs) {
      if (r.kind === "condition" || r.kind === "read") consider(r.code);
      if (r.kind === "write" || r.kind === "declare") {
        const body = r.kind === "declare" ? r.code.replace(/^\w+\s+/, "") : r.code;
        const m = new RegExp(`^${esc}\\s*(\\+=|-=|=)\\s*(.+)$`).exec(body.trim());
        if (!m) continue;
        const rhs = m[2].trim();
        if (/^(True|False)$/.test(rhs)) bools.add(rhs);
        const n = parseNumber(rhs);
        if (n === null) continue;
        if (m[1] === "+=") {
          if (n >= 0) {
            f.increments++;
            f.maxIncrement = Math.max(f.maxIncrement ?? 0, n);
            sum += n;
          } else f.decrements++;
        } else if (m[1] === "-=") {
          if (n >= 0) f.decrements++;
          else f.increments++;
        } else assigned.push(n);
      }
    }
    if (f.needsAtLeast === -Infinity) f.needsAtLeast = null;
    if (f.checkedAtMost === Infinity) f.checkedAtMost = null;
    const base = assigned.length ? Math.max(...assigned) : null;
    f.assignedMax = base === null && sum === 0 ? null : Math.max(base ?? 0, (parseNumber(v.initial ?? "") ?? 0) + sum);
    f.booleans = bools.size > 0 || /^(True|False)$/.test((v.initial ?? "").trim());

    // Category from the name, the values it holds, and whether it's named after a character.
    let category: VariableCategory = f.booleans ? "flag" : "other";
    if (!f.booleans) {
      for (const [c, re] of CATEGORY_PATTERNS) {
        if (re.test(v.name)) {
          category = c;
          break;
        }
      }
      const lowered = v.name.toLowerCase();
      if (category === "other" && /points?|score|pts/.test(lowered) && [...characterIds].some((id) => lowered.includes(id))) category = "relationship";
      if (category === "other" && /points?|score|pts/.test(lowered)) category = "progress";
    }
    v.category = category;

    const tags: VariableTag[] = [];
    const conditions = v.refs.filter((r) => r.kind === "condition").length;
    const writes = v.refs.filter((r) => r.kind === "write").length;
    if (f.needsAtLeast !== null || f.checkedAtMost !== null) tags.push("numeric-requirement");
    if (f.needsAtLeast !== null) tags.push("clear-target");
    if (f.increments >= 2) tags.push("repeatedly-increased");
    if (category === "flag" && conditions > 0) tags.push("state-flag");
    if (["currency", "relationship", "resource"].includes(category) && (f.needsAtLeast !== null || f.increments > 0)) tags.push("worth-changing");
    if (f.needsAtLeast !== null && f.maxIncrement && f.needsAtLeast / f.maxIncrement >= Math.max(5, f.increments + 2)) tags.push("grind");
    v.tags = tags;

    v.command = suggestCommand(v);
    v.score =
      3 * (f.needsAtLeast !== null ? 1 : 0) +
      2 * Math.min(f.increments, 5) +
      Math.min(conditions, 10) +
      Math.min(writes, 5) / 2 +
      (category === "currency" || category === "relationship" ? 4 : category === "resource" || category === "flag" ? 2 : 0) +
      (tags.includes("grind") ? 3 : 0) -
      (v.declared === "define" ? 5 : 0);
  }
}

function suggestCommand(v: VariableInfo): string | null {
  if (v.declared === "define") return null; // constants: changing them in the console doesn't persist
  const f = v.facts;
  if (v.category === "flag") return `${v.name} = True`;
  const numeric = parseNumber((v.initial ?? "").trim()) !== null || f.needsAtLeast !== null || f.checkedAtMost !== null || f.increments > 0;
  if (numeric) {
    let value = Math.max(f.needsAtLeast ?? 0, f.assignedMax ?? 0);
    if (v.category === "currency") value = Math.max(value * 10, 99999);
    else if (value === 0) value = 100;
    if (f.checkedAtMost !== null && f.needsAtLeast === null) value = f.checkedAtMost;
    return `${v.name} = ${Number.isInteger(value) ? value : value.toFixed(2)}`;
  }
  return null;
}
