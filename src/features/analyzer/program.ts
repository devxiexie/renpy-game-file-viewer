import { readSource, type FileSource } from "../../core/vfs/source";
import { PyObject } from "../../formats/pickle/types";
import { readRpyc } from "../../formats/rpyc/container";
import { asArray, attr, className, lineOf, optStr, pyCodeSource, str } from "../../formats/rpyc/decompiler/util";
import { imageName, labelNameOf, literal } from "./build";

/** Simplified statement tree used by the interactive label player. */
export type PStmt =
  | { t: "say"; who: string | null; what: string; line: number }
  | { t: "scene"; image: string | null; line: number }
  | { t: "show"; image: string; tag: string; at: string[]; line: number }
  | { t: "hide"; tag: string; line: number }
  | { t: "with"; transition: string; line: number }
  | { t: "menu"; caption: { who: string | null; what: string } | null; items: { text: string; condition: string | null; block: PStmt[] }[]; line: number }
  | { t: "if"; entries: { condition: string | null; block: PStmt[] }[]; line: number }
  | { t: "jump"; target: string; dynamic: boolean; line: number }
  | { t: "call"; target: string; dynamic: boolean; line: number }
  | { t: "return"; line: number }
  | { t: "python"; code: string; line: number }
  | { t: "other"; text: string; line: number };

export interface LabelProgram {
  label: string;
  fileId: string;
  file: string;
  line: number;
  body: PStmt[];
}

function convertBlock(nodes: unknown[], label: string): PStmt[] {
  const out: PStmt[] = [];
  nodes.forEach((n, i) => {
    const s = convert(n, nodes, i, label);
    if (s) out.push(s);
  });
  return out;
}

function target(raw: string, label: string, expression: boolean): { target: string; dynamic: boolean } {
  if (expression) {
    const lit = literal(raw);
    return { target: lit ?? raw, dynamic: lit === null };
  }
  return { target: raw.startsWith(".") ? label.split(".")[0] + raw : raw, dynamic: false };
}

function convert(n: unknown, siblings: unknown[], i: number, label: string): PStmt | null {
  if (!(n instanceof PyObject)) return null;
  const line = lineOf(n);
  switch (n.className) {
    case "Say":
    case "TranslateSay":
      // The caption of a following menu is shown by the menu itself.
      if (attr<unknown>(n, "interact", true) === false && className(siblings[i + 1]) === "Menu") return null;
      return { t: "say", who: optStr(attr(n, "who", null)), what: str(attr(n, "what", "")), line };
    case "Scene": {
      const spec = attr<unknown>(n, "imspec", null);
      const img = spec ? imageName(spec) : null;
      return { t: "scene", image: img && !img.expression ? img.name : null, line };
    }
    case "Show": {
      const img = imageName(attr(n, "imspec"));
      return img.expression ? null : { t: "show", image: img.name, tag: img.asTag ?? img.tag, at: img.at, line };
    }
    case "Hide": {
      const img = imageName(attr(n, "imspec"));
      return { t: "hide", tag: img.asTag ?? img.tag, line };
    }
    case "With": {
      const e = str(attr(n, "expr"));
      return e && e !== "None" ? { t: "with", transition: e, line } : null;
    }
    case "Menu": {
      const prev = siblings[i - 1];
      let caption = className(prev) === "Say" && attr<unknown>(prev, "interact", true) === false ? { who: optStr(attr(prev, "who", null)), what: str(attr(prev, "what", "")) } : null;
      const items: { text: string; condition: string | null; block: PStmt[] }[] = [];
      for (const raw of asArray(attr(n, "items", []))) {
        const [t, c, b] = asArray(raw);
        if (b === null || b === undefined) {
          caption ??= { who: null, what: str(t) };
          continue;
        }
        const cond = optStr(c);
        items.push({ text: str(t), condition: cond && cond !== "True" ? cond : null, block: convertBlock(asArray(b), label) });
      }
      return { t: "menu", caption, items, line };
    }
    case "If":
    case "While": {
      if (n.className === "While") return { t: "if", entries: [{ condition: str(attr(n, "condition")), block: convertBlock(asArray(attr(n, "block", [])), label) }], line };
      return {
        t: "if",
        entries: asArray(attr(n, "entries", [])).map((e) => {
          const [c, b] = asArray(e);
          const cond = optStr(c);
          return { condition: cond === null || cond === "True" ? null : cond, block: convertBlock(asArray(b), label) };
        }),
        line,
      };
    }
    case "Jump":
      return { t: "jump", ...target(str(attr(n, "target")), label, !!attr(n, "expression", false)), line };
    case "Call":
      return { t: "call", ...target(str(attr(n, "label")), label, !!attr(n, "expression", false)), line };
    case "Return":
      return { t: "return", line };
    case "Python":
      return { t: "python", code: pyCodeSource(attr(n, "code")).trim(), line };
    case "UserStatement":
      return { t: "other", text: str(attr(n, "line")), line };
    case "Label":
      return null; // `call x from y` / `menu name:` helper labels
    case "Pass":
      return null;
    default:
      return null;
  }
}

function findLabel(nodes: unknown[], name: string): PyObject | null {
  for (const n of nodes) {
    if (className(n) === "Label" && labelNameOf(n) === name) return n as PyObject;
    for (const key of ["block"]) {
      const b = attr<unknown>(n, key, null);
      if (Array.isArray(b) && className(n) === "Init") {
        const r = findLabel(b, name);
        if (r) return r;
      }
    }
  }
  return null;
}

const fileCache = new Map<string, Promise<{ statements: unknown[]; file: string }>>();

/** Build the player program for `label` from the .rpyc it is defined in (statements are cached per file). */
export async function labelProgram(fileId: string, source: FileSource, label: string): Promise<LabelProgram | null> {
  let p = fileCache.get(fileId);
  if (!p) {
    p = readSource(source).then((data) => {
      const { statements } = readRpyc(data);
      return { statements, file: str(attr(statements.find((n) => attr(n, "filename", null)), "filename", "")) };
    });
    fileCache.set(fileId, p);
    if (fileCache.size > 40) fileCache.delete(fileCache.keys().next().value!);
  }
  const { statements, file } = await p;
  const node = findLabel(statements, label);
  if (!node) return null;
  return { label, fileId, file, line: lineOf(node), body: convertBlock(asArray(attr(node, "block", [])), label) };
}
