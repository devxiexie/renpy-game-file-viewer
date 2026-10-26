import { unzipSync, unzlibSync, zipSync, zlibSync, type Zippable } from "fflate";
import { decodeUtf8 } from "../../core/binary/text";
import { patchPickle, type PickleEdit } from "../pickle/patch";
import { PyObject } from "../pickle/types";
import { SpanTracker, unpickle } from "../pickle/unpickler";

export interface SaveMeta {
  saveName?: string;
  renpyVersion?: string;
  gameVersion?: string;
  runtimeSeconds?: number;
  created?: Date;
  json?: Record<string, unknown>;
}

export interface LoadedSave {
  kind: "save" | "persistent";
  /** Every entry of the save zip (log, screenshot.png, json, ...); empty for persistent. */
  entries: Record<string, Uint8Array>;
  /** Decompressed pickle stream (save log or persistent data). */
  pickle: Uint8Array;
  tracker: SpanTracker;
  /** Variables shown in the editor: store roots for saves, attributes for persistent. */
  root: Map<string, unknown>;
  /** Object whose spans hold the root values (the roots dict or the Persistent object). */
  rootContainer: object;
  meta: SaveMeta;
  screenshot: Uint8Array | null;
  signed: boolean;
  /**
   * Rollback entries Ren'Py replays when loading (from the last checkpoint on). Their
   * `stores` dicts hold the values a load actually restores for variables changed since.
   */
  rollbackStores: Map<string, Map<unknown, unknown>>[];
}

export class SaveError extends Error {}

function startsWithZip(b: Uint8Array): boolean {
  return b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

/** Parse a Ren'Py `.save` file (a ZIP) or a `persistent` file (zlib-compressed pickle). */
export function loadSave(data: Uint8Array): LoadedSave {
  if (startsWithZip(data)) return loadSaveZip(data);
  let raw: Uint8Array;
  try {
    raw = unzlibSync(data);
  } catch {
    throw new SaveError("Not a Ren'Py save or persistent file");
  }
  const tracker = new SpanTracker();
  const value = unpickle(raw, { track: tracker, preserveFloats: false });
  if (!(value instanceof PyObject)) throw new SaveError("Persistent data has an unexpected structure");
  const root = new Map<string, unknown>(Object.entries(value.attrs));
  return { kind: "persistent", entries: {}, pickle: raw, tracker, root, rootContainer: value, meta: {}, screenshot: null, signed: false, rollbackStores: [] };
}

function loadSaveZip(data: Uint8Array): LoadedSave {
  const entries = unzipSync(data);
  const log = entries["log"];
  if (!log) throw new SaveError("This ZIP has no Ren'Py save log");
  const tracker = new SpanTracker();
  const value = unpickle(log, { track: tracker });
  if (!Array.isArray(value) || !(value[0] instanceof Map)) throw new SaveError("Save log has an unexpected structure");
  const rootsMap = value[0] as Map<unknown, unknown>;
  const root = new Map<string, unknown>();
  for (const [k, v] of rootsMap) if (typeof k === "string") root.set(k, v);

  const rollbackStores = activeRollbackStores(value[1]);
  const meta: SaveMeta = {};
  if (entries["json"]) {
    try {
      const json = JSON.parse(decodeUtf8(entries["json"])) as Record<string, unknown>;
      meta.json = json;
      meta.saveName = typeof json._save_name === "string" ? json._save_name : undefined;
      meta.renpyVersion = Array.isArray(json._renpy_version) ? json._renpy_version.join(".") : undefined;
      meta.gameVersion = typeof json._version === "string" ? json._version : undefined;
      meta.runtimeSeconds = typeof json._game_runtime === "number" ? json._game_runtime : undefined;
      meta.created = typeof json._ctime === "number" ? new Date(json._ctime * 1000) : undefined;
    } catch {
      /* ignore malformed json */
    }
  }
  if (!meta.saveName && entries["extra_info"]) meta.saveName = decodeUtf8(entries["extra_info"]);
  if (!meta.renpyVersion && entries["renpy_version"]) meta.renpyVersion = decodeUtf8(entries["renpy_version"]);
  return {
    kind: "save",
    entries,
    pickle: log,
    tracker,
    root,
    rootContainer: rootsMap,
    meta,
    screenshot: entries["screenshot.png"] ?? null,
    signed: !!entries["signatures"] && entries["signatures"].length > 0,
    rollbackStores,
  };
}

/** `stores` of the RollbackLog entries from the last checkpoint to the end. */
function activeRollbackStores(log: unknown): Map<string, Map<unknown, unknown>>[] {
  if (!(log instanceof PyObject)) return [];
  const entries = Array.isArray(log.attrs.log) ? (log.attrs.log as unknown[]) : [];
  const out: Map<string, Map<unknown, unknown>>[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!(e instanceof PyObject)) continue;
    const stores = e.attrs.stores;
    if (stores instanceof Map) {
      const m = new Map<string, Map<unknown, unknown>>();
      for (const [k, v] of stores) if (typeof k === "string" && v instanceof Map) m.set(k, v);
      out.push(m);
    }
    if (e.attrs.checkpoint === true) break;
  }
  return out;
}

/**
 * Extra edits so a changed store variable also survives Ren'Py's rollback-on-load: the same
 * variable in the active rollback entries gets the new value (when stored as a literal).
 */
function mirrorRollbackEdits(save: LoadedSave, edits: PickleEdit[]): PickleEdit[] {
  if (save.kind !== "save" || save.rollbackStores.length === 0) return edits;
  const keyBySpan = new Map<unknown, string>();
  for (const key of save.root.keys()) {
    const span = save.tracker.get(save.rootContainer, key);
    if (span) keyBySpan.set(span, key);
  }
  const out = [...edits];
  const used = new Set(edits.map((e) => e.span));
  for (const e of edits) {
    const key = keyBySpan.get(e.span);
    if (!key) continue;
    const dot = key.lastIndexOf(".");
    const storeName = key.slice(0, dot);
    const varName = key.slice(dot + 1);
    for (const stores of save.rollbackStores) {
      const dict = stores.get(storeName);
      const span = dict ? save.tracker.get(dict, varName) : undefined;
      if (span && !used.has(span) && span.type !== "bytes") {
        used.add(span);
        out.push({ span, value: e.value, type: e.type ?? e.span.type });
      }
    }
  }
  return out;
}

/** Serialize a save with literal edits applied. Everything else is kept byte-for-byte. */
export function writeSave(save: LoadedSave, edits: PickleEdit[]): Uint8Array {
  const patched = patchPickle(save.pickle, mirrorRollbackEdits(save, edits), save.tracker.frames);
  if (save.kind === "persistent") return zlibSync(patched, { level: 6 });
  const files: Zippable = {};
  for (const [name, bytes] of Object.entries(save.entries)) files[name] = name === "log" ? patched : bytes;
  return zipSync(files, { level: 6 });
}
