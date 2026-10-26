import type { VarRef, VariableInfo } from "./model";

/**
 * How a variable is tested: `affection >= 5`, `not met_lucy`, `"key" in inventory`,
 * `len(items) > 2`… One entry per place the variable appears in a condition, or in any
 * other code that compares it (Python, screen actions).
 */

export type CompareOp = ">=" | ">" | "<=" | "<" | "==" | "!=" | "is" | "is not" | "in" | "not in" | "contains" | "not contains" | "true" | "false" | "expr";

export interface Comparison {
  ref: VarRef;
  op: CompareOp;
  /** The other side of the comparison, as written. */
  value: string | null;
  /** What is compared when it isn't the bare variable, e.g. `len(inventory)` or `stats["str"]`. */
  subject: string;
}

const OPERAND = String.raw`-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_][\w.]*(?:\([^()]*\)|\[[^\]]*\])?|\[[^\]]*\]|\([^()]*\)|\{[^}]*\}`;
const OP = String.raw`>=|<=|==|!=|>|<|\bis\s+not\b|\bis\b|\bnot\s+in\b|\bin\b`;
const RIGHT = new RegExp(String.raw`^\s*(${OP})\s*(${OPERAND})`);
const LEFT = new RegExp(String.raw`(${OPERAND})\s*(${OP})\s*$`);
const SUFFIX = /^(?:\.\w+|\([^()]*\)|\[[^\]]*\])*/;
const FLIP: Record<string, CompareOp> = { ">": "<", "<": ">", ">=": "<=", "<=": ">=", "==": "==", "!=": "!=", is: "is", "is not": "is not", in: "contains", "not in": "not contains" };

const norm = (op: string) => op.replace(/\s+/g, " ") as CompareOp;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every comparison involving `name` in `code`. */
export function parseComparisons(name: string, code: string, isCondition: boolean): Omit<Comparison, "ref">[] {
  const out: Omit<Comparison, "ref">[] = [];
  // Ignore string contents when looking for the variable.
  const masked = code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, (m) => m[0] + " ".repeat(m.length - 2) + m[0]);
  for (const m of masked.matchAll(new RegExp(`(?<![\\w.])${escape(name)}(?![\\w])`, "g"))) {
    let start = m.index!;
    let end = start + name.length;
    end += SUFFIX.exec(masked.slice(end))![0].length;
    // One wrapping call, e.g. len(inventory).
    const call = /([A-Za-z_][\w.]*)\(\s*$/.exec(masked.slice(0, start));
    if (call && /^\s*\)/.test(masked.slice(end))) {
      start = call.index;
      end += /^\s*\)/.exec(masked.slice(end))![0].length;
    }
    const subject = code.slice(start, end).trim();
    const before = masked.slice(0, start);
    const after = masked.slice(end);
    // `money + bonus >= 10` compares the sum, not either variable.
    const arithmetic = /[-+*/%]\s*$/.test(before) || /^\s*[-+*/%]/.test(after);
    const right = arithmetic ? null : RIGHT.exec(code.slice(end));
    // Both sides for chains like `1 <= x < 4`.
    const left = arithmetic ? null : LEFT.exec(code.slice(0, start));
    if (left) out.push({ op: FLIP[norm(left[2])], value: left[1], subject });
    if (right) out.push({ op: norm(right[1]), value: right[2], subject });
    if (left || right) continue;
    if (!isCondition) continue;
    const standalone = /(?:^|[(,]|\b(?:and|or|not|if))\s*$/.test(before) && /^\s*(?:$|[),:]|\b(?:and|or|if|else)\b)/.test(after);
    if (standalone) out.push({ op: /\bnot\s*$/.test(before) ? "false" : "true", value: null, subject });
    else out.push({ op: "expr", value: null, subject });
  }
  // `a < x < b` and repeated tests yield duplicates; keep one of each.
  return out.filter((c, i) => out.findIndex((d) => d.op === c.op && d.value === c.value && d.subject === c.subject) === i);
}

export function comparisons(v: VariableInfo): Comparison[] {
  const out: Comparison[] = [];
  for (const ref of v.refs) {
    if (ref.kind !== "condition" && ref.kind !== "read") continue;
    for (const c of parseComparisons(v.name, ref.code, ref.kind === "condition")) out.push({ ...c, ref });
  }
  return out;
}

const SYMBOL: Partial<Record<CompareOp, string>> = { ">=": "≥", "<=": "≤", "!=": "≠", "==": "=" };

/** Short form for a chip, e.g. "≥ 5", "is set", "contains 'key'". */
export function compareText(c: Pick<Comparison, "op" | "value">): string {
  switch (c.op) {
    case "true":
      return "is true / set";
    case "false":
      return "is false / unset";
    case "expr":
      return "in an expression";
    default:
      return `${SYMBOL[c.op] ?? c.op} ${c.value}`;
  }
}

export interface ComparisonGroup {
  key: string;
  op: CompareOp;
  value: string | null;
  subject: string | null;
  items: Comparison[];
}

const ORDER: CompareOp[] = [">=", ">", "==", "is", "in", "contains", "true", "<=", "<", "!=", "is not", "not in", "not contains", "false", "expr"];

/** Comparisons grouped by test (operator, value and subject), numeric values in order. */
export function groupComparisons(name: string, list: Comparison[]): ComparisonGroup[] {
  const groups = new Map<string, ComparisonGroup>();
  for (const c of list) {
    const subject = c.subject === name ? null : c.subject;
    const key = `${subject ?? ""}\u0000${c.op}\u0000${c.value ?? ""}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, op: c.op, value: c.value, subject, items: [] }));
    g.items.push(c);
  }
  const num = (g: ComparisonGroup) => (g.value !== null && Number.isFinite(Number(g.value)) ? Number(g.value) : Infinity);
  return [...groups.values()].sort(
    (a, b) => (a.subject ?? "").localeCompare(b.subject ?? "") || ORDER.indexOf(a.op) - ORDER.indexOf(b.op) || num(a) - num(b) || (a.value ?? "").localeCompare(b.value ?? ""),
  );
}
