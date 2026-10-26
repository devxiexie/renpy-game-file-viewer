import { encodeUtf8 } from "../../core/binary/text";
import { pickle } from "./pickler";
import type { LiteralType, Span } from "./unpickler";

export type ScalarValue = null | boolean | number | bigint | string;

export interface PickleEdit {
  span: Span;
  value: ScalarValue;
  /** Type to write; defaults to the original literal's type. */
  type?: LiteralType;
}

export class PatchError extends Error {}

/** Opcode bytes for a single literal (no PROTO/STOP). */
export function encodeLiteral(value: ScalarValue, type: LiteralType): Uint8Array {
  const body = (v: unknown) => {
    const full = pickle(v);
    return full.subarray(2, full.length - 1); // strip PROTO 2 … STOP
  };
  switch (type) {
    case "none":
      return Uint8Array.of(0x4e);
    case "bool":
      if (typeof value !== "boolean") throw new PatchError("Expected true or false");
      return Uint8Array.of(value ? 0x88 : 0x89);
    case "int": {
      if (typeof value === "bigint") return body(value);
      if (typeof value !== "number" || !Number.isInteger(value)) throw new PatchError("Expected a whole number");
      return body(value);
    }
    case "float": {
      if (typeof value !== "number" || Number.isNaN(value)) throw new PatchError("Expected a number");
      const out = new Uint8Array(9);
      out[0] = 0x47; // BINFLOAT
      new DataView(out.buffer).setFloat64(1, value, false);
      return out;
    }
    case "str":
      if (typeof value !== "string") throw new PatchError("Expected text");
      return body(value);
    case "py2str":
      if (typeof value !== "string") throw new PatchError("Expected text");
      return body(encodeUtf8(value)); // SHORT_BINSTRING / BINSTRING
    case "bytes":
      throw new PatchError("Byte strings can't be edited");
  }
}

/**
 * Replace literal opcodes in a pickle stream. FRAME opcodes (protocol 4+) are removed,
 * since framing is optional and their lengths would no longer match after edits.
 */
export function patchPickle(data: Uint8Array, edits: PickleEdit[], frames: number[] = []): Uint8Array {
  type Cut = { start: number; end: number; bytes: Uint8Array };
  const cuts: Cut[] = [
    ...frames.map((f) => ({ start: f, end: f + 9, bytes: new Uint8Array(0) })),
    ...edits.map((e) => ({ start: e.span.start, end: e.span.end, bytes: encodeLiteral(e.value, e.type ?? e.span.type) })),
  ].sort((a, b) => a.start - b.start);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i].start < cuts[i - 1].end) throw new PatchError("Overlapping edits");
  }
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const c of cuts) {
    parts.push(data.subarray(pos, c.start), c.bytes);
    pos = c.end;
  }
  parts.push(data.subarray(pos));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
