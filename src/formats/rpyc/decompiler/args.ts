import { asArray, asMap, attr, has, str } from "./util";

/**
 * Render an ArgumentInfo as "(a, b=c, *d, **e)".
 * Handles Ren'Py ≥7.4 (starred_indexes / doublestarred_indexes) and older (extrapos / extrakw).
 */
export function formatArguments(info: unknown): string {
  if (info === null || info === undefined) return "";
  const parts: string[] = [];
  const args = asArray(attr(info, "arguments", []));
  const starred = new Set(asArray(attr(info, "starred_indexes", [])) as number[]);
  const dstarred = new Set(asArray(attr(info, "doublestarred_indexes", [])) as number[]);
  args.forEach((pair, i) => {
    const [name, value] = asArray(pair);
    const expr = str(value);
    if (starred.has(i)) parts.push(`*${expr}`);
    else if (dstarred.has(i)) parts.push(`**${expr}`);
    else if (name !== null && name !== undefined) parts.push(`${str(name)}=${expr}`);
    else parts.push(expr);
  });
  if (has(info, "extrapos") && attr(info, "extrapos")) parts.push(`*${str(attr(info, "extrapos"))}`);
  if (has(info, "extrakw") && attr(info, "extrakw")) parts.push(`**${str(attr(info, "extrakw"))}`);
  return `(${parts.join(", ")})`;
}

const POSITIONAL_ONLY = 0;
const VAR_POSITIONAL = 2;
const KEYWORD_ONLY = 3;
const VAR_KEYWORD = 4;

function kindValue(kind: unknown): number {
  if (typeof kind === "number") return kind;
  // inspect._ParameterKind is an IntEnum, pickled as _ParameterKind(value).
  const v = (kind as { args?: unknown[] })?.args?.[0];
  return typeof v === "number" ? v : 1;
}

/**
 * Render a Signature (Ren'Py 8) or ParameterInfo (Ren'Py ≤7) as "(a, b=1, *args, c, **kw)".
 */
export function formatParameters(info: unknown): string {
  if (info === null || info === undefined) return "";
  const parts: string[] = [];

  if (has(info, "parameters") && attr(info, "parameters") instanceof Map) {
    // renpy.parameter.Signature: {name: Parameter(name, kind, default)}
    const params = [...asMap(attr(info, "parameters")).values()];
    let sawPosOnly = false;
    let sawVarPos = false;
    for (const p of params) {
      const kind = kindValue(attr(p, "kind"));
      const name = str(attr(p, "name"));
      const def = attr(p, "default");
      if (sawPosOnly && kind !== POSITIONAL_ONLY) {
        parts.push("/");
        sawPosOnly = false;
      }
      if (kind === KEYWORD_ONLY && !sawVarPos) {
        parts.push("*");
        sawVarPos = true;
      }
      if (kind === POSITIONAL_ONLY) sawPosOnly = true;
      if (kind === VAR_POSITIONAL) {
        parts.push(`*${name}`);
        sawVarPos = true;
      } else if (kind === VAR_KEYWORD) {
        parts.push(`**${name}`);
      } else {
        parts.push(def === null || def === undefined ? name : `${name}=${str(def)}`);
      }
    }
    if (sawPosOnly) parts.push("/");
    return `(${parts.join(", ")})`;
  }

  // Legacy ParameterInfo: parameters [(name, default)], positional [names], extrapos, extrakw,
  // and optionally last_posonly / first_kwonly (Ren'Py 7.5+).
  const params = asArray(attr(info, "parameters", []));
  const extrapos = attr<unknown>(info, "extrapos", null);
  const extrakw = attr<unknown>(info, "extrakw", null);
  const lastPosOnly = attr<unknown>(info, "last_posonly", null);
  const firstKwOnly = attr<unknown>(info, "first_kwonly", null);
  let kwOnlyMarked = false;
  for (const pair of params) {
    const [nameV, def] = asArray(pair);
    const name = str(nameV);
    if (firstKwOnly !== null && name === str(firstKwOnly) && !kwOnlyMarked) {
      parts.push(extrapos ? `*${str(extrapos)}` : "*");
      kwOnlyMarked = true;
    }
    parts.push(def === null || def === undefined ? name : `${name}=${str(def)}`);
    if (lastPosOnly !== null && name === str(lastPosOnly)) parts.push("/");
  }
  if (extrapos && !kwOnlyMarked) parts.push(`*${str(extrapos)}`);
  if (extrakw) parts.push(`**${str(extrakw)}`);
  return `(${parts.join(", ")})`;
}
