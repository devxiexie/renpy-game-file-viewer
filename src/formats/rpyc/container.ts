import { unzlibSync } from "fflate";
import { startsWithBytes } from "../../core/binary/text";
import { unpickle } from "../pickle/unpickler";
import { isTuple } from "../pickle/types";

export const RPYC2_HEADER = "RENPY RPC2";

export interface RpycSlot {
  slot: number;
  start: number;
  length: number;
}

export interface RpycFile {
  format: "rpc2" | "legacy";
  slots: RpycSlot[];
  /** Metadata dict stored next to the AST (version, key, ...). */
  meta: Map<unknown, unknown> | null;
  /** Top-level statement list. */
  statements: unknown[];
}

export class RpycError extends Error {}

export function readRpycSlots(data: Uint8Array): RpycSlot[] {
  if (!startsWithBytes(data, RPYC2_HEADER)) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const slots: RpycSlot[] = [];
  let pos = RPYC2_HEADER.length;
  while (pos + 12 <= data.length) {
    const slot = view.getUint32(pos, true);
    const start = view.getUint32(pos + 4, true);
    const length = view.getUint32(pos + 8, true);
    pos += 12;
    if (slot === 0) break;
    slots.push({ slot, start, length });
  }
  return slots;
}

/** Return the decompressed pickle stored in `preferredSlot` (falls back to any slot). */
export function readRpycPickle(data: Uint8Array, preferredSlot = 1): { format: RpycFile["format"]; slots: RpycSlot[]; pickle: Uint8Array } {
  const slots = readRpycSlots(data);
  if (slots.length === 0) {
    try {
      return { format: "legacy", slots, pickle: unzlibSync(data) };
    } catch {
      throw new RpycError("Not a Ren'Py compiled script (unknown header, not zlib data)");
    }
  }
  const ordered = [...slots].sort((a, b) => (a.slot === preferredSlot ? -1 : b.slot === preferredSlot ? 1 : a.slot - b.slot));
  let lastError: unknown;
  for (const s of ordered) {
    if (s.start + s.length > data.length) continue;
    try {
      return { format: "rpc2", slots, pickle: unzlibSync(data.subarray(s.start, s.start + s.length)) };
    } catch (e) {
      lastError = e;
    }
  }
  throw new RpycError(`Could not decompress any rpyc slot: ${String(lastError)}`);
}

export function readRpyc(data: Uint8Array): RpycFile {
  const { format, slots, pickle } = readRpycPickle(data, 1);
  const root = unpickle(pickle);
  // Root is (data, stmts) for modern files, or a bare list for very old ones.
  if (Array.isArray(root) && root.length === 2 && isTuple(root) && Array.isArray(root[1])) {
    return { format, slots, meta: root[0] instanceof Map ? root[0] : null, statements: root[1] };
  }
  if (Array.isArray(root)) return { format, slots, meta: null, statements: root };
  throw new RpycError("Unexpected rpyc payload structure");
}
