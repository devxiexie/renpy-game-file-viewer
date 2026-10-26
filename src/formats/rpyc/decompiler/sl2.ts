import { PyGlobal } from "../../pickle/types";
import { formatArguments, formatParameters } from "./args";
import { writeAtlBlock } from "./atl";
import type { Writer } from "./writer";
import { asArray, asMap, attr, className, has, lineOf, pyCodeSource, str } from "./util";

/**
 * Statement keywords for SL2 displayables, keyed by "<displayable class>|<style>".
 * Only needed for Ren'Py < 7, which doesn't store the keyword (`name`) on the node.
 */
const DISPLAYABLE_NAMES: Record<string, string> = {
  "renpy.display.behavior.AreaPicker|default": "areapicker",
  "renpy.display.behavior.Button|button": "button",
  "renpy.display.behavior.DismissBehavior|default": "dismiss",
  "renpy.display.behavior.Input|input": "input",
  "renpy.display.behavior.MouseArea|0": "mousearea",
  "renpy.display.behavior.MouseArea|None": "mousearea",
  "renpy.display.behavior.OnEvent|0": "on",
  "renpy.display.behavior.OnEvent|None": "on",
  "renpy.display.behavior.Timer|default": "timer",
  "renpy.display.dragdrop.Drag|drag": "drag",
  "renpy.display.dragdrop.Drag|None": "drag",
  "renpy.display.dragdrop.DragGroup|None": "draggroup",
  "renpy.display.layout.Grid|grid": "grid",
  "renpy.display.layout.MultiBox|fixed": "fixed",
  "renpy.display.layout.MultiBox|hbox": "hbox",
  "renpy.display.layout.MultiBox|vbox": "vbox",
  "renpy.display.layout.NearRect|default": "nearrect",
  "renpy.display.layout.Null|default": "null",
  "renpy.display.layout.Side|side": "side",
  "renpy.display.layout.Window|frame": "frame",
  "renpy.display.layout.Window|window": "window",
  "renpy.display.motion.Transform|transform": "transform",
  "renpy.sl2.sldisplayables.sl2add|None": "add",
  "renpy.sl2.sldisplayables.sl2bar|None": "bar",
  "renpy.sl2.sldisplayables.sl2vbar|None": "vbar",
  "renpy.sl2.sldisplayables.sl2viewport|viewport": "viewport",
  "renpy.sl2.sldisplayables.sl2vpgrid|vpgrid": "vpgrid",
  "renpy.text.text.Text|text": "text",
  "renpy.ui._hotbar|hotbar": "hotbar",
  "renpy.ui._hotspot|hotspot": "hotspot",
  "renpy.ui._imagebutton|image_button": "imagebutton",
  "renpy.ui._imagemap|imagemap": "imagemap",
  "renpy.ui._key|None": "key",
  "renpy.ui._label|label": "label",
  "renpy.ui._textbutton|button": "textbutton",
  "renpy.ui._textbutton|0": "textbutton",
};

const DISPLAYABLE_BY_CLASS: Record<string, string> = {
  "renpy.display.behavior.OnEvent": "on",
  "renpy.display.behavior.MouseArea": "mousearea",
  "renpy.display.dragdrop.DragGroup": "draggroup",
  "renpy.sl2.sldisplayables.sl2add": "add",
  "renpy.sl2.sldisplayables.sl2bar": "bar",
  "renpy.sl2.sldisplayables.sl2vbar": "vbar",
  "renpy.ui._key": "key",
  "renpy.ui._textbutton": "textbutton",
  "renpy.ui._imagebutton": "imagebutton",
  "renpy.ui._label": "label",
  "renpy.text.text.Text": "text",
  "renpy.display.layout.Null": "null",
};

function displayableName(node: unknown): string {
  const name = attr<unknown>(node, "name", null);
  if (typeof name === "string" && name) return name;
  const d = attr<unknown>(node, "displayable", null);
  const cls = d instanceof PyGlobal ? d.fullName : str(d);
  const style = attr<unknown>(node, "style", null);
  const styleKey = style === null || style === undefined ? "None" : str(style);
  const layout = asMap(attr(node, "default_keywords")).get("layout");
  if (cls === "renpy.display.layout.MultiBox" && typeof layout === "string") {
    return { horizontal: "hbox", vertical: "vbox", fixed: "fixed" }[layout] ?? "fixed";
  }
  return DISPLAYABLE_NAMES[`${cls}|${styleKey}`] ?? DISPLAYABLE_BY_CLASS[cls] ?? `# unknown displayable ${cls}`;
}

const SCREEN_DEFAULTS: Record<string, string | null> = {
  modal: "False",
  zorder: "0",
  variant: "None",
  predict: "None",
  sensitive: "True",
  layer: "'screens'",
  roll_forward: "None",
};

export function writeSL2Screen(w: Writer, screen: unknown): void {
  const name = str(attr(screen, "name"));
  const params = attr<unknown>(screen, "parameters", null);
  w.write(`screen ${name}${params ? formatParameters(params) : ""}:`);
  w.indent(() => {
    const props: string[] = [];
    const tag = attr<unknown>(screen, "tag", null);
    if (tag !== null && tag !== undefined) props.push(`tag ${str(tag)}`);
    for (const [key, def] of Object.entries(SCREEN_DEFAULTS)) {
      if (!has(screen, key)) continue;
      const v = attr<unknown>(screen, key, null);
      if (v === null || v === undefined) continue;
      if (str(v) !== def) props.push(`${key} ${str(v)}`);
    }
    for (const p of props) w.write(p);
    writeKeywordsAndChildren(w, screen, props.length > 0);
  });
}

/** Write the `keyword` list as property lines, then the children. */
function writeKeywordsAndChildren(w: Writer, node: unknown, hadContent = false): void {
  let wrote = hadContent;
  for (const pair of asArray(attr(node, "keyword", []))) {
    const [k, v] = asArray(pair);
    writeKeyword(w, str(k), v);
    wrote = true;
  }
  const children = asArray(attr(node, "children", []));
  for (const child of children) {
    writeSLNode(w, child);
    wrote = true;
  }
  if (!wrote) w.write("pass");
}

function writeKeyword(w: Writer, key: string, value: unknown): void {
  if (className(value) === "RawBlock") {
    // `at transform:` with an inline ATL block
    w.advanceTo(lineOf(value) - 1);
    w.write(`${key} transform:`);
    w.indent(() => writeAtlBlock(w, value));
    return;
  }
  if (value === null || value === undefined) w.write(key);
  else w.write(`${key} ${str(value)}`);
}

function writeSLNode(w: Writer, node: unknown): void {
  w.advanceTo(lineOf(node));
  switch (className(node)) {
    case "SLDisplayable":
      return writeDisplayable(w, node);
    case "SLIf":
      return writeIf(w, node, "if");
    case "SLShowIf":
      return writeIf(w, node, "showif");
    case "SLBlock":
      // Anonymous block (e.g. `has` content or generated); emit its content inline.
      return writeKeywordsAndChildren(w, node, true);
    case "SLFor":
      return writeFor(w, node);
    case "SLPython":
      return writePython(w, node);
    case "SLPass":
      return w.write("pass");
    case "SLDefault":
      return w.write(`default ${str(attr(node, "variable"))} = ${str(attr(node, "expression"))}`);
    case "SLUse":
      return writeUse(w, node);
    case "SLTransclude":
      return w.write("transclude");
    case "SLContinue":
      return w.write("continue");
    case "SLBreak":
      return w.write("break");
    case "SLCustomUse":
      return w.write(`# custom use statement`);
    default:
      w.write(`# Unsupported screen statement: ${className(node)}`);
  }
}

function writeDisplayable(w: Writer, node: unknown): void {
  const name = displayableName(node);
  const parts = [name, ...asArray(attr(node, "positional", [])).map(str)];
  const variable = attr<unknown>(node, "variable", null);
  if (variable) parts.push("as", str(variable));
  const keywords = asArray(attr(node, "keyword", []));
  const children = asArray(attr(node, "children", []));

  // Simple displayables with only a couple of plain keywords fit on one line.
  const inlineable = children.length === 0 && keywords.every((p) => className(asArray(p)[1]) !== "RawBlock");
  if (inlineable && keywords.length <= 2) {
    for (const pair of keywords) {
      const [k, v] = asArray(pair);
      parts.push(str(k));
      if (v !== null && v !== undefined) parts.push(str(v));
    }
    w.write(parts.join(" "));
    return;
  }
  w.write(parts.join(" ") + ":");
  w.indent(() => writeKeywordsAndChildren(w, node));
}

function writeIf(w: Writer, node: unknown, keyword: string): void {
  asArray(attr(node, "entries", [])).forEach((entry, i) => {
    const [cond, block] = asArray(entry);
    if (i > 0) w.advanceTo(lineOf(block));
    if (i === 0) w.write(`${keyword} ${str(cond)}:`);
    else if (cond === null || cond === undefined || str(cond) === "True") w.write("else:");
    else w.write(`elif ${str(cond)}:`);
    w.indent(() => writeKeywordsAndChildren(w, block));
  });
}

function writeFor(w: Writer, node: unknown): void {
  let variable = str(attr(node, "variable"));
  let children = asArray(attr(node, "children", []));
  // Tuple unpacking compiles to `for _sl2_i in x:` + `$ a, b = _sl2_i`.
  if (variable === "_sl2_i" && className(children[0]) === "SLPython") {
    const src = pyCodeSource(attr(children[0], "code")).trim();
    const m = /^(.*?)\s*=\s*_sl2_i$/.exec(src);
    if (m) {
      variable = m[1];
      children = children.slice(1);
    }
  }
  const index = attr<unknown>(node, "index_expression", null);
  const head = `for ${variable}${index ? ` index ${str(index)}` : ""} in ${str(attr(node, "expression"))}:`;
  w.write(head);
  w.indent(() => {
    for (const pair of asArray(attr(node, "keyword", []))) {
      const [k, v] = asArray(pair);
      writeKeyword(w, str(k), v);
    }
    if (children.length === 0 && asArray(attr(node, "keyword", [])).length === 0) w.write("pass");
    for (const c of children) writeSLNode(w, c);
  });
}

function writePython(w: Writer, node: unknown): void {
  const src = pyCodeSource(attr(node, "code"));
  const trimmed = src.replace(/\s+$/, "");
  if (!trimmed.includes("\n")) {
    w.write(`$ ${trimmed.trim()}`);
  } else {
    w.write("python:");
    w.indent(() => w.writeBlock(dedent(trimmed)));
  }
}

function writeUse(w: Writer, node: unknown): void {
  const target = attr<unknown>(node, "target", null);
  let head = "use ";
  if (target !== null && typeof target === "object" && !(typeof target === "string") && className(target) === "PyExpr") {
    head += `expression ${str(target)}`;
  } else {
    head += str(target);
  }
  const args = attr<unknown>(node, "args", null);
  if (args) {
    const a = formatArguments(args);
    head += typeof target === "string" ? a : ` pass ${a}`;
  }
  const id = attr<unknown>(node, "id", null);
  if (id) head += ` id ${str(id)}`;
  const block = attr<unknown>(node, "block", null);
  if (block) {
    w.write(head + ":");
    w.indent(() => writeKeywordsAndChildren(w, block));
  } else {
    w.write(head);
  }
}

export function dedent(text: string): string {
  const lines = text.split("\n");
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    min = Math.min(min, l.length - l.trimStart().length);
  }
  if (!Number.isFinite(min) || min === 0) return text;
  return lines.map((l) => l.slice(Math.min(min, l.length - l.trimStart().length))).join("\n");
}
