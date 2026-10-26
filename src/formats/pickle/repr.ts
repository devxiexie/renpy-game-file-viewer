import { PyFloat, PyGlobal, PyObject, isTuple, pyClassOf } from "./types";

/** Debug representation of an unpickled object graph (Python-like, depth limited). */
export function pyRepr(v: unknown, depth = 4, seen = new Set<unknown>()): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (v instanceof PyFloat) return String(v.value);
  if (v instanceof Uint8Array) return `b<${v.length} bytes>`;
  if (v instanceof PyGlobal) return `<${v.fullName}>`;
  if (seen.has(v)) return "<cycle>";
  if (depth <= 0) return "…";
  seen.add(v);
  try {
    const r = (x: unknown) => pyRepr(x, depth - 1, seen);
    if (Array.isArray(v)) {
      const cls = pyClassOf(v);
      const body = v.map(r).join(", ");
      return isTuple(v) ? `(${body}${v.length === 1 ? "," : ""})` : `${cls ? cls + "" : ""}[${body}]`;
    }
    if (v instanceof Map) return `{${[...v].map(([k, x]) => `${r(k)}: ${r(x)}`).join(", ")}}`;
    if (v instanceof Set) return `{${[...v].map(r).join(", ")}}`;
    if (v instanceof PyObject) {
      const parts: string[] = [];
      if (v.args.length) parts.push(`args=${r(v.args)}`);
      for (const [k, x] of Object.entries(v.attrs)) parts.push(`${k}=${r(x)}`);
      if (v.state !== undefined) parts.push(`state=${r(v.state)}`);
      if (v.items) parts.push(`items=${r(v.items)}`);
      return `${v.className}(${parts.join(", ")})`;
    }
    return String(v);
  } finally {
    seen.delete(v);
  }
}
