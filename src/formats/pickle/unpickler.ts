import { decodeLatin1, decodeUtf8, decodeUtf8OrLatin1, encodeLatin1 } from "../../core/binary/text";
import { PyFloat, PyGlobal, PyObject, makeTuple, tagClass } from "./types";

export interface UnpickleOptions {
  /**
   * How Python 2 `str` values (protocol ≤2 STRING/BINSTRING opcodes) are decoded.
   * "utf8" decodes as UTF-8 falling back to Latin-1, "bytes" keeps a Uint8Array.
   */
  py2Str?: "utf8" | "bytes";
  /** Wrap floats in PyFloat so they can be told apart from ints. */
  preserveFloats?: boolean;
  /** Record where literal values live in the byte stream (for in-place patching). */
  track?: SpanTracker;
}

export type LiteralType = "none" | "bool" | "int" | "float" | "str" | "py2str" | "bytes";

/** Byte range of the opcode that produced a literal value. */
export interface Span {
  start: number;
  end: number;
  type: LiteralType;
}

/**
 * Locations of literal values inside containers: for a dict, key → span; for a list,
 * index → span; for an object built from a dict state, attribute name → span.
 */
export class SpanTracker {
  readonly spans = new WeakMap<object, Map<unknown, Span>>();
  /** Offsets of FRAME opcodes (9 bytes each); removed when patching. */
  readonly frames: number[] = [];
  protocol = 0;

  record(container: unknown, key: unknown, span: Span | undefined): void {
    if (!span || container === null || typeof container !== "object") return;
    let m = this.spans.get(container);
    if (!m) this.spans.set(container, (m = new Map()));
    m.set(key, span);
  }

  get(container: unknown, key: unknown): Span | undefined {
    return container !== null && typeof container === "object" ? this.spans.get(container)?.get(key) : undefined;
  }
}

const LITERAL_OPS: Record<number, LiteralType> = {
  0x4e: "none", 0x88: "bool", 0x89: "bool",
  0x4b: "int", 0x4d: "int", 0x4a: "int", 0x8a: "int", 0x8b: "int", 0x49: "int", 0x4c: "int",
  0x46: "float", 0x47: "float",
  0x53: "py2str", 0x54: "py2str", 0x55: "py2str",
  0x56: "str", 0x58: "str", 0x8c: "str", 0x8d: "str",
  0x42: "bytes", 0x43: "bytes", 0x8e: "bytes",
};

export class UnpicklingError extends Error {}

// Container subclasses that Ren'Py (and the stdlib) pickle via APPENDS/SETITEMS.
const LIST_CLASSES = /\.RevertableList$|^collections\.deque$/;
const DICT_CLASSES = /\.Revertable(?:Default|Ordered)?Dict$|^collections\.(?:OrderedDict|defaultdict)$/;
const SET_CLASSES = /\.Revertable(?:Frozen)?Set$/;

function isBuiltin(g: PyGlobal, ...names: string[]): boolean {
  return (g.module === "builtins" || g.module === "__builtin__") && names.includes(g.name);
}

/** Construct an instance of `cls` with `args` without executing anything. */
function instantiate(cls: unknown, args: unknown[], kwargs?: Map<unknown, unknown>): unknown {
  if (!(cls instanceof PyGlobal)) {
    return new PyObject(String(cls), args, kwargs);
  }
  const full = cls.fullName;
  if (isBuiltin(cls, "set", "frozenset")) return new Set(iterableArg(args[0]));
  if (isBuiltin(cls, "list")) return [...iterableArg(args[0])];
  if (isBuiltin(cls, "tuple")) return makeTuple([...iterableArg(args[0])]);
  if (isBuiltin(cls, "dict")) return toMap(args[0]);
  if (isBuiltin(cls, "bytearray", "bytes")) {
    const a = args[0];
    if (a instanceof Uint8Array) return a;
    if (typeof a === "string") return encodeLatin1(a);
    if (Array.isArray(a)) return Uint8Array.from(a as number[]);
    return new Uint8Array(0);
  }
  if ((cls.module === "_codecs" || cls.module === "codecs") && cls.name === "encode") {
    // Python 3 pickles bytes for protocol < 3 as _codecs.encode(str, "latin1").
    return typeof args[0] === "string" ? encodeLatin1(args[0]) : new Uint8Array(0);
  }
  if ((cls.module === "copy_reg" || cls.module === "copyreg") && cls.name === "_reconstructor") {
    const [subcls, base, state] = args;
    const name = subcls instanceof PyGlobal ? subcls.fullName : String(subcls);
    if (base instanceof PyGlobal && isBuiltin(base, "list")) return tagClass([...iterableArg(state)], name);
    if (base instanceof PyGlobal && isBuiltin(base, "dict")) return tagClass(toMap(state), name);
    return instantiate(subcls, []);
  }
  if (LIST_CLASSES.test(full)) return tagClass([...iterableArg(args[0])], full);
  if (DICT_CLASSES.test(full)) {
    return tagClass(toMap(full.endsWith("defaultdict") ? args[1] : args[0]), full);
  }
  if (SET_CLASSES.test(full)) return tagClass(new Set(iterableArg(args[0])), full);
  return new PyObject(full, args, kwargs);
}

/** dict(x): x may be a mapping or an iterable of (key, value) pairs. */
function toMap(v: unknown): Map<unknown, unknown> {
  if (v instanceof Map) return new Map(v);
  const m = new Map<unknown, unknown>();
  if (Array.isArray(v)) {
    for (const pair of v) if (Array.isArray(pair) && pair.length === 2) m.set(pair[0], pair[1]);
  }
  return m;
}

function iterableArg(v: unknown): Iterable<unknown> {
  if (v == null) return [];
  if (Array.isArray(v) || v instanceof Set) return v;
  if (v instanceof Map) return v.keys();
  if (typeof v === "string") return v;
  return [];
}

function build(target: unknown, state: unknown): void {
  if (target instanceof PyObject) {
    if (state instanceof Map) {
      for (const [k, v] of state) if (typeof k === "string") target.attrs[k] = v;
    } else if (Array.isArray(state) && state.length === 2 && (state[0] == null || state[0] instanceof Map) && (state[1] == null || state[1] instanceof Map)) {
      for (const part of state as (Map<unknown, unknown> | null)[]) {
        if (part) for (const [k, v] of part) if (typeof k === "string") target.attrs[k] = v;
      }
    } else {
      target.state = state;
    }
  } else if (target instanceof Map && state instanceof Map) {
    // dict subclass with instance __dict__: keep items, ignore attributes.
  }
}

function append(target: unknown, items: unknown[]): void {
  if (Array.isArray(target)) {
    for (const it of items) target.push(it);
  } else if (target instanceof Set) {
    for (const it of items) target.add(it);
  } else if (target instanceof PyObject) {
    (target.items ??= []).push(...items);
  } else {
    throw new UnpicklingError("APPEND to non-list object");
  }
}

function setItem(target: unknown, k: unknown, v: unknown): void {
  if (target instanceof Map) target.set(k, v);
  else if (target instanceof PyObject) (target.map ??= new Map()).set(k, v);
  else throw new UnpicklingError("SETITEM on non-dict object");
}

function signedFromBytesLE(bytes: Uint8Array): number | bigint {
  if (bytes.length === 0) return 0;
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  if (bytes[bytes.length - 1] & 0x80) n -= 1n << BigInt(bytes.length * 8);
  return normalizeInt(n);
}

function normalizeInt(n: bigint): number | bigint {
  return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : n;
}

/** Decode a Python repr()'d string literal body (protocol 0 STRING opcode). */
function unescapePyString(s: string): string {
  return s.replace(/\\(x[0-9a-fA-F]{2}|[0-7]{1,3}|.)/gs, (_m, e: string) => {
    if (e[0] === "x") return String.fromCharCode(parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCharCode(parseInt(e, 8));
    switch (e) {
      case "n": return "\n";
      case "r": return "\r";
      case "t": return "\t";
      case "a": return "\x07";
      case "b": return "\b";
      case "f": return "\f";
      case "v": return "\v";
      case "\n": return "";
      default: return e;
    }
  });
}

function rawUnicodeEscape(s: string): string {
  return s.replace(/\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (_m, a: string | undefined, b: string | undefined) =>
    String.fromCodePoint(parseInt((a ?? b)!, 16)),
  );
}

export function unpickle(data: Uint8Array, options: UnpickleOptions = {}): unknown {
  const py2Str = options.py2Str ?? "utf8";
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;
  const stack: unknown[] = [];
  const marks: number[] = [];
  const memo = new Map<number, unknown>();

  const need = (n: number) => {
    if (pos + n > data.length) throw new UnpicklingError("Unexpected end of pickle data");
  };
  const u8 = () => (need(1), data[pos++]);
  const u16 = () => (need(2), (pos += 2), view.getUint16(pos - 2, true));
  const u32 = () => (need(4), (pos += 4), view.getUint32(pos - 4, true));
  const i32 = () => (need(4), (pos += 4), view.getInt32(pos - 4, true));
  const u64 = () => {
    need(8);
    const v = view.getBigUint64(pos, true);
    pos += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new UnpicklingError("Length too large");
    return Number(v);
  };
  const bytes = (n: number) => {
    need(n);
    const b = data.subarray(pos, pos + n);
    pos += n;
    return b;
  };
  const line = () => {
    const end = data.indexOf(0x0a, pos);
    if (end < 0) throw new UnpicklingError("Unterminated line in pickle");
    const s = decodeLatin1(data.subarray(pos, end));
    pos = end + 1;
    return s;
  };
  const pop = () => {
    if (stack.length === 0) throw new UnpicklingError("Stack underflow");
    return stack.pop();
  };
  const top = () => stack[stack.length - 1];
  const popMark = (): unknown[] => {
    const m = marks.pop();
    if (m === undefined) throw new UnpicklingError("MARK not found");
    return stack.splice(m);
  };
  const py2String = (b: Uint8Array): unknown => (py2Str === "bytes" ? b.slice() : decodeUtf8OrLatin1(b));
  const float = (v: number) => (options.preserveFloats ? new PyFloat(v) : v);
  const memoGet = (i: number) => {
    if (!memo.has(i)) throw new UnpicklingError(`Memo key ${i} missing`);
    return memo.get(i);
  };
  const track = options.track;
  const spanStack: (Span | undefined)[] = [];

  /** Record literal spans of items that container ops are about to consume. */
  const trackBefore = (op: number, opStart: number) => {
    if (!track) return;
    const n = stack.length;
    switch (op) {
      case 0x80:
        track.protocol = data[opStart + 1];
        break;
      case 0x95:
        track.frames.push(opStart);
        break;
      case 0x73: // SETITEM
        track.record(stack[n - 3], stack[n - 2], spanStack[n - 1]);
        break;
      case 0x75: { // SETITEMS
        const m = marks[marks.length - 1];
        for (let i = m; i + 1 < n; i += 2) track.record(stack[m - 1], stack[i], spanStack[i + 1]);
        break;
      }
      case 0x61: { // APPEND
        const target = stack[n - 2];
        const base = Array.isArray(target) ? target.length : target instanceof PyObject ? (target.items?.length ?? 0) : 0;
        track.record(target, base, spanStack[n - 1]);
        break;
      }
      case 0x65: { // APPENDS
        const m = marks[marks.length - 1];
        const target = stack[m - 1];
        const base = Array.isArray(target) ? target.length : target instanceof PyObject ? (target.items?.length ?? 0) : 0;
        for (let i = m; i < n; i++) track.record(target, base + i - m, spanStack[i]);
        break;
      }
      case 0x62: { // BUILD: attribute spans come from the state dict(s)
        const target = stack[n - 2];
        const state = stack[n - 1];
        const parts = state instanceof Map ? [state] : Array.isArray(state) ? state.filter((s) => s instanceof Map) : [];
        for (const part of parts) for (const [k, s] of track.spans.get(part as object) ?? []) track.record(target, k, s);
        break;
      }
    }
  };

  let tupleSpans: (Span | undefined)[] | undefined;
  for (;;) {
    const opStart = pos;
    const op = u8();
    if (track) {
      trackBefore(op, opStart);
      // Tuples built from literals keep their element spans too.
      if (op === 0x74 || op === 0x85 || op === 0x86 || op === 0x87) tupleSpans = op === 0x74 ? spanStack.slice(marks[marks.length - 1]) : spanStack.slice(stack.length - (op - 0x84));
    }
    switch (op) {
      case 0x80: // PROTO
        u8();
        break;
      case 0x95: // FRAME
        u64();
        break;
      case 0x2e: // STOP
        return pop();
      case 0x28: // MARK
        marks.push(stack.length);
        break;
      case 0x30: // POP
        pop();
        break;
      case 0x31: // POP_MARK
        popMark();
        break;
      case 0x32: // DUP
        stack.push(top());
        break;

      // --- constants & numbers ---
      case 0x4e: // NONE
        stack.push(null);
        break;
      case 0x88: // NEWTRUE
        stack.push(true);
        break;
      case 0x89: // NEWFALSE
        stack.push(false);
        break;
      case 0x4b: // BININT1
        stack.push(u8());
        break;
      case 0x4d: // BININT2
        stack.push(u16());
        break;
      case 0x4a: // BININT
        stack.push(i32());
        break;
      case 0x8a: // LONG1
        stack.push(signedFromBytesLE(bytes(u8())));
        break;
      case 0x8b: // LONG4
        stack.push(signedFromBytesLE(bytes(i32())));
        break;
      case 0x49: { // INT
        const s = line().trim();
        if (s === "00") stack.push(false);
        else if (s === "01") stack.push(true);
        else stack.push(normalizeInt(BigInt(s)));
        break;
      }
      case 0x4c: { // LONG
        const s = line().trim().replace(/L$/, "");
        stack.push(normalizeInt(BigInt(s)));
        break;
      }
      case 0x46: // FLOAT
        stack.push(float(parseFloat(line())));
        break;
      case 0x47: // BINFLOAT
        need(8);
        stack.push(float(view.getFloat64(pos, false)));
        pos += 8;
        break;

      // --- strings & bytes ---
      case 0x53: { // STRING
        const s = line().trim();
        const body = unescapePyString(s.slice(1, -1));
        stack.push(py2String(encodeLatin1(body)));
        break;
      }
      case 0x54: // BINSTRING
        stack.push(py2String(bytes(i32())));
        break;
      case 0x55: // SHORT_BINSTRING
        stack.push(py2String(bytes(u8())));
        break;
      case 0x56: // UNICODE
        stack.push(rawUnicodeEscape(line()));
        break;
      case 0x58: // BINUNICODE
        stack.push(decodeUtf8(bytes(u32())));
        break;
      case 0x8c: // SHORT_BINUNICODE
        stack.push(decodeUtf8(bytes(u8())));
        break;
      case 0x8d: // BINUNICODE8
        stack.push(decodeUtf8(bytes(u64())));
        break;
      case 0x42: // BINBYTES
        stack.push(bytes(u32()).slice());
        break;
      case 0x43: // SHORT_BINBYTES
        stack.push(bytes(u8()).slice());
        break;
      case 0x8e: // BINBYTES8
        stack.push(bytes(u64()).slice());
        break;
      case 0x96: // BYTEARRAY8
        stack.push(bytes(u64()).slice());
        break;

      // --- containers ---
      case 0x5d: // EMPTY_LIST
        stack.push([]);
        break;
      case 0x29: // EMPTY_TUPLE
        stack.push(makeTuple([]));
        break;
      case 0x7d: // EMPTY_DICT
        stack.push(new Map());
        break;
      case 0x8f: // EMPTY_SET
        stack.push(new Set());
        break;
      case 0x6c: // LIST
        stack.push(popMark());
        break;
      case 0x74: // TUPLE
        stack.push(makeTuple(popMark()));
        break;
      case 0x85: // TUPLE1
        stack.push(makeTuple([pop()]));
        break;
      case 0x86: { // TUPLE2
        const b = pop();
        const a = pop();
        stack.push(makeTuple([a, b]));
        break;
      }
      case 0x87: { // TUPLE3
        const c = pop();
        const b = pop();
        const a = pop();
        stack.push(makeTuple([a, b, c]));
        break;
      }
      case 0x64: { // DICT
        const items = popMark();
        const d = new Map();
        for (let i = 0; i + 1 < items.length; i += 2) d.set(items[i], items[i + 1]);
        stack.push(d);
        break;
      }
      case 0x91: // FROZENSET
        stack.push(new Set(popMark()));
        break;
      case 0x61: { // APPEND
        const v = pop();
        append(top(), [v]);
        break;
      }
      case 0x65: { // APPENDS
        const items = popMark();
        append(top(), items);
        break;
      }
      case 0x90: { // ADDITEMS
        const items = popMark();
        append(top(), items);
        break;
      }
      case 0x73: { // SETITEM
        const v = pop();
        const k = pop();
        setItem(top(), k, v);
        break;
      }
      case 0x75: { // SETITEMS
        const items = popMark();
        const target = top();
        for (let i = 0; i + 1 < items.length; i += 2) setItem(target, items[i], items[i + 1]);
        break;
      }

      // --- memo ---
      case 0x70: // PUT
        memo.set(parseInt(line(), 10), top());
        break;
      case 0x71: // BINPUT
        memo.set(u8(), top());
        break;
      case 0x72: // LONG_BINPUT
        memo.set(u32(), top());
        break;
      case 0x94: // MEMOIZE
        memo.set(memo.size, top());
        break;
      case 0x67: // GET
        stack.push(memoGet(parseInt(line(), 10)));
        break;
      case 0x68: // BINGET
        stack.push(memoGet(u8()));
        break;
      case 0x6a: // LONG_BINGET
        stack.push(memoGet(u32()));
        break;

      // --- objects ---
      case 0x63: { // GLOBAL
        const module = line();
        const name = line();
        stack.push(new PyGlobal(module, name));
        break;
      }
      case 0x93: { // STACK_GLOBAL
        const name = pop();
        const module = pop();
        stack.push(new PyGlobal(String(module), String(name)));
        break;
      }
      case 0x52: { // REDUCE
        const args = pop();
        const fn = pop();
        stack.push(instantiate(fn, Array.isArray(args) ? args : []));
        break;
      }
      case 0x81: { // NEWOBJ
        const args = pop();
        const cls = pop();
        stack.push(instantiate(cls, Array.isArray(args) ? args : []));
        break;
      }
      case 0x92: { // NEWOBJ_EX
        const kwargs = pop();
        const args = pop();
        const cls = pop();
        stack.push(instantiate(cls, Array.isArray(args) ? args : [], kwargs instanceof Map ? kwargs : undefined));
        break;
      }
      case 0x62: { // BUILD
        const state = pop();
        build(top(), state);
        break;
      }
      case 0x69: { // INST
        const module = line();
        const name = line();
        const args = popMark();
        stack.push(instantiate(new PyGlobal(module, name), args));
        break;
      }
      case 0x6f: { // OBJ
        const items = popMark();
        const cls = items.shift();
        stack.push(instantiate(cls, items));
        break;
      }

      case 0x50: // PERSID
      case 0x51: // BINPERSID
        throw new UnpicklingError("Persistent IDs are not supported");
      case 0x82: // EXT1
      case 0x83: // EXT2
      case 0x84: // EXT4
        throw new UnpicklingError("Extension registry codes are not supported");
      case 0x97: // NEXT_BUFFER
      case 0x98: // READONLY_BUFFER
        throw new UnpicklingError("Out-of-band buffers are not supported");
      default:
        throw new UnpicklingError(`Unknown pickle opcode 0x${op.toString(16)} at offset ${pos - 1}`);
    }
    if (track) {
      spanStack.length = stack.length;
      const t = LITERAL_OPS[op];
      if (t) spanStack[stack.length - 1] = { start: opStart, end: pos, type: t };
      else if (tupleSpans) tupleSpans.forEach((sp, i) => track.record(stack[stack.length - 1], i, sp));
      tupleSpans = undefined;
    }
  }
}
