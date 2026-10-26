import type { Writer } from "./writer";
import { asArray, asMap, attr, className, lineOf, str } from "./util";

/** Decompile the statements of an ATL RawBlock into `w` (at the current indent). */
export function writeAtlBlock(w: Writer, block: unknown): void {
  const statements = asArray(attr(block, "statements", []));
  if (attr(block, "animation", false)) w.write("animation");
  if (statements.length === 0 && !attr(block, "animation", false)) {
    w.write("pass");
    return;
  }
  for (const st of statements) writeAtlStatement(w, st);
}

function header(w: Writer, node: unknown, text: string): void {
  w.advanceTo(lineOf(node));
  w.write(text);
}

/** Nested RawBlocks are located at their first statement; the `xxx:` line sits just above. */
function blockHeader(w: Writer, block: unknown, text: string): void {
  const line = lineOf(block);
  if (line) w.advanceTo(line - 1);
  w.write(text);
}

function writeAtlStatement(w: Writer, st: unknown): void {
  switch (className(st)) {
    case "RawMultipurpose":
      header(w, st, multipurposeLine(st));
      break;
    case "RawBlock":
      blockHeader(w, st, "block:");
      w.indent(() => writeAtlBlock(w, st));
      break;
    case "RawChild":
      for (const child of asArray(attr(st, "children", []))) {
        blockHeader(w, child, "contains:");
        w.indent(() => writeAtlBlock(w, child));
      }
      break;
    case "RawChoice":
      for (const pair of asArray(attr(st, "choices", []))) {
        const [chance, block] = asArray(pair);
        const c = str(chance);
        blockHeader(w, block, c && c !== "1.0" ? `choice ${c}:` : "choice:");
        w.indent(() => writeAtlBlock(w, block));
      }
      break;
    case "RawContainsExpr":
      header(w, st, `contains ${str(attr(st, "expression"))}`);
      break;
    case "RawEvent":
      header(w, st, `event ${str(attr(st, "name"))}`);
      break;
    case "RawFunction":
      header(w, st, `function ${str(attr(st, "expr"))}`);
      break;
    case "RawOn": {
      // Group events that share the same block object: "on show, replace:".
      const groups = new Map<unknown, string[]>();
      for (const [name, block] of asMap(attr(st, "handlers"))) {
        const g = groups.get(block) ?? [];
        g.push(str(name));
        groups.set(block, g);
      }
      const ordered = [...groups].sort((a, b) => lineOf(a[0]) - lineOf(b[0]));
      for (const [block, names] of ordered) {
        blockHeader(w, block, `on ${names.join(", ")}:`);
        w.indent(() => writeAtlBlock(w, block));
      }
      break;
    }
    case "RawParallel":
      for (const block of asArray(attr(st, "blocks", []))) {
        blockHeader(w, block, "parallel:");
        w.indent(() => writeAtlBlock(w, block));
      }
      break;
    case "RawRepeat": {
      const n = attr(st, "repeats", null);
      header(w, st, n === null || n === undefined ? "repeat" : `repeat ${str(n)}`);
      break;
    }
    case "RawTime":
      header(w, st, `time ${str(attr(st, "time"))}`);
      break;
    default:
      header(w, st, `# Unsupported ATL statement: ${className(st) || typeof st}`);
  }
}

function multipurposeLine(st: unknown): string {
  const words: string[] = [];
  const warper = attr<unknown>(st, "warper", null);
  const warpFunction = attr<unknown>(st, "warp_function", null);
  const duration = attr<unknown>(st, "duration", null);
  if (warpFunction) {
    words.push("warp", str(warpFunction), str(duration));
  } else if (warper) {
    words.push(str(warper), str(duration));
  } else if (duration !== null && duration !== undefined && str(duration) !== "0") {
    words.push("pause", str(duration));
  }

  const revolution = attr<unknown>(st, "revolution", null);
  if (revolution) words.push(str(revolution));

  const circles = attr<unknown>(st, "circles", "0");
  if (circles !== null && str(circles) !== "0") words.push("circles", str(circles));

  // Splines: [(name, [expr1, expr2, ...])] → "name expr1 knot expr2 ..."
  const splineNames = new Set<string>();
  for (const pair of asArray(attr(st, "splines", []))) {
    const [name, exprs] = asArray(pair);
    const list = asArray(exprs).map(str);
    splineNames.add(str(name));
    if (list.length === 0) continue;
    words.push(str(name), list[list.length - 1]);
    for (const knot of list.slice(0, -1)) words.push("knot", knot);
  }

  for (const pair of asArray(attr(st, "properties", []))) {
    const [name, value] = asArray(pair);
    if (splineNames.has(str(name))) continue;
    words.push(str(name), str(value));
  }

  for (const pair of asArray(attr(st, "expressions", []))) {
    const [expr, withExpr] = asArray(pair);
    words.push(str(expr));
    if (withExpr) words.push("with", str(withExpr));
  }

  return words.length ? words.join(" ") : "pass";
}
