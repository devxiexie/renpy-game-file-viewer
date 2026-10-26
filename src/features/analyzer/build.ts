import { readSource } from "../../core/vfs/source";
import { PyObject } from "../../formats/pickle/types";
import { readRpyc } from "../../formats/rpyc/container";
import { formatParameters } from "../../formats/rpyc/decompiler/args";
import { asArray, attr, className, lineOf, optStr, pyCodeSource, str } from "../../formats/rpyc/decompiler/util";
import { evalPyStrings } from "../translate/pystring";
import { analyzeIndex } from "./analysis";
import {
  audioCalls, COMPARE_RE, deepStrings, emptyGallery, newGalleryScan, parseAudioStatement, replayTargets, resolveAudio, scanGalleryCode, scanGalleryThumbnails, screenConditions,
  type AudioRef, type GalleryScan,
} from "./extras";
import type {
  AnalyzerIndex, AnalyzerInput, CharacterInfo, ChoiceItem, Edge, FileStats, Gate, ImageInfo, ImageUse, LabelInfo, LayeredLayer, Loc, MenuInfo,
  ReplayInfo, SceneEvent, SceneInfo, VarRef, VariableInfo, Via,
} from "./model";

const ENTRY_LABELS = new Set(["start", "splashscreen", "main_menu", "before_main_menu", "after_load", "after_warp", "quit", "_start"]);
const CHARACTER_RE = /^\s*(?:[\w.]+\.)?(Character|DynamicCharacter|NVLCharacter|ADVCharacter|Speaker)\s*\(/;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|avif|svg|gif|bmp)$/i;
const ENDS_GAME_RE = /\brenpy\.(full_restart|quit|utter_restart)\s*\(|\bMainMenu\s*\(/;

/** Words of dialogue, ignoring {text tags} and [interpolations]. */
export function countWords(text: string): number {
  const plain = text.replace(/\{[^{}]*\}/g, " ").replace(/\[[^[\]]*\]/g, "x");
  const m = plain.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}

export function labelNameOf(node: unknown): string {
  const n = attr<unknown>(node, "_name", undefined) ?? attr<unknown>(node, "name", "");
  return typeof n === "string" ? n : str(n);
}

/** First string argument / keyword arguments of a call expression like Character("Eileen", color="#fff"). */
function parseCall(src: string): { first: string | null; kwargs: Record<string, string> } {
  const open = src.indexOf("(");
  const body = open >= 0 ? src.slice(open + 1, src.lastIndexOf(")")) : "";
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += body[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  const kwargs: Record<string, string> = {};
  let first: string | null = null;
  args.forEach((a, i) => {
    const kw = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    if (kw) kwargs[kw[1]] = kw[2];
    else if (i === 0) first = a;
  });
  return { first, kwargs };
}

/** Value of a string literal expression, also unwrapping _("...") / __("..."). */
export function literal(expr: string | null | undefined): string | null {
  if (!expr) return null;
  const t = expr.trim();
  const m = /^_{1,3}\s*\(([\s\S]*)\)$/.exec(t);
  return evalPyStrings(m ? m[1].trim() : t);
}

interface Ctx {
  fileId: string;
  file: string;
  label: string | null;
  conditional: boolean;
  inInit: boolean;
  /** Menu option whose block is being walked (collects its words and writes). */
  item?: ChoiceItem;
  /** Decisions (menu options, conditions) enclosing the statement. */
  via: Via[];
}

interface Builder {
  labels: Map<string, LabelInfo>;
  edges: Edge[];
  characters: Map<string, CharacterInfo>;
  images: Map<string, ImageInfo>;
  imageUses: ImageUse[];
  menus: MenuInfo[];
  vars: Map<string, VariableInfo>;
  scenes: SceneInfo[];
  pythonCode: { code: string; ctx: Ctx; loc: Loc }[];
  pythonBlocks: number;
  screens: number;
  transforms: number;
  game: { name: string | null; version: string | null };
  conditions: { code: string; ctx: Ctx; loc: Loc; gate?: Gate; screen?: string }[];
  /** Screen expressions that may compare variables (If(), SensitiveIf(), python…). */
  screenReads: { code: string; ctx: Ctx; loc: Loc; screen: string }[];
  sayTexts: { text: string; ctx: Ctx; loc: Loc }[];
  currentScene: SceneInfo | null;
  fileStats: Map<string, FileStats>;
  audioRefs: AudioRef[];
  audioDefines: Map<string, { code: string; loc: Loc }>;
  galleryScan: GalleryScan;
  /** Screen strings, scanned for gallery thumbnails once every Gallery is known. */
  screenCode: string[];
  replays: ReplayInfo[];
  persistentInScreens: Record<string, string[]>;
}

function locOf(ctx: Ctx, node: unknown): Loc {
  return { fileId: ctx.fileId, file: ctx.file, line: lineOf(node) };
}

function variable(b: Builder, name: string): VariableInfo {
  let v = b.vars.get(name);
  if (!v) {
    v = {
      name,
      declared: null,
      initial: null,
      refs: [],
      category: "other",
      facts: { needsAtLeast: null, checkedAtMost: null, assignedMax: null, increments: 0, decrements: 0, maxIncrement: null, booleans: false },
      tags: [],
      command: null,
      score: 0,
    };
    b.vars.set(name, v);
  }
  return v;
}

export function imageName(spec: unknown): { name: string; tag: string; expression: string | null; at: string[]; asTag: string | null } {
  const parts = asArray(spec);
  let name: unknown, expression: unknown = null, tag: unknown = null, at: unknown = [];
  if (parts.length === 3) [name, at] = parts;
  else [name, expression, tag, at] = parts;
  const n = asArray(name).map(str).join(" ");
  return {
    name: n,
    tag: tag ? str(tag) : (n.split(" ")[0] ?? ""),
    expression: expression ? str(expression) : null,
    at: asArray(at).map(str),
    asTag: tag ? str(tag) : null,
  };
}

function sceneFor(b: Builder, ctx: Ctx, node: unknown, background: string | null): SceneInfo {
  const s: SceneInfo = { id: b.scenes.length, label: ctx.label ?? "(init)", loc: locOf(ctx, node), background, dialogue: 0, events: [] };
  b.scenes.push(s);
  b.currentScene = s;
  return s;
}

function pushEvent(b: Builder, ctx: Ctx, node: unknown, ev: SceneEvent) {
  if (!ctx.label) return;
  const scene = b.currentScene && b.currentScene.label === ctx.label ? b.currentScene : sceneFor(b, ctx, node, null);
  scene.events.push(ev);
  if (ev.type === "say") scene.dialogue++;
}

/** True if control can't continue past the end of this block. */
function terminates(block: unknown[]): boolean {
  const last = block[block.length - 1];
  const k = className(last);
  if (k === "Return" || k === "Jump") return true;
  if (k === "Menu") {
    const items = asArray(attr(last, "items", [])).map((it) => asArray(it)[2]).filter((b) => Array.isArray(b)) as unknown[][];
    return items.length > 0 && items.every(terminates);
  }
  if (k === "If") {
    const entries = asArray(attr(last, "entries", []));
    const hasElse = entries.some((e) => {
      const c = asArray(e)[0];
      return c === null || str(c) === "True";
    });
    return hasElse && entries.every((e) => terminates(asArray(asArray(e)[1])));
  }
  return false;
}

function resolveTarget(target: string, ctx: Ctx): string {
  if (target.startsWith(".") && ctx.label) return ctx.label.split(".")[0] + target;
  return target;
}

function walkBlock(b: Builder, nodes: unknown[], ctx: Ctx) {
  for (let i = 0; i < nodes.length; i++) walkNode(b, nodes[i], ctx, nodes, i);
}

function addEdge(b: Builder, ctx: Ctx, node: unknown, to: string, kind: Edge["kind"], dynamic = false) {
  if (!ctx.label) return;
  b.edges.push({ from: ctx.label, to, kind, loc: locOf(ctx, node), conditional: ctx.conditional, dynamic: dynamic || undefined, via: ctx.via.length ? ctx.via : undefined });
}

function walkNode(b: Builder, node: unknown, ctx: Ctx, siblings: unknown[], index: number) {
  if (!(node instanceof PyObject)) return;
  const k = node.className;
  const loc = locOf(ctx, node);
  const label = ctx.label ? b.labels.get(ctx.label) : undefined;

  switch (k) {
    case "Init":
      walkBlock(b, asArray(attr(node, "block", [])), { ...ctx, inInit: true });
      return;
    case "Label": {
      const name = labelNameOf(node);
      const block = asArray(attr(node, "block", []));
      // `menu name:` and `call x from y` create empty labels; they don't start new story sections.
      const isMenuName = block.length === 0 && className(siblings[index + 1]) === "Menu" && lineOf(siblings[index + 1]) === lineOf(node);
      const isCallFrom = block.length === 0 && className(siblings[index - 1]) === "Call" && lineOf(siblings[index - 1]) === lineOf(node);
      if (isMenuName || isCallFrom) return;
      const params = attr<unknown>(node, "parameters", null);
      const info: LabelInfo = {
        name,
        loc,
        parameters: params ? formatParameters(params) : null,
        dialogue: 0,
        words: 0,
        menus: 0,
        entry: ENTRY_LABELS.has(name),
        ending: "fallthrough",
        visuals: 0,
        background: null,
        writes: 0,
        reachable: false,
        score: 0,
        preview: [],
        last: null,
        endsGame: false,
        replay: false,
      };
      b.labels.set(name, info);
      const fs = b.fileStats.get(ctx.fileId);
      if (fs) fs.labels++;
      const inner: Ctx = { ...ctx, label: name, conditional: false, via: [] };
      b.currentScene = null;
      walkBlock(b, block, inner);
      const last = className(block[block.length - 1]);
      if (block.length && terminates(block)) info.ending = last === "Return" ? "return" : last === "Menu" ? "menu" : "jump";
      // Execution continues with the next label in the file when the block runs off its end.
      if (block.length === 0 || !terminates(block)) {
        const next = siblings.slice(index + 1).find((n) => className(n) === "Label" && asArray(attr(n, "block", [])).length > 0);
        if (next) b.edges.push({ from: name, to: labelNameOf(next), kind: "fallthrough", loc: { ...loc, line: lineOf(next) }, conditional: false });
      }
      return;
    }
    case "Say":
    case "TranslateSay": {
      const what = str(attr(node, "what", ""));
      const whoExpr = optStr(attr(node, "who", null));
      const words = countWords(what);
      if (label) {
        label.dialogue++;
        label.words += words;
        if (label.preview.length < 2) label.preview.push({ who: whoExpr, what });
        label.last = { who: whoExpr, what };
      }
      const fs = b.fileStats.get(ctx.fileId);
      if (fs) {
        fs.dialogue++;
        fs.words += words;
      }
      const id = whoExpr ? (literal(whoExpr) ?? whoExpr) : "narrator";
      let ch = b.characters.get(id);
      if (!ch) {
        ch = { id, name: whoExpr && literal(whoExpr) !== null ? literal(whoExpr) : whoExpr ? null : "Narrator", defined: false, color: null, image: null, kind: null, loc: null, lines: 0, words: 0, labels: {}, sample: null, portrait: null, share: 0 };
        b.characters.set(id, ch);
      }
      ch.lines++;
      ch.words += words;
      if (!ch.sample && what.length > 8) ch.sample = what;
      if (ctx.label) ch.labels[ctx.label] = (ch.labels[ctx.label] ?? 0) + 1;
      b.sayTexts.push({ text: what, ctx, loc });
      if (ctx.item) {
        ctx.item.lines++;
        ctx.item.words += words;
      }
      // A say with interact=False directly before a menu is the menu's caption, shown as part of it.
      const captionOfMenu = attr<unknown>(node, "interact", true) === false && className(siblings[index + 1]) === "Menu";
      if (!captionOfMenu) pushEvent(b, ctx, node, { type: "say", who: whoExpr, what, loc });
      return;
    }
    case "Menu": {
      if (label) label.menus++;
      const prev = siblings[index - 1];
      const caption =
        className(prev) === "Say" && attr<unknown>(prev, "interact", true) === false
          ? { who: optStr(attr(prev, "who", null)), what: str(attr(prev, "what", "")) }
          : null;
      const prevLabel = className(prev) === "Label" && lineOf(prev) === lineOf(node) ? labelNameOf(prev) : null;
      const menu: MenuInfo = { id: b.menus.length, loc, label: ctx.label, name: prevLabel, caption, items: [], impact: 0, important: false };
      b.menus.push(menu);
      const setVar = optStr(attr(node, "set", null));
      if (setVar) b.conditions.push({ code: setVar, ctx, loc });
      for (const raw of asArray(attr(node, "items", []))) {
        const [textV, condV, blockV] = asArray(raw);
        const text = str(textV);
        const cond = optStr(condV);
        if (blockV === null || blockV === undefined) {
          if (!menu.caption) menu.caption = { who: null, what: text };
          continue;
        }
        const block = asArray(blockV);
        if (cond && cond !== "True") b.conditions.push({ code: cond, ctx, loc, gate: { kind: "choice", text } });
        const item: ChoiceItem = {
          text,
          condition: cond && cond !== "True" ? cond : null,
          targets: [],
          lines: 0,
          words: 0,
          writes: [],
          outcome: "shared",
          rejoin: null,
          uniqueLabels: [],
          uniqueLines: 0,
          uniqueWords: 0,
          major: false,
          visuals: [],
        };
        const before = b.edges.length;
        const via: Via = { kind: "choice", menu: menu.id, item: menu.items.length, text, condition: item.condition };
        walkBlock(b, block, { ...ctx, conditional: true, item, via: [...ctx.via, via] });
        item.targets = [...new Set(b.edges.slice(before).filter((e) => e.kind !== "fallthrough" && !e.dynamic).map((e) => e.to))];
        // Nested options also count towards the enclosing option.
        if (ctx.item) {
          ctx.item.lines += item.lines;
          ctx.item.words += item.words;
          ctx.item.writes.push(...item.writes.filter((w) => !ctx.item!.writes.includes(w)));
          ctx.item.visuals.push(...item.visuals.filter((w) => !ctx.item!.visuals.includes(w)));
        }
        menu.items.push(item);
      }
      pushEvent(b, ctx, node, { type: "menu", items: menu.items.map((i) => i.text), loc });
      return;
    }
    case "If": {
      const earlier: string[] = [];
      for (const e of asArray(attr(node, "entries", []))) {
        const [cond, block] = asArray(e);
        const c = optStr(cond);
        const isElse = !c || c === "True";
        const gate: Gate = { kind: "branch", targets: [], elif: earlier.length > 0 };
        if (!isElse) b.conditions.push({ code: c, ctx, loc: earlier.length ? locOf(ctx, asArray(block)[0] ?? node) : loc, gate });
        if (!isElse && label && /\b_in_replay\b/.test(c)) label.replay = true;
        const via: Via = isElse ? { kind: "else", not: [...earlier] } : { kind: "condition", code: c };
        const before = b.edges.length;
        walkBlock(b, asArray(block), { ...ctx, conditional: true, via: [...ctx.via, via] });
        gate.targets = [...new Set(b.edges.slice(before).filter((x) => x.kind !== "fallthrough" && !x.dynamic).map((x) => x.to))];
        if (!isElse) earlier.push(c);
      }
      return;
    }
    case "While": {
      const c = str(attr(node, "condition"));
      b.conditions.push({ code: c, ctx, loc, gate: { kind: "loop" } });
      walkBlock(b, asArray(attr(node, "block", [])), { ...ctx, conditional: true, via: [...ctx.via, { kind: "condition", code: c }] });
      return;
    }
    case "Jump":
    case "Call": {
      const isJump = k === "Jump";
      const raw = str(attr(node, isJump ? "target" : "label"));
      if (attr(node, "expression", false)) {
        const lit = literal(raw);
        addEdge(b, ctx, node, lit ?? raw, isJump ? "jump" : "call", lit === null);
      } else {
        addEdge(b, ctx, node, resolveTarget(raw, ctx), isJump ? "jump" : "call");
      }
      return;
    }
    case "Python": {
      const code = pyCodeSource(attr(node, "code"));
      b.pythonBlocks++;
      if (!ctx.inInit && ctx.label) b.pythonCode.push({ code, ctx, loc });
      scanGalleryCode(b.galleryScan, code, loc);
      for (const r of replayTargets(code)) b.replays.push({ label: r, loc, screen: null });
      if (label) {
        if (ENDS_GAME_RE.test(code)) label.endsGame = true;
        if (/\brenpy\.end_replay\s*\(/.test(code)) label.replay = true;
        for (const a of audioCalls(code)) b.audioRefs.push({ expr: a.expr, use: { channel: a.channel, statement: a.statement, loc, label: ctx.label } });
      }
      if (ctx.item) {
        for (const line of code.split("\n")) {
          const m = ASSIGN_RE.exec(line) ?? MUTATE_RE.exec(line);
          if (m && !ctx.item.writes.includes(m[1])) ctx.item.writes.push(m[1]);
        }
      }
      return;
    }
    case "Define":
    case "Default": {
      const store = str(attr(node, "store", "store"));
      const varname = str(attr(node, "varname"));
      const name = store && store !== "store" ? `${store.replace(/^store\./, "")}.${varname}` : varname;
      const code = pyCodeSource(attr(node, "code"));
      if (k === "Define" && name === "config.name") b.game.name = literal(code) ?? b.game.name;
      if (k === "Define" && name === "config.version") b.game.version = literal(code) ?? b.game.version;
      if (name.startsWith("audio.")) {
        b.audioDefines.set(name.slice(6), { code, loc });
        return;
      }
      if (name === "config.main_menu_music") b.audioRefs.push({ expr: code, use: { channel: "music", statement: "config", loc, label: null } });
      if (k === "Define" && CHARACTER_RE.test(code)) {
        const { first, kwargs } = parseCall(code);
        const kind = CHARACTER_RE.exec(code)![1];
        const displayName = kind === "DynamicCharacter" ? `[${literal(first) ?? first}]` : literal(first);
        const existing = b.characters.get(name);
        b.characters.set(name, {
          ...(existing ?? { lines: 0, words: 0, labels: {}, sample: null, portrait: null, share: 0 }),
          id: name,
          name: displayName,
          defined: true,
          color: literal(kwargs.color) ?? kwargs.color ?? null,
          image: literal(kwargs.image) ?? null,
          kind: kwargs.kind ?? (kind === "NVLCharacter" ? "nvl" : null),
          loc,
        });
        return;
      }
      // Engine configuration isn't game state.
      if (/^(config|gui|build|style|preferences|_)/.test(name) || name.startsWith("renpy.")) return;
      const v = variable(b, name);
      if (!v.declared) {
        v.declared = k === "Default" ? "default" : "define";
        v.initial = code;
      }
      v.refs.push({ kind: "declare", loc, label: null, code: `${k.toLowerCase()} ${name} = ${code}` });
      return;
    }
    case "Image": {
      const name = asArray(attr(node, "imgname", [])).map(str).join(" ");
      const code = attr<unknown>(node, "code", null);
      const atl = attr<unknown>(node, "atl", null);
      const expr = code ? pyCodeSource(code) : null;
      let kind: ImageInfo["kind"] = "expression";
      let file: string | null = null;
      if (atl) {
        kind = "atl";
        const firstExpr = asArray(attr(atl, "statements", [])).flatMap((st) => asArray(attr(st, "expressions", []))).map((p) => str(asArray(p)[0]))[0];
        file = literal(firstExpr);
      } else if (expr) {
        const lit = literal(expr);
        if (lit !== null) {
          kind = "file";
          file = lit;
        } else if (/^\s*Movie\s*\(/.test(expr)) {
          kind = "movie";
          const { first, kwargs } = parseCall(expr);
          const play = literal(kwargs.play ?? first);
          b.images.set(asArray(attr(node, "imgname", [])).map(str).join(" "), { name, tag: name.split(" ")[0], attributes: name.split(" ").slice(1), kind, code: expr, file: null, movie: play, loc, uses: 0 });
          return;
        } else if (/^\s*(?:im\.)?(?:Composite|LiveComposite)\s*\(/.test(expr)) {
          const composite = parseComposite(expr);
          if (composite) {
            b.images.set(name, { name, tag: name.split(" ")[0], attributes: name.split(" ").slice(1), kind: "composite", code: expr, file: null, composite, loc, uses: 0 });
            return;
          }
        }
        else if (/^\s*Solid\s*\(/.test(expr)) kind = "solid";
        else if (/^\s*(?:im\.)?Image\s*\(/.test(expr)) {
          kind = "file";
          file = literal(parseCall(expr).first);
        }
      }
      const [tag, ...attributes] = name.split(" ");
      b.images.set(name, { name, tag, attributes, kind, code: expr ?? (atl ? "ATL" : null), file, loc, uses: 0 });
      return;
    }
    case "UserStatement": {
      const line = str(attr(node, "line"));
      const audio = parseAudioStatement(line);
      if (audio) {
        // A voice statement belongs to the next line of dialogue.
        const next = audio.statement === "voice" ? siblings.slice(index + 1, index + 4).find((n) => className(n) === "Say" || className(n) === "TranslateSay") : undefined;
        const spoken = next ? { who: optStr(attr(next, "who", null)), what: str(attr(next, "what", "")) } : audio.statement === "voice" ? null : undefined;
        b.audioRefs.push({ expr: audio.expr, use: { channel: audio.channel, statement: audio.statement, loc, label: ctx.label, line: spoken } });
        return;
      }
      if (/^layeredimage\s/.test(line)) {
        const name = line.replace(/^layeredimage\s+/, "").replace(/:\s*$/, "").trim();
        const layers = parseLayeredImage(name, asArray(attr(node, "block", [])));
        const [tag, ...attributes] = name.split(/\s+/);
        b.images.set(name, { name, tag, attributes, kind: "layered", code: line, file: null, loc, layers, uses: 0 });
      }
      return;
    }
    case "Scene": {
      const spec = attr<unknown>(node, "imspec", null);
      const img = spec ? imageName(spec) : null;
      if (img && ctx.label !== null) b.imageUses.push({ image: img.expression ?? img.name, statement: "scene", loc, label: ctx.label });
      if (label) {
        label.visuals++;
        if (!label.background && img && !img.expression) label.background = img.name;
      }
      if (ctx.item && img && !img.expression && !ctx.item.visuals.includes(img.name)) ctx.item.visuals.push(img.name);
      if (ctx.label) {
        sceneFor(b, ctx, node, img ? (img.expression ? null : img.name) : null);
        pushEvent(b, ctx, node, { type: "scene", image: img ? (img.expression ? null : img.name) : null, loc });
      }
      return;
    }
    case "Show": {
      const img = imageName(attr(node, "imspec"));
      if (label) label.visuals++;
      if (ctx.item && !img.expression && !ctx.item.visuals.includes(img.name)) ctx.item.visuals.push(img.name);
      if (!img.expression) {
        b.imageUses.push({ image: img.name, statement: "show", loc, label: ctx.label });
        pushEvent(b, ctx, node, { type: "show", image: img.name, tag: img.asTag ?? img.tag, at: img.at, loc });
      }
      return;
    }
    case "Hide": {
      const img = imageName(attr(node, "imspec"));
      b.imageUses.push({ image: img.name, statement: "hide", loc, label: ctx.label });
      pushEvent(b, ctx, node, { type: "hide", tag: img.asTag ?? img.tag, loc });
      return;
    }
    case "With": {
      const expr = str(attr(node, "expr"));
      if (expr && expr !== "None") pushEvent(b, ctx, node, { type: "with", transition: expr, loc });
      return;
    }
    case "Translate":
      walkBlock(b, asArray(attr(node, "block", [])), ctx);
      return;
    case "Screen": {
      b.screens++;
      const screen = attr<unknown>(node, "screen", null);
      const name = str(attr(screen, "name", "")) || "screen";
      const strings = deepStrings(screen);
      for (const code of strings) {
        if (code.includes("Replay")) for (const r of replayTargets(code)) b.replays.push({ label: r, loc, screen: name });
        if (code.includes("Play") || code.includes("Queue") || code.includes("renpy.")) {
          for (const a of audioCalls(code)) b.audioRefs.push({ expr: a.expr, use: { channel: a.channel, statement: a.statement, loc, label: null } });
        }
        for (const m of code.matchAll(/\bpersistent\.(\w+)/g)) {
          const list = (b.persistentInScreens[`persistent.${m[1]}`] ??= []);
          if (!list.includes(name)) list.push(name);
        }
      }
      b.screenCode.push(...strings.filter((c) => c.includes(".make_button")));
      const sctx: Ctx = { ...ctx, label: null, conditional: true, via: [] };
      const conds = screenConditions(screen);
      for (const c of conds) b.conditions.push({ code: c.code, ctx: sctx, loc: { ...loc, line: c.line || loc.line }, screen: name, gate: { kind: "screen", screen: name, showif: c.showif } });
      const condCodes = new Set(conds.map((c) => c.code));
      for (const code of strings) if (!condCodes.has(code) && COMPARE_RE.test(code)) b.screenReads.push({ code, ctx: sctx, loc, screen: name });
      return;
    }
    case "Transform":
      b.transforms++;
      return;
  }
}

/** Composite((w, h), (x, y), d1, (x, y), d2, ...) → sized layer list. */
export function parseComposite(expr: string): ImageInfo["composite"] | null {
  const open = expr.indexOf("(");
  const inner = expr.slice(open + 1, expr.lastIndexOf(")"));
  const args: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (quote) {
      cur += c;
      if (c === "\\") cur += inner[++i] ?? "";
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    if (c === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) args.push(cur.trim());
  const pos = (s: string) => {
    const m = /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/.exec(s);
    return m ? [Number(m[1]), Number(m[2])] : null;
  };
  const positional = args.filter((a) => !/^[A-Za-z_]\w*\s*=(?!=)/.test(a));
  const size = pos(positional[0] ?? "");
  if (!size) return null;
  const parts: { x: number; y: number; displayable: string }[] = [];
  for (let i = 1; i + 1 < positional.length; i += 2) {
    const p = pos(positional[i]);
    const d = literal(positional[i + 1]) ?? positional[i + 1];
    if (p) parts.push({ x: p[0], y: p[1], displayable: d });
  }
  return { width: size[0], height: size[1], parts };
}

/** Parse the raw lines of a `layeredimage` block (GroupedLine or legacy tuples). */
export function parseLayeredImage(imageName: string, block: unknown[]): LayeredLayer[] {
  const layers: LayeredLayer[] = [];
  const base = imageName.replace(/\s+/g, "_");
  const lineOf = (e: unknown): { text: string; sub: unknown[] } => {
    const t = e instanceof PyObject ? e.args : asArray(e);
    return t.length >= 5 ? { text: str(t[3]).trim(), sub: asArray(t[4]) } : { text: str(t[2]).trim(), sub: asArray(t[3]) };
  };
  const displayableIn = (sub: unknown[], inline: string): string | null => {
    const m = /^"([^"]*)"|^'([^']*)'/.exec(inline);
    if (m) return m[1] ?? m[2];
    for (const s of sub) {
      const { text } = lineOf(s);
      const lit = /^"([^"]*)"|^'([^']*)'/.exec(text);
      if (lit) return lit[1] ?? lit[2];
      if (/^[A-Za-z_][\w ]*$/.test(text) && !/^(pos|xpos|ypos|xalign|yalign|at|if_any|if_all|if_not|variant|prefix|default)\b/.test(text)) return text;
    }
    return null;
  };
  const visit = (entries: unknown[], group: string | null) => {
    for (const e of entries) {
      const { text, sub } = lineOf(e);
      let m: RegExpExecArray | null;
      if ((m = /^always\b:?\s*(.*)$/.exec(text))) {
        const d = displayableIn(sub, m[1]);
        if (d) layers.push({ group: null, attribute: null, isDefault: true, condition: null, displayable: d });
      } else if ((m = /^group\s+(\w+)(.*?):?\s*$/.exec(text))) {
        visit(sub, m[1]);
      } else if ((m = /^attribute\s+(\w+)(.*)$/.exec(text))) {
        const rest = m[2].replace(/:\s*$/, "");
        const isDefault = /\bdefault\b/.test(rest);
        const inline = rest.replace(/\bdefault\b/, "").trim();
        const auto = group ? `${base}_${group}_${m[1]}` : `${base}_${m[1]}`;
        layers.push({ group, attribute: m[1], isDefault, condition: null, displayable: displayableIn(sub, inline) ?? auto });
      } else if ((m = /^(?:if|elif)\s+(.+?):\s*$/.exec(text))) {
        const d = displayableIn(sub, "");
        if (d) layers.push({ group: null, attribute: null, isDefault: false, condition: m[1], displayable: d });
      } else if (/^else\s*:/.test(text)) {
        const d = displayableIn(sub, "");
        if (d) layers.push({ group: null, attribute: null, isDefault: false, condition: "else", displayable: d });
      }
    }
  };
  visit(block, null);
  return layers;
}

const ASSIGN_RE = /^\s*([A-Za-z_][\w.]*)\s*(\+=|-=|\*=|\/=|\/\/=|%=|\|=|&=|=)(?!=)/;
const MUTATE_RE = /^\s*([A-Za-z_][\w.]*)\.(append|extend|remove|pop|add|update|discard|insert|clear)\s*\(/;

function collectVariableRefs(b: Builder) {
  // Writes from $ / python statements inside labels.
  for (const { code, ctx, loc } of b.pythonCode) {
    const lines = code.split("\n");
    lines.forEach((line, i) => {
      const at = { ...loc, line: loc.line + (lines.length > 1 ? i : 0) };
      const m = ASSIGN_RE.exec(line) ?? MUTATE_RE.exec(line);
      if (m && !line.trimStart().startsWith("#")) variable(b, m[1]).refs.push({ kind: "write", loc: at, label: ctx.label, code: line.trim() });
    });
  }
  const names = [...b.vars.keys()].filter((n) => n.length > 1 || b.vars.get(n)!.declared);
  if (names.length === 0) return;
  const byName = new Map(names.map((n) => [n, new RegExp(`(?<![\\w.])${n.replace(/\./g, "\\.")}(?![\\w])`)]));
  const addReads = (code: string, kind: VarRef["kind"], ctx: { label: string | null }, loc: Loc, extra?: Pick<VarRef, "gate" | "screen">) => {
    for (const [n, re] of byName) {
      if (re.test(code)) b.vars.get(n)!.refs.push({ kind, loc, label: ctx.label, code: code.trim().slice(0, 200), ...(extra?.screen && { screen: extra.screen }), ...(extra?.gate && { gate: extra.gate }) });
    }
  };
  for (const { code, ctx, loc, gate, screen } of b.conditions) addReads(code, "condition", ctx, loc, { gate, screen });
  for (const { code, ctx, loc, screen } of b.screenReads) addReads(code, "read", ctx, loc, { screen });
  for (const { code, ctx, loc } of b.pythonCode) {
    const lines = code.split("\n");
    lines.forEach((line, i) => {
      const at = { ...loc, line: loc.line + (lines.length > 1 ? i : 0) };
      const target = (ASSIGN_RE.exec(line) ?? MUTATE_RE.exec(line))?.[1];
      // Only the right-hand side reads; `x += 1` is listed once, as a write.
      const rhs = target ? line.slice(line.indexOf(target) + target.length).replace(/^\s*\S*=/, "") : line;
      addReads(rhs, "read", ctx, at);
    });
  }
  for (const { text, ctx, loc } of b.sayTexts) {
    if (!text.includes("[")) continue;
    for (const m of text.matchAll(/\[([^\]]+)\]/g)) addReads(m[1], "read", ctx, loc);
  }
}

/**
 * A label that starts without a `scene` statement continues whatever was on screen in the
 * label that leads into it; carry the background over when exactly one background is possible.
 */
function inheritBackgrounds(b: Builder) {
  const scenesByLabel = new Map<string, SceneInfo[]>();
  for (const s of b.scenes) (scenesByLabel.get(s.label) ?? scenesByLabel.set(s.label, []).get(s.label)!).push(s);
  const lastBackground = (label: string): string | null => {
    const list = scenesByLabel.get(label) ?? [];
    for (let i = list.length - 1; i >= 0; i--) if (list[i].background) return list[i].background;
    return null;
  };
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const [label, list] of scenesByLabel) {
      const first = list[0];
      if (first.background || first.events[0]?.type === "scene") continue;
      const sources = new Set(b.edges.filter((e) => e.to === label && e.kind !== "call").map((e) => lastBackground(e.from)));
      sources.delete(null);
      if (sources.size === 1) {
        first.background = [...sources][0];
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function dedupeReplays(list: ReplayInfo[]): ReplayInfo[] {
  const seen = new Set<string>();
  return list.filter((r) => !seen.has(r.label) && seen.add(r.label));
}

/** Names Ren'Py gives files in game/images/: lowercase basename (before "@"), split on spaces. */
export function autoImageName(gamePath: string): string | null {
  if (!/(^|\/)images\//.test(gamePath) || !IMAGE_EXTENSIONS.test(gamePath)) return null;
  const base = gamePath.split("/").pop()!.replace(/\.[^.]+$/, "").toLowerCase().split("@")[0];
  return base.trim().split(/\s+/).join(" ") || null;
}

export async function buildIndex(input: AnalyzerInput): Promise<AnalyzerIndex> {
  const b: Builder = {
    labels: new Map(),
    edges: [],
    characters: new Map(),
    images: new Map(),
    imageUses: [],
    menus: [],
    vars: new Map(),
    scenes: [],
    pythonCode: [],
    pythonBlocks: 0,
    screens: 0,
    transforms: 0,
    game: { name: null, version: null },
    conditions: [],
    screenReads: [],
    sayTexts: [],
    currentScene: null,
    fileStats: new Map(),
    audioRefs: [],
    audioDefines: new Map(),
    galleryScan: newGalleryScan(),
    screenCode: [],
    replays: [],
    persistentInScreens: {},
  };
  const errors: AnalyzerIndex["errors"] = [];

  for (const s of input.scripts) {
    try {
      const { statements } = readRpyc(await readSource(s.source));
      const file = str(attr(statements.find((n) => attr(n, "filename", null)), "filename", s.path));
      if (/(^|\/)renpy\/common\//.test(file) || /(^|\/)tl\//.test(file)) continue;
      b.fileStats.set(s.fileId, { file, fileId: s.fileId, dialogue: 0, words: 0, labels: 0 });
      b.currentScene = null;
      walkBlock(b, statements, { fileId: s.fileId, file, label: null, conditional: false, inInit: false, via: [] });
    } catch (e) {
      errors.push({ path: s.path, message: e instanceof Error ? e.message : String(e) });
    }
  }

  // Images defined only by being in game/images/.
  const filesByGamePath = new Map(input.imageFiles.map((f) => [f.gamePath.toLowerCase(), f]));
  for (const f of input.imageFiles) {
    const name = autoImageName(f.gamePath);
    if (!name || b.images.has(name)) continue;
    const [tag, ...attributes] = name.split(" ");
    b.images.set(name, { name, tag, attributes, kind: "auto", code: null, file: f.gamePath, loc: null, uses: 0 });
  }
  // Normalize explicit file references to existing game paths.
  for (const img of b.images.values()) {
    if (img.file && !filesByGamePath.has(img.file.toLowerCase())) {
      const alt = `images/${img.file}`.toLowerCase();
      if (filesByGamePath.has(alt)) img.file = filesByGamePath.get(alt)!.gamePath;
    }
  }

  // Count image uses by exact name, else by tag + attribute subset (how `show tag attr` resolves).
  const byTag = new Map<string, ImageInfo[]>();
  for (const img of b.images.values()) (byTag.get(img.tag) ?? byTag.set(img.tag, []).get(img.tag)!).push(img);
  for (const u of b.imageUses) {
    if (u.statement === "hide") continue;
    const exact = b.images.get(u.image);
    if (exact) {
      exact.uses++;
      continue;
    }
    const [tag, ...attrs] = u.image.split(" ");
    const candidates = byTag.get(tag) ?? [];
    const match = candidates.find((c) => c.kind === "layered") ?? candidates.find((c) => attrs.every((a) => c.attributes.includes(a)));
    if (match) match.uses++;
  }

  for (const code of b.screenCode) scanGalleryThumbnails(b.galleryScan, code);
  collectVariableRefs(b);
  inheritBackgrounds(b);

  const labels = [...b.labels.values()];
  const totals = { dialogue: 0, words: 0, choices: 0 };
  for (const f of b.fileStats.values()) {
    totals.dialogue += f.dialogue;
    totals.words += f.words;
  }
  totals.choices = b.menus.reduce((n, m) => n + m.items.length, 0);

  // Labels whose first scene was carried over from a previous label get that background.
  for (const l of labels) if (!l.background) l.background = b.scenes.find((s) => s.label === l.name && s.background)?.background ?? null;
  for (const v of b.vars.values()) for (const r of v.refs) if (r.kind === "write" && r.label) {
    const l = b.labels.get(r.label);
    if (l) l.writes++;
  }

  const index: AnalyzerIndex = {
    game: b.game,
    diagnostics: {
      parsedFiles: b.fileStats.size,
      failedFiles: errors.length,
      pythonBlocks: b.pythonBlocks,
      dynamicRoutes: b.edges.filter((e) => e.dynamic).length,
      contentLabels: labels.filter((l) => l.dialogue > 0).length,
      scenesWithVisuals: 0,
      unreachableLabels: 0,
      screens: b.screens,
      transforms: b.transforms,
      pythonInLabels: b.pythonCode.length,
    },
    files: [...b.fileStats.values()].sort((a, c) => c.words - a.words),
    labels,
    edges: b.edges,
    characters: [...b.characters.values()].filter((c) => c.lines > 0 || c.defined).sort((a, c) => c.lines - a.lines),
    images: [...b.images.values()].sort((a, c) => a.name.localeCompare(c.name)),
    imageUses: b.imageUses,
    menus: b.menus,
    variables: [...b.vars.values()].filter((v) => v.declared || v.refs.some((r) => r.kind === "write")).sort((a, c) => a.name.localeCompare(c.name)),
    scenes: b.scenes.filter((s) => s.events.length > 0),
    audio: resolveAudio(b.audioRefs, b.audioDefines, input.audioFiles ?? []),
    gallery: { ...emptyGallery(), buttons: b.galleryScan.buttons, replays: dedupeReplays(b.replays), persistentInScreens: b.persistentInScreens },
    totals,
    errors,
  };
  analyzeIndex(index);
  return index;
}
