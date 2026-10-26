import { PyObject } from "../../formats/pickle/types";
import { asArray, attr, lineOf, optStr } from "../../formats/rpyc/decompiler/util";
import { evalPyStrings } from "../translate/pystring";
import type { AudioInfo, AudioStatement, AudioUse, GalleryButton, GalleryIndex, Loc } from "./model";

/**
 * Scanning helpers for the Walkthrough / Audio / Gallery parts of the Analyzer: Python call
 * argument parsing, audio statements and calls, Gallery() / Replay() definitions and the
 * strings inside screens.
 */

/** Split a call's argument text on top-level commas. */
export function splitArgs(body: string): string[] {
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
  return args;
}

/** Text between the parenthesis at `open` and its match (quotes respected), or null if unbalanced. */
export function balancedArgs(code: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c) && --depth === 0) return code.slice(open + 1, i);
  }
  return null;
}

export interface CallArgs {
  positional: string[];
  kwargs: Record<string, string>;
}

export function callArgs(body: string): CallArgs {
  const positional: string[] = [];
  const kwargs: Record<string, string> = {};
  for (const a of splitArgs(body)) {
    const kw = /^([A-Za-z_]\w*)\s*=(?!=)\s*([\s\S]*)$/.exec(a);
    if (kw) kwargs[kw[1]] = kw[2];
    else positional.push(a);
  }
  return { positional, kwargs };
}

/** Every call of `re` (which must end right before the opening parenthesis) in `code`. */
export function* calls(code: string, re: RegExp): Generator<{ match: RegExpExecArray; args: CallArgs; offset: number }> {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (let m = g.exec(code); m; m = g.exec(code)) {
    const open = code.indexOf("(", m.index + m[0].length - 1);
    if (open < 0) continue;
    const body = balancedArgs(code, open);
    if (body === null) continue;
    yield { match: m, args: callArgs(body), offset: m.index };
  }
}

const str = (expr: string | undefined) => (expr ? evalPyStrings(expr.trim()) : null);

// ---------------------------------------------------------------------------------------------
// Audio

export interface AudioRef {
  /** Expression naming the file(s): a string, a list of strings or an audio.x name. */
  expr: string;
  use: AudioUse;
}

const AUDIO_KEYWORDS = /\s+(fadein|fadeout|loop|noloop|if_changed|volume|channel|synchro_start)\b[\s\S]*$/;

/** `play music "a.ogg" fadein 1.0`, `queue sound [..]`, `voice "v.ogg"` → channel + file expression. */
export function parseAudioStatement(line: string): { statement: AudioStatement; channel: string; expr: string } | null {
  let m = /^(play|queue)\s+(\w+)\s+([\s\S]+)$/.exec(line.trim());
  if (m) return { statement: m[1] as AudioStatement, channel: m[2], expr: m[3].replace(AUDIO_KEYWORDS, "").trim() };
  m = /^voice\s+([\s\S]+)$/.exec(line.trim());
  if (m && !/^sustain\b/.test(m[1])) return { statement: "voice", channel: "voice", expr: m[1].trim() };
  return null;
}

/** renpy.music.play / renpy.sound.play / renpy.play / renpy.voice / Play() / Queue() calls in Python or screens. */
export function audioCalls(code: string): { channel: string; expr: string; statement: AudioStatement }[] {
  const out: { channel: string; expr: string; statement: AudioStatement }[] = [];
  for (const { match, args } of calls(code, /\b(?:renpy\.(music|sound)\.(play|queue)|renpy\.(play|voice)|(Play|Queue))\s*\(/)) {
    const ch = (s: string | undefined) => str(s) ?? s ?? null;
    if (match[1]) {
      const expr = args.positional[0] ?? args.kwargs.filenames;
      if (expr) out.push({ channel: ch(args.kwargs.channel ?? args.positional[1]) ?? match[1], expr, statement: "python" });
    } else if (match[3]) {
      const expr = args.positional[0] ?? args.kwargs.filename;
      if (expr) out.push({ channel: match[3] === "voice" ? "voice" : (ch(args.kwargs.channel ?? args.positional[1]) ?? "sound"), expr, statement: "python" });
    } else if (match[4]) {
      const expr = args.positional[1] ?? args.kwargs.file;
      const channel = ch(args.positional[0] ?? args.kwargs.channel);
      if (expr && channel) out.push({ channel, expr, statement: "python" });
    }
  }
  return out;
}

/** File names an audio expression refers to: string literals (also inside lists), or `audio.x` / bare names. */
export function audioNames(expr: string): { files: string[]; names: string[] } {
  const t = expr.trim();
  const items = t.startsWith("[") || t.startsWith("(") ? splitArgs(t.slice(1, -1)) : [t];
  const files: string[] = [];
  const names: string[] = [];
  for (const it of items) {
    const lit = str(it);
    if (lit !== null) files.push(lit.replace(/^<[^>]*>/, ""));
    // Bare names and audio.x are audio aliases; other dotted names (config.sample_sound, ...) are settings.
    else if (/^(audio\.)?[A-Za-z_]\w*$/.test(it)) names.push(it.replace(/^audio\./, ""));
  }
  return { files, names };
}

/** Name Ren'Py gives a file in game/audio/ (`audio/Main Theme.ogg` → `main_theme`). */
export function autoAudioName(gamePath: string): string | null {
  if (!/^audio\//i.test(gamePath)) return null;
  const base = gamePath.split("/").pop()!.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
  return /^[a-z_]\w*$/.test(base) && !base.startsWith("_") ? base : null;
}

function guessKind(path: string): AudioInfo["kind"] {
  if (/(^|\/)(voice|voices|vo)\//i.test(path)) return "voice";
  if (/music|bgm|ost|theme|song|track|soundtrack/i.test(path)) return "music";
  return "sound";
}

/** Combine references, `define audio.x` aliases and the audio files that exist into the audio list. */
export function resolveAudio(
  refs: AudioRef[],
  defines: Map<string, { code: string; loc: Loc }>,
  files: { fileId: string; gamePath: string }[],
): AudioInfo[] {
  const byPath = new Map(files.map((f) => [f.gamePath.toLowerCase(), f.gamePath]));
  const byBase = new Map<string, string[]>();
  for (const f of files) {
    const b = f.gamePath.split("/").pop()!.toLowerCase();
    (byBase.get(b) ?? byBase.set(b, []).get(b)!).push(f.gamePath);
  }
  const findFile = (p: string): string | null => {
    const l = p.toLowerCase().replace(/^\/+/, "").replace(/^game\//, "");
    const hit = byPath.get(l) ?? byPath.get(`audio/${l}`);
    if (hit) return hit;
    const same = byBase.get(l.split("/").pop()!);
    return same?.length === 1 ? same[0] : null;
  };
  const infos = new Map<string, AudioInfo>();
  const get = (path: string, file: string | null): AudioInfo => {
    const id = file ?? path;
    let a = infos.get(id.toLowerCase());
    if (!a) {
      a = { id, file, aliases: [], loc: null, kind: guessKind(id), uses: [], missing: !file };
      infos.set(id.toLowerCase(), a);
    }
    return a;
  };
  // audio.x aliases: defined ones, then the files Ren'Py auto-defines from game/audio/.
  const aliases = new Map<string, string>();
  for (const [name, d] of defines) {
    const lit = str(d.code);
    if (lit === null) continue;
    const path = lit.replace(/^<[^>]*>/, "");
    const a = get(path, findFile(path));
    a.aliases.push(name);
    a.loc ??= d.loc;
    aliases.set(name, a.id);
  }
  for (const f of files) {
    const n = autoAudioName(f.gamePath);
    if (n && !aliases.has(n)) {
      aliases.set(n, f.gamePath);
      const a = get(f.gamePath, f.gamePath);
      if (!a.aliases.includes(n)) a.aliases.push(n);
    }
  }
  for (const { expr, use } of refs) {
    const { files: lits, names } = audioNames(expr);
    const targets: AudioInfo[] = [];
    for (const l of lits) targets.push(get(l, findFile(l)));
    for (const n of names) {
      const id = aliases.get(n);
      if (id) targets.push(infos.get(id.toLowerCase())!);
      else targets.push(get(`audio.${n}`, null));
    }
    if (!lits.length && !names.length && !/^[A-Za-z_][\w.]*$/.test(expr.trim())) targets.push(get(expr, null));
    for (const t of targets) t.uses.push(use);
  }
  // Every audio file in the game, used or not, appears once.
  for (const f of files) get(f.gamePath, f.gamePath);
  for (const a of infos.values()) {
    const channels = a.uses.map((u) => u.channel);
    if (channels.includes("music")) a.kind = "music";
    else if (channels.includes("voice")) a.kind = "voice";
    else if (channels.length) a.kind = "sound";
    // Expressions that never resolved to a literal path aren't necessarily missing files.
    if (!a.file && !/\.\w{2,4}$/.test(a.id)) a.missing = false;
  }
  return [...infos.values()].sort((a, b) => b.uses.length - a.uses.length || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------------
// Gallery and replays

export interface GalleryScan {
  galleries: Set<string>;
  buttons: GalleryButton[];
  current: Map<string, GalleryButton>;
}

export function newGalleryScan(): GalleryScan {
  return { galleries: new Set(), buttons: [], current: new Map() };
}

const lits = (args: CallArgs) => args.positional.map((a) => str(a)).filter((s): s is string => s !== null);

/** Read `g = Gallery()`, `g.button("x")`, `g.image(...)`, `g.unlock_image(...)`, `g.condition(...)`, `g.unlock(...)`. */
export function scanGalleryCode(scan: GalleryScan, code: string, loc: Loc): void {
  for (const m of code.matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*=\s*(?:renpy\.store\.)?Gallery\s*\(/g)) scan.galleries.add(m[1]);
  if (!scan.galleries.size) return;
  for (const { match, args } of calls(code, /(?<![\w.])([A-Za-z_]\w*)\.(button|image|unlock_image|condition|unlock|display)\s*\(/)) {
    const [, g, method] = match;
    if (!scan.galleries.has(g)) continue;
    if (method === "button") {
      const b: GalleryButton = { gallery: g, name: lits(args)[0] ?? `button ${scan.buttons.length + 1}`, images: [], conditions: [], unlockImages: [], thumbnail: null, loc };
      scan.buttons.push(b);
      scan.current.set(g, b);
      continue;
    }
    const b = scan.current.get(g);
    if (!b) continue;
    if (method === "image" || method === "display" || method === "unlock_image") {
      const names = lits(args);
      if (names.length) b.images.push(names);
      if (method === "unlock_image") b.unlockImages.push(...names.filter((n) => !b.unlockImages.includes(n)));
    } else if (method === "unlock") b.unlockImages.push(...lits(args).filter((n) => !b.unlockImages.includes(n)));
    else if (method === "condition" && args.positional[0]) b.conditions.push(str(args.positional[0]) ?? args.positional[0]);
  }
}

/** `g.make_button("name", "thumb.png", ...)` in screens gives the button its thumbnail. */
export function scanGalleryThumbnails(scan: GalleryScan, code: string): void {
  for (const { match, args } of calls(code, /(?<![\w.])([A-Za-z_]\w*)\.make_button\s*\(/)) {
    const [name, thumb] = lits(args);
    const b = scan.buttons.find((x) => x.gallery === match[1] && x.name === name);
    if (b && thumb && !b.thumbnail) b.thumbnail = thumb;
  }
}

/** Labels started as replays: Replay("label") actions and renpy.call_replay("label"). */
export function replayTargets(code: string): string[] {
  const out: string[] = [];
  for (const { args } of calls(code, /\b(?:Replay|renpy\.call_replay)\s*\(/)) {
    const label = str(args.positional[0] ?? args.kwargs.label);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export function emptyGallery(): GalleryIndex {
  return { buttons: [], replays: [], persistentInScreens: {} };
}

/**
 * All strings inside a screen's statement tree (its Python expressions and keyword values),
 * bounded so huge screens can't stall the scan.
 */
/** Python comparison or membership operators. */
export const COMPARE_RE = /[<>]=?|[=!]=|\b(?:not\s+)?in\b|\bis\b/;

/** Conditions of screen `if` / `elif` / `showif` statements, with their lines. */
export function screenConditions(root: unknown, limit = 20_000): { code: string; line: number; showif: boolean }[] {
  const out: { code: string; line: number; showif: boolean }[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length && visited++ < limit) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      if (seen.has(v)) continue;
      seen.add(v);
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    } else if (v instanceof PyObject) {
      if (seen.has(v)) continue;
      seen.add(v);
      if (v.className === "SLIf" || v.className === "SLShowIf") {
        asArray(attr(v, "entries", [])).forEach((entry, i) => {
          const [cond, block] = asArray(entry);
          const code = optStr(cond);
          if (code && code !== "True") out.push({ code, line: lineOf(i === 0 ? v : block), showif: v.className === "SLShowIf" });
        });
      }
      stack.push(...Object.values(v.attrs), ...v.args, ...(v.items ?? []));
    }
  }
  return out;
}

export function deepStrings(root: unknown, limit = 20_000): string[] {
  const out: string[] = [];
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  let visited = 0;
  while (stack.length && visited++ < limit) {
    const v = stack.pop();
    if (typeof v === "string") {
      if (v.length > 2) out.push(v);
    } else if (Array.isArray(v)) {
      if (seen.has(v)) continue;
      seen.add(v);
      for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]);
    } else if (v instanceof PyObject) {
      if (seen.has(v)) continue;
      seen.add(v);
      stack.push(...Object.values(v.attrs), ...v.args, v.state, ...(v.items ?? []));
      if (v.map) for (const [k, x] of v.map) stack.push(k, x);
    } else if (v instanceof Map) {
      if (seen.has(v)) continue;
      seen.add(v);
      for (const [k, x] of v) stack.push(k, x);
    }
  }
  return out;
}
