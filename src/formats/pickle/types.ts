/**
 * Generic Python object model produced by the unpickler.
 *
 * - None → null, bool → boolean, int → number (or bigint when unsafe), float → number
 *   (or PyFloat when `preserveFloats` is set), str → string, bytes → Uint8Array
 * - list → Array, tuple → Array marked with TUPLE, dict → Map, set/frozenset → Set
 * - instances of any other class → PyObject (no code is ever executed)
 *
 * Container subclasses (RevertableList, OrderedDict, defaultdict, ...) become the
 * matching JS container tagged with their class name via PY_CLASS.
 */

export const TUPLE: unique symbol = Symbol("py.tuple");
export const PY_CLASS: unique symbol = Symbol("py.class");

export type PyTuple = unknown[] & { [TUPLE]: true };

export class PyGlobal {
  constructor(
    readonly module: string,
    readonly name: string,
  ) {}
  get fullName(): string {
    return `${this.module}.${this.name}`;
  }
  toString(): string {
    return this.fullName;
  }
}

export class PyObject {
  /** Attributes from __dict__ and __slots__ state. */
  attrs: Record<string, unknown> = Object.create(null);
  /** Raw state passed to BUILD when it wasn't a dict / (dict, slots) pair. */
  state: unknown = undefined;
  /** Items appended via APPEND(S) to a non-list object. */
  items?: unknown[];
  /** Items set via SETITEM(S) on a non-dict object. */
  map?: Map<unknown, unknown>;

  constructor(
    readonly cls: string,
    readonly args: unknown[] = [],
    readonly kwargs?: Map<unknown, unknown>,
  ) {}

  get className(): string {
    const i = this.cls.lastIndexOf(".");
    return i < 0 ? this.cls : this.cls.slice(i + 1);
  }
}

export class PyFloat {
  constructor(readonly value: number) {}
}

export function makeTuple(items: unknown[]): PyTuple {
  Object.defineProperty(items, TUPLE, { value: true, enumerable: false });
  return items as PyTuple;
}

export function isTuple(v: unknown): v is PyTuple {
  return Array.isArray(v) && (v as Partial<PyTuple>)[TUPLE] === true;
}

export function pyClassOf(v: unknown): string | undefined {
  if (v instanceof PyObject) return v.cls;
  if (v && typeof v === "object") return (v as { [PY_CLASS]?: string })[PY_CLASS];
  return undefined;
}

export function tagClass<T extends object>(v: T, cls: string): T {
  Object.defineProperty(v, PY_CLASS, { value: cls, enumerable: false });
  return v;
}
