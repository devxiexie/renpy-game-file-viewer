import { PyObject } from "../../pickle/types";
import { formatArguments, formatParameters } from "./args";
import { writeAtlBlock } from "./atl";
import { dedent, writeSL2Screen } from "./sl2";
import { writeTestcase } from "./testcase";
import { Writer, type WriterOptions } from "./writer";
import {
  asArray,
  asMap,
  attr,
  className,
  has,
  lineOf,
  optStr,
  pyCodeLocation,
  pyCodeSource,
  quoteString,
  str,
} from "./util";

export interface DecompileOptions extends WriterOptions {
  /** Emit a header comment with the file's Ren'Py metadata. */
  header?: string;
}

export interface DecompileResult {
  source: string;
  /** Statement types encountered that were emitted as comments. */
  warnings: string[];
}

/** Base init priority Ren'Py assigns to statements that are implicitly wrapped in `init`. */
const IMPLICIT_INIT_BASE: Record<string, number> = {
  Define: 0,
  Default: 0,
  Transform: 0,
  Style: 0,
  Image: 500,
  Screen: -500,
  Testcase: 500,
  TranslateString: 0,
  TranslateBlock: 0,
  TranslateEarlyBlock: 0,
  TranslatePython: 0,
};

export function decompileStatements(statements: unknown[], options: DecompileOptions = {}): DecompileResult {
  const d = new Decompiler(options);
  if (options.header) {
    for (const line of options.header.split("\n")) d.w.write(`# ${line}`);
  }
  d.writeBlock(statements, true);
  return { source: demangle(d.w.toString(), firstFilename(statements)), warnings: [...d.warnings] };
}

function firstFilename(statements: unknown[]): string | null {
  for (const s of statements) {
    const f = attr<unknown>(s, "filename", null);
    if (typeof f === "string" && f) return f;
  }
  return null;
}

/** Mirror of renpy.lexer.munge_filename: `__name` in a file becomes `_m1_<file>__name`. */
export function mungePrefix(filename: string): string {
  let base = filename.replace(/\\/g, "/").split("/").pop() ?? "";
  if (base.endsWith("_ren.py")) base = base.slice(0, -7);
  else base = base.replace(/\.[^.]*$/, "");
  base = base.replace(/ /g, "_").replace(/[^a-zA-Z0-9_]/g, (c) => "0x" + c.codePointAt(0)!.toString(16));
  return `_m1_${base}__`;
}

function demangle(source: string, filename: string | null): string {
  if (!filename) return source;
  const prefix = mungePrefix(filename);
  return source.split(prefix).join("__");
}

class Decompiler {
  readonly w: Writer;
  readonly warnings = new Set<string>();
  /** Current `init offset` in effect for the file (top level only). */
  private initOffset = 0;
  /** Statement index to skip because it was folded into a previous statement. */
  private skip = new Set<unknown>();
  /** Pending `with` clause from a paired With node, appended to the next show/scene/hide. */
  private pairedWith: string | null = null;

  constructor(options: WriterOptions) {
    this.w = new Writer(options);
  }

  writeBlock(nodes: unknown[], topLevel = false): void {
    if (nodes.length === 0) {
      this.w.write("pass");
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (this.skip.has(node)) continue;
      this.writeNode(node, nodes, i, topLevel);
    }
  }

  private warn(msg: string): void {
    this.warnings.add(msg);
  }

  private writeNode(node: unknown, siblings: unknown[], index: number, topLevel: boolean): void {
    if (!(node instanceof PyObject)) {
      this.w.write(`# Unexpected non-node value in block`);
      return;
    }
    const next = siblings[index + 1];
    const kind = node.className;
    const menuCaption = kind === "Say" && attr<unknown>(node, "interact", true) === false && className(next) === "Menu";
    if (kind !== "Init" && !menuCaption) this.w.advanceTo(lineOf(node));

    switch (kind) {
      case "Init":
        return this.writeInit(node, topLevel, siblings, index);
      case "Label":
        return this.writeLabel(node, next);
      case "Say":
      case "TranslateSay":
        return this.writeSay(node, next);
      case "Menu":
        return this.writeMenu(node, null, null);
      case "Python":
        return this.writePython(node, false);
      case "EarlyPython":
        return this.writePython(node, true);
      case "Define":
        return this.writeDefine(node, null);
      case "Default":
        return this.writeDefault(node, null);
      case "Image":
        return this.writeImage(node, null);
      case "Transform":
        return this.writeTransform(node, null);
      case "Show":
        return this.writeShow(node);
      case "ShowLayer":
        return this.writeShowLayer(node);
      case "Camera":
        return this.writeCamera(node);
      case "Scene":
        return this.writeScene(node);
      case "Hide":
        return this.writeHide(node);
      case "With":
        return this.writeWith(node);
      case "Call":
        return this.writeCall(node, siblings, index);
      case "Jump":
        return this.writeJump(node);
      case "Return":
        return this.writeReturn(node);
      case "Pass":
        return this.w.write("pass");
      case "If":
        return this.writeIf(node);
      case "While":
        return this.writeWhile(node);
      case "UserStatement":
        return this.writeUserStatement(node);
      case "PostUserStatement":
        return;
      case "Screen":
        return this.writeScreen(node, null);
      case "Style":
        return this.writeStyle(node, null);
      case "Translate":
        return this.writeTranslate(node);
      case "EndTranslate":
        return;
      case "TranslateString":
        return this.writeTranslateStrings([node], null);
      case "TranslateBlock":
      case "TranslateEarlyBlock":
        return this.writeTranslateBlock(node, null);
      case "TranslatePython":
        return this.writeTranslatePython(node);
      case "Testcase":
        return this.writeTestcase(node, null);
      case "RPY":
        return this.w.write(`rpy ${asArray(attr(node, "rest", [])).map(str).join(" ")}`);
      default:
        this.warn(`Unsupported statement: ${node.cls}`);
        this.w.write(`# Unsupported statement: ${node.cls}`);
    }
  }

  // ---------------------------------------------------------------- init

  /** Offset implied by an implicit init wrapper (define, image, ...), or null. */
  private implicitOffset(node: unknown): number | null {
    if (className(node) !== "Init") return null;
    const block = asArray(attr(node, "block", []));
    const kind = className(block[0]);
    const base = IMPLICIT_INIT_BASE[kind];
    if (base === undefined) return null;
    const allStrings = block.every((n) => className(n) === "TranslateString");
    if (!((block.length === 1 && lineOf(block[0]) === lineOf(node)) || allStrings)) return null;
    return Number(attr(node, "priority", 0)) - base;
  }

  private writeInit(node: PyObject, topLevel: boolean, siblings: unknown[], index: number): void {
    const block = asArray(attr(node, "block", []));
    const priority = Number(attr(node, "priority", 0));

    // `init offset = N` is file-level parser state; emit it where the next implicit-init
    // statement needs a different offset than the current one.
    if (topLevel) {
      let desired: number | null = null;
      for (let j = index; j < siblings.length && desired === null; j++) desired = this.implicitOffset(siblings[j]);
      if (desired !== null && desired !== this.initOffset) {
        this.w.advanceTo(lineOf(node) - 1);
        this.w.write(`init offset = ${desired}`);
        this.initOffset = desired;
      }
    }

    const first = block[0];
    const firstKind = className(first);
    const offset = this.implicitOffset(node);

    if (offset !== null) {
      const allStrings = block.every((n) => className(n) === "TranslateString");
      let explicitPriority: number | null = null;
      // Statements that ended up at an unusual priority get `define N ...` or an `init N:` wrapper.
      if (offset !== this.initOffset) explicitPriority = priority - this.initOffset;
      this.w.advanceTo(lineOf(node));
      if (allStrings) return this.writeTranslateStrings(block, lineOf(node));
      switch (firstKind) {
        case "Define":
          return this.writeDefine(first as PyObject, explicitPriority);
        case "Default":
          return this.writeDefault(first as PyObject, explicitPriority);
        case "Transform":
          return this.writeTransform(first as PyObject, explicitPriority);
        case "Image":
          return this.writeImage(first as PyObject, explicitPriority);
        case "Screen":
          return this.writeScreen(first as PyObject, explicitPriority);
        case "Style":
          return this.writeStyle(first as PyObject, explicitPriority);
        case "Testcase":
          return this.writeTestcase(first as PyObject, explicitPriority);
        case "TranslateBlock":
        case "TranslateEarlyBlock":
          return this.writeTranslateBlock(first as PyObject, explicitPriority);
        case "TranslatePython":
          return this.writeTranslatePython(first as PyObject);
      }
    }

    // User statements with an init priority get wrapped in Init by Ren'Py itself.
    if (block.length === 1 && firstKind === "UserStatement" && lineOf(first) === lineOf(node)) {
      this.w.advanceTo(lineOf(node));
      return this.writeUserStatement(first as PyObject);
    }

    this.w.advanceTo(lineOf(node));
    const relative = priority - this.initOffset;
    const prio = relative === 0 ? "" : ` ${relative}`;

    // init python: / init -1 python early in foo:
    if (block.length === 1 && (firstKind === "Python" || firstKind === "EarlyPython") && lineOf(first) === lineOf(node)) {
      return this.writePython(first as PyObject, firstKind === "EarlyPython", `init${prio} `);
    }

    // init: / init N:
    if (block.length === 1 && lineOf(first) === lineOf(node) && firstKind !== "Init") {
      // `init 5 define x = 1` style single-line init.
      this.w.write(`init${prio}:`);
      this.w.indent(() => this.writeBlock(block));
      return;
    }
    this.w.write(`init${prio}:`);
    this.w.indent(() => this.writeBlock(block));
  }

  // ---------------------------------------------------------------- labels & flow

  private writeLabel(node: PyObject, next: unknown): void {
    const name = labelName(node);
    const block = asArray(attr(node, "block", []));
    // `menu name:` compiles to an empty Label followed by a Menu on the same line.
    if (block.length === 0 && className(next) === "Menu" && lineOf(next) === lineOf(node)) {
      this.skip.add(next);
      return this.writeMenu(next as PyObject, name, null);
    }
    const params = attr<unknown>(node, "parameters", null);
    const hide = attr(node, "hide", false) ? " hide" : "";
    this.w.write(`label ${name}${params ? formatParameters(params) : ""}${hide}:`);
    if (block.length) this.w.indent(() => this.writeBlock(block));
  }

  private writeCall(node: PyObject, siblings: unknown[], index: number): void {
    let line = "call ";
    const label = str(attr(node, "label"));
    if (attr(node, "expression", false)) line += `expression ${label}`;
    else line += label;
    const args = attr<unknown>(node, "arguments", null);
    if (args) line += attr(node, "expression", false) ? ` pass ${formatArguments(args)}` : formatArguments(args);

    // `call x from y` → Call, Label(y, []), Pass on the same line.
    const after = siblings[index + 1];
    if (className(after) === "Label" && lineOf(after) === lineOf(node) && asArray(attr(after, "block", [])).length === 0) {
      line += ` from ${labelName(after)}`;
      this.skip.add(after);
      const pass = siblings[index + 2];
      if (className(pass) === "Pass" && lineOf(pass) === lineOf(node)) this.skip.add(pass);
    } else if (className(after) === "Pass" && lineOf(after) === lineOf(node)) {
      this.skip.add(after);
    }
    this.w.write(line);
  }

  private writeJump(node: PyObject): void {
    const target = str(attr(node, "target"));
    this.w.write(attr(node, "expression", false) ? `jump expression ${target}` : `jump ${target}`);
  }

  private writeReturn(node: PyObject): void {
    const expr = optStr(attr(node, "expression", null));
    this.w.write(expr ? `return ${expr}` : "return");
  }

  private writeIf(node: PyObject): void {
    const entries = asArray(attr(node, "entries", []));
    entries.forEach((entry, i) => {
      const [cond, block] = asArray(entry);
      const blockNodes = asArray(block);
      const c = optStr(cond);
      if (i === 0) {
        this.w.write(`if ${c}:`);
      } else {
        // elif/else sit on the line before their first block statement (best guess).
        const firstLine = lineOf(blockNodes[0]);
        if (firstLine) this.w.advanceTo(firstLine - 1);
        this.w.write(c === null || c === "True" ? (i === entries.length - 1 ? "else:" : "elif True:") : `elif ${c}:`);
      }
      this.w.indent(() => this.writeBlock(blockNodes));
    });
  }

  private writeWhile(node: PyObject): void {
    this.w.write(`while ${str(attr(node, "condition"))}:`);
    this.w.indent(() => this.writeBlock(asArray(attr(node, "block", []))));
  }

  // ---------------------------------------------------------------- say & menu

  private sayLine(node: PyObject, inMenu = false): string {
    return sayCode(node, { inMenu });
  }

  private writeSay(node: PyObject, next: unknown): void {
    // A non-interacting say followed by a menu is the menu's caption.
    if (attr<unknown>(node, "interact", true) === false && className(next) === "Menu" && lineOf(next) <= lineOf(node)) {
      this.skip.add(next);
      this.w.advanceTo(lineOf(next));
      return this.writeMenu(next as PyObject, null, node);
    }
    this.w.write(this.sayLine(node));
  }

  private writeMenu(node: PyObject, labelName: string | null, caption: PyObject | null): void {
    let head = "menu";
    if (labelName) head += ` ${labelName}`;
    const args = attr<unknown>(node, "arguments", null);
    if (args) head += formatArguments(args);
    this.w.write(head + ":");
    this.w.indent(() => {
      const setVar = optStr(attr(node, "set", null));
      if (setVar) this.w.write(`set ${setVar}`);
      const withExpr = optStr(attr(node, "with_", null));
      if (withExpr) this.w.write(`with ${withExpr}`);
      if (caption) {
        this.w.advanceTo(lineOf(caption));
        this.w.write(this.sayLine(caption, true));
      }
      const itemArgs = asArray(attr(node, "item_arguments", null));
      asArray(attr(node, "items", [])).forEach((item, i) => {
        const [label, cond, block] = asArray(item);
        const blockNodes = block === null || block === undefined ? null : asArray(block);
        if (blockNodes && blockNodes.length) this.w.advanceTo(lineOf(blockNodes[0]) - 1);
        let line = quoteString(str(label));
        const ia = itemArgs[i];
        if (ia) line += " " + formatArguments(ia);
        const c = optStr(cond);
        if (c && c !== "True") line += ` if ${c}`;
        if (blockNodes === null) {
          this.w.write(line); // caption-only item
        } else {
          this.w.write(line + ":");
          this.w.indent(() => this.writeBlock(blockNodes));
        }
      });
    });
  }

  // ---------------------------------------------------------------- python, define, default

  private writePython(node: PyObject, early: boolean, prefix = ""): void {
    const code = attr(node, "code");
    const source = pyCodeSource(code).replace(/\s+$/, "");
    const hide = attr(node, "hide", false);
    const store = str(attr(node, "store", "store"));
    let flags = "";
    if (early) flags += " early";
    if (hide) flags += " hide";
    if (store && store !== "store") flags += ` in ${store.replace(/^store\./, "")}`;

    // A one-line `$` statement has its code on the statement's own line.
    const loc = pyCodeLocation(code);
    const sameLine = loc ? loc[1] === lineOf(node) : !source.includes("\n");
    if (!prefix && !early && !flags && sameLine && !source.includes("\n")) {
      this.w.write(`$ ${source.trim()}`);
      return;
    }
    this.w.write(`${prefix}python${flags}:`);
    this.w.indent(() => this.writePythonBody(source, loc ? loc[1] : lineOf(node), lineOf(node)));
  }

  /**
   * Python block sources begin at the code location's line; when that is the statement's
   * own line, the first source line is just the (blank) remainder of `python:`.
   */
  private writePythonBody(source: string, codeLine: number, statementLine: number): void {
    let lines = source.split("\n");
    let firstLine = codeLine;
    if (codeLine === statementLine && lines.length > 1 && lines[0].trim() === "") {
      lines = lines.slice(1);
      firstLine++;
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const firstCode = lines.find((l) => l.trim());
    if (firstCode === undefined) return this.w.write("pass");
    this.w.advanceTo(firstLine);
    this.w.writeSource(lines, firstCode.length - firstCode.trimStart().length);
  }

  private storePrefix(node: PyObject): string {
    const store = str(attr(node, "store", "store"));
    return store && store !== "store" ? store.replace(/^store\./, "") + "." : "";
  }

  private writeDefine(node: PyObject, priority: number | null): void {
    const index = attr<unknown>(node, "index", null);
    const idx = index ? `[${pyCodeSource(index)}]` : "";
    const op = str(attr(node, "operator", "=")) || "=";
    const prio = priority ? ` ${priority}` : "";
    this.w.write(`define${prio} ${this.storePrefix(node)}${str(attr(node, "varname"))}${idx} ${op} ${pyCodeSource(attr(node, "code"))}`);
  }

  private writeDefault(node: PyObject, priority: number | null): void {
    const prio = priority ? ` ${priority}` : "";
    this.w.write(`default${prio} ${this.storePrefix(node)}${str(attr(node, "varname"))} = ${pyCodeSource(attr(node, "code"))}`);
  }

  // ---------------------------------------------------------------- images & transforms

  private writeImage(node: PyObject, priority: number | null): void {
    const name = asArray(attr(node, "imgname", [])).map(str).join(" ");
    const prio = priority ? `init ${priority}:\n    ` : "";
    const code = attr<unknown>(node, "code", null);
    const atl = attr<unknown>(node, "atl", null);
    if (atl) {
      this.writeMaybeInit(prio, () => {
        this.w.write(`image ${name}:`);
        this.w.indent(() => writeAtlBlock(this.w, atl));
      });
    } else {
      this.writeMaybeInit(prio, () => this.w.write(`image ${name} = ${code ? pyCodeSource(code) : "None"}`));
    }
  }

  /** Wrap output in `init N:` when a statement needs an explicit non-default priority. */
  private writeMaybeInit(prio: string, fn: () => void): void {
    if (!prio) return fn();
    this.w.write(prio.split("\n")[0]);
    this.w.indent(fn);
  }

  private writeTransform(node: PyObject, priority: number | null): void {
    const params = attr<unknown>(node, "parameters", null);
    const prio = priority ? ` ${priority}` : "";
    this.w.write(`transform${prio} ${this.storePrefix(node)}${str(attr(node, "varname"))}${params ? formatParameters(params) : ""}:`);
    this.w.indent(() => writeAtlBlock(this.w, attr(node, "atl")));
  }

  private imspec(spec: unknown): string {
    const parts = asArray(spec);
    if (parts.length === 0) return "";
    let name: unknown, expression: unknown = null, tag: unknown = null, atList: unknown = [], layer: unknown = null, zorder: unknown = null, behind: unknown = [];
    if (parts.length === 3) [name, atList, layer] = parts;
    else if (parts.length === 6) [name, expression, tag, atList, layer, zorder] = parts;
    else [name, expression, tag, atList, layer, zorder, behind] = parts;

    const words: string[] = [];
    if (expression !== null && expression !== undefined) words.push("expression", str(expression));
    else words.push(asArray(name).map(str).join(" "));
    if (tag) words.push("as", str(tag));
    const at = asArray(atList).map(str);
    if (at.length) words.push("at", at.join(", "));
    if (layer) words.push("onlayer", str(layer));
    if (zorder !== null && zorder !== undefined) words.push("zorder", str(zorder));
    const b = asArray(behind).map(str);
    if (b.length) words.push("behind", b.join(", "));
    return words.join(" ");
  }

  private takePairedWith(): string {
    const w = this.pairedWith;
    this.pairedWith = null;
    return w ? ` with ${w}` : "";
  }

  private writeShow(node: PyObject): void {
    const atl = attr<unknown>(node, "atl", null);
    const line = `show ${this.imspec(attr(node, "imspec"))}${this.takePairedWith()}`;
    if (atl) {
      this.w.write(line + ":");
      this.w.indent(() => writeAtlBlock(this.w, atl));
    } else {
      this.w.write(line);
    }
  }

  private writeShowLayer(node: PyObject): void {
    const at = asArray(attr(node, "at_list", [])).map(str);
    const atl = attr<unknown>(node, "atl", null);
    let line = `show layer ${str(attr(node, "layer", "master"))}`;
    if (at.length) line += ` at ${at.join(", ")}`;
    if (atl) {
      this.w.write(line + ":");
      this.w.indent(() => writeAtlBlock(this.w, atl));
    } else this.w.write(line);
  }

  private writeCamera(node: PyObject): void {
    const at = asArray(attr(node, "at_list", [])).map(str);
    const atl = attr<unknown>(node, "atl", null);
    const layer = str(attr(node, "layer", "master"));
    let line = "camera";
    if (layer && layer !== "master") line += ` ${layer}`;
    if (at.length) line += ` at ${at.join(", ")}`;
    if (atl) {
      this.w.write(line + ":");
      this.w.indent(() => writeAtlBlock(this.w, atl));
    } else this.w.write(line);
  }

  private writeScene(node: PyObject): void {
    const spec = attr<unknown>(node, "imspec", null);
    const atl = attr<unknown>(node, "atl", null);
    let line = "scene";
    if (spec) line += ` ${this.imspec(spec)}`;
    else {
      const layer = optStr(attr(node, "layer", null));
      if (layer && layer !== "master") line += ` onlayer ${layer}`;
    }
    line += this.takePairedWith();
    if (atl) {
      this.w.write(line + ":");
      this.w.indent(() => writeAtlBlock(this.w, atl));
    } else this.w.write(line);
  }

  private writeHide(node: PyObject): void {
    this.w.write(`hide ${this.imspec(attr(node, "imspec"))}${this.takePairedWith()}`);
  }

  private writeWith(node: PyObject): void {
    const paired = optStr(attr(node, "paired", null));
    const expr = str(attr(node, "expr"));
    if (paired !== null) {
      // First half of `show x with y`: With(None, paired=y) Show With(y).
      this.pairedWith = paired;
      this.skipNextWith = paired;
      return;
    }
    if (this.skipNextWith !== null && expr === this.skipNextWith) {
      this.skipNextWith = null;
      return;
    }
    this.w.write(`with ${expr}`);
  }
  private skipNextWith: string | null = null;

  // ---------------------------------------------------------------- user statements

  private writeUserStatement(node: PyObject): void {
    this.w.write(str(attr(node, "line")));
    const block = asArray(attr(node, "block", []));
    if (block.length) {
      this.w.indent(() => this.writeLexerBlock(block));
      return;
    }
    const codeBlock = asArray(attr(node, "code_block", null));
    if (codeBlock.length) {
      this.w.append(this.w.lines[this.w.lines.length - 1].trimEnd().endsWith(":") ? "" : ":");
      this.w.indent(() => this.writeBlock(codeBlock));
    }
  }

  /** Raw lexer blocks: GroupedLine(filename, number, indent, text, block) or legacy 4-tuples. */
  private writeLexerBlock(block: unknown[]): void {
    for (const entry of block) {
      const t = entry instanceof PyObject ? entry.args : asArray(entry);
      let line: unknown, text: unknown, sub: unknown;
      if (t.length >= 5) [, line, , text, sub] = t;
      else [, line, text, sub] = t;
      if (typeof line === "number") this.w.advanceTo(line);
      this.w.write(str(text));
      const subBlock = asArray(sub);
      if (subBlock.length) this.w.indent(() => this.writeLexerBlock(subBlock));
    }
  }

  // ---------------------------------------------------------------- screens, styles

  private writeScreen(node: PyObject, priority: number | null): void {
    const screen = attr<unknown>(node, "screen");
    const prio = priority ? `init ${priority}:` : "";
    this.writeMaybeInit(prio, () => {
      if (className(screen) === "SLScreen") writeSL2Screen(this.w, screen);
      else {
        this.warn("Legacy screen language (SL1) screens are not decompiled yet");
        this.w.write(`# screen ${str(attr(screen, "name"))}: legacy SL1 screen (not supported yet)`);
      }
    });
  }

  private writeStyle(node: PyObject, priority: number | null): void {
    const words = [`style ${str(attr(node, "style_name"))}`];
    const parent = optStr(attr(node, "parent", null));
    if (parent) words.push(`is ${parent}`);
    if (attr(node, "clear", false)) words.push("clear");
    const take = optStr(attr(node, "take", null));
    if (take) words.push(`take ${take}`);
    for (const d of asArray(attr(node, "delattr", []))) words.push(`del ${str(d)}`);
    const variant = optStr(attr(node, "variant", null));
    if (variant) words.push(`variant ${variant}`);
    const props = [...asMap(attr(node, "properties"))];
    const prio = priority ? `init ${priority}:` : "";
    this.writeMaybeInit(prio, () => {
      if (props.length === 0) {
        this.w.write(words.join(" "));
        return;
      }
      this.w.write(words.join(" ") + ":");
      this.w.indent(() => {
        for (const [k, v] of props) this.w.write(`${str(k)} ${str(v)}`);
      });
    });
  }

  // ---------------------------------------------------------------- translations

  private writeTranslate(node: PyObject): void {
    const language = optStr(attr(node, "language", null));
    const block = asArray(attr(node, "block", []));
    if (language === null) {
      // Default-language translate wrappers are generated; emit the contents only.
      this.writeBlock(block);
      return;
    }
    this.w.write(`translate ${language} ${str(attr(node, "identifier"))}:`);
    this.w.indent(() => this.writeBlock(block));
  }

  private writeTranslateStrings(nodes: unknown[], headerLine: number | null): void {
    let currentLang: string | null = null;
    for (const n of nodes) {
      const lang = str(attr(n, "language")) || "None";
      if (lang !== currentLang) {
        this.w.advanceTo(currentLang === null && headerLine ? headerLine : lineOf(n) - 1);
        this.w.write(`translate ${lang} strings:`);
        currentLang = lang;
      }
      this.w.indent(() => {
        this.w.advanceTo(lineOf(n));
        this.w.write(`old ${quoteString(str(attr(n, "old")))}`);
        const newloc = asArray(attr(n, "newloc", null));
        if (typeof newloc[1] === "number") this.w.advanceTo(newloc[1]);
        this.w.write(`new ${quoteString(str(attr(n, "new")))}`);
      });
    }
  }

  private writeTranslateBlock(node: PyObject, _priority: number | null): void {
    const language = str(attr(node, "language")) || "None";
    const block = asArray(attr(node, "block", []));
    for (const child of block) {
      this.w.advanceTo(lineOf(child));
      const kind = className(child);
      if (kind === "Style") {
        const start = this.w.lines.length;
        this.writeStyle(child as PyObject, null);
        this.w.lines[start] = this.w.lines[start].replace(/^(\s*)style /, `$1translate ${language} style `);
      } else if (kind === "Python" || kind === "EarlyPython") {
        this.writePython(child as PyObject, kind === "EarlyPython", `translate ${language} `);
      } else {
        this.w.write(`translate ${language} block:`);
        this.w.indent(() => this.writeBlock([child]));
      }
    }
  }

  private writeTranslatePython(node: PyObject): void {
    const language = str(attr(node, "language")) || "None";
    this.w.write(`translate ${language} python:`);
    this.w.indent(() => this.w.writeBlock(dedent(pyCodeSource(attr(node, "code")).trim())));
  }

  private writeTestcase(node: PyObject, priority: number | null): void {
    const prio = priority ? `init ${priority}:` : "";
    this.writeMaybeInit(prio, () => {
      const label = has(node, "label") ? str(attr(node, "label")) : str(attr(node, "_name") ?? "");
      this.w.write(`testcase ${label}:`);
      this.w.indent(() => writeTestcase(this.w, attr(node, "test")));
    });
  }
}

/**
 * Canonical say statement text, equivalent to renpy.ast.Say.get_code(). `what` replaces the
 * dialogue text (used when writing translations).
 */
export function sayCode(node: unknown, opts: { inMenu?: boolean; what?: string } = {}): string {
  const parts: string[] = [];
  const who = optStr(attr(node, "who", null));
  if (who) parts.push(who);
  const attrs = asArray(attr(node, "attributes", null));
  if (attrs.length) parts.push(...attrs.map(str));
  const temp = asArray(attr(node, "temporary_attributes", null));
  if (temp.length) parts.push("@", ...temp.map(str));
  parts.push(quoteString(opts.what ?? str(attr(node, "what", ""))));
  if (!opts.inMenu && attr<unknown>(node, "interact", true) === false) parts.push("nointeract");
  const identifier = optStr(attr(node, "identifier", null));
  // TranslateSay always carries a generated identifier; only explicit `id` clauses are code.
  const explicitDefault = className(node) !== "TranslateSay";
  if (identifier && attr<unknown>(node, "explicit_identifier", explicitDefault)) parts.push("id", identifier);
  const args = attr<unknown>(node, "arguments", null);
  let line = parts.join(" ");
  if (args) line += " " + formatArguments(args);
  const withExpr = optStr(attr(node, "with_", null));
  if (withExpr) line += ` with ${withExpr}`;
  return line;
}

function labelName(node: unknown): string {
  const n = attr<unknown>(node, "_name", undefined) ?? attr<unknown>(node, "name", "");
  return typeof n === "string" ? n : str(n);
}
