import { PyGlobal, PyObject, isTuple } from "../../pickle/types";

/** Read attribute `name` from a pickled object, with a class-default fallback. */
export function attr<T = unknown>(node: unknown, name: string, fallback?: T): T {
  if (node instanceof PyObject && name in node.attrs) {
    const v = node.attrs[name];
    return (v === undefined ? fallback : v) as T;
  }
  return fallback as T;
}

export function has(node: unknown, name: string): boolean {
  return node instanceof PyObject && name in node.attrs;
}

export function className(node: unknown): string {
  return node instanceof PyObject ? node.className : "";
}

export function isNode(node: unknown, ...names: string[]): node is PyObject {
  return node instanceof PyObject && names.includes(node.className);
}

/**
 * Convert a pickled Python string-ish value (str, PyExpr, PyCode source, bytes) to text.
 * PyExpr is a str subclass reconstructed via NEWOBJ(cls, (text, filename, line, ...)).
 */
export function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v instanceof Uint8Array) return new TextDecoder().decode(v);
  if (v instanceof PyObject) {
    if (v.cls.endsWith("PyCode")) return pyCodeSource(v);
    if (v.args.length > 0 && typeof v.args[0] === "string") return v.args[0];
    if (v.args.length > 0) return str(v.args[0]);
  }
  if (v instanceof PyGlobal) return v.fullName;
  return String(v);
}

export function optStr(v: unknown): string | null {
  return v === null || v === undefined ? null : str(v);
}

/** PyCode is pickled with a tuple state: (version, source, location, mode, ...). */
export function pyCodeSource(code: unknown): string {
  if (!(code instanceof PyObject)) return str(code);
  const st = code.state;
  if (Array.isArray(st) && st.length >= 2) return str(st[1]);
  return str(code.attrs.source);
}

export function pyCodeLocation(code: unknown): [string, number] | null {
  if (!(code instanceof PyObject)) return null;
  const st = code.state;
  const loc = Array.isArray(st) ? st[2] : code.attrs.location;
  if (Array.isArray(loc) && loc.length >= 2 && typeof loc[1] === "number") return [str(loc[0]), loc[1]];
  return null;
}

export function pyCodeMode(code: unknown): string {
  if (!(code instanceof PyObject)) return "exec";
  const st = code.state;
  if (Array.isArray(st) && st.length >= 4) return str(st[3]);
  return str(code.attrs.mode) || "exec";
}

export function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v instanceof Set) return [...v];
  if (v instanceof PyObject && v.items) return v.items;
  return [];
}

export function asMap(v: unknown): Map<unknown, unknown> {
  if (v instanceof Map) return v;
  if (v instanceof PyObject && v.map) return v.map;
  return new Map();
}

export function tupleOrList(v: unknown): unknown[] {
  return Array.isArray(v) || isTuple(v) ? (v as unknown[]) : [];
}

/** Line number of an AST node (renpy.ast.Node, SL2 / ATL nodes with `location` / `loc`). */
export function lineOf(node: unknown): number {
  if (!(node instanceof PyObject)) return 0;
  const ln = node.attrs.linenumber;
  if (typeof ln === "number") return ln;
  const loc = node.attrs.location ?? node.attrs.loc;
  if (Array.isArray(loc) && typeof loc[1] === "number") return loc[1];
  return 0;
}

/** Escape a string for a Ren'Py double-quoted string literal. */
export function quoteString(s: string): string {
  let out = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  // Ren'Py collapses runs of whitespace in string literals, so extra spaces must be escaped.
  out = out.replace(/ {2,}/g, (m) => " " + "\\ ".repeat(m.length - 1));
  return `"${out}"`;
}

/** Python repr-like string for literal values that appear outside expressions. */
export function pyLiteral(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "string") return quoteString(v);
  return str(v);
}
