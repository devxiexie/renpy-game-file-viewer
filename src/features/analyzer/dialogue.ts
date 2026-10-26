import { evalPyStrings } from "../translate/pystring";
import type { AnalyzerIndex, Loc } from "./model";

/** Every line of dialogue in script order, and screenplay export. */

export interface DialogueLine {
  /** Speaker expression ("e") or null for the narrator. */
  who: string | null;
  what: string;
  /** Text without {tags}, as the player sees it. */
  plain: string;
  label: string;
  loc: Loc;
}

/** Character id a say statement's speaker expression refers to (as in the index's characters). */
export function speakerId(who: string | null): string {
  if (!who) return "narrator";
  const m = /^_{1,3}\s*\(([\s\S]*)\)$/.exec(who.trim());
  return evalPyStrings(m ? m[1].trim() : who.trim()) ?? who;
}

export const plainText = (what: string) => what.replace(/\{[^{}]*\}/g, "").replace(/\\n/g, " ");

export function dialogueLines(index: AnalyzerIndex): DialogueLine[] {
  const out: DialogueLine[] = [];
  for (const s of index.scenes) {
    for (const e of s.events) if (e.type === "say") out.push({ who: e.who, what: e.what, plain: plainText(e.what), label: s.label, loc: e.loc });
  }
  return out;
}

export interface MatchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** Matcher for the search box; throws on an invalid regular expression. */
export function dialogueMatcher(query: string, opts: MatchOptions): RegExp | null {
  if (!query) return null;
  let src = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, `gu${opts.caseSensitive ? "" : "i"}`);
}

export interface ScreenplayOptions {
  format: "md" | "txt";
  title: string;
  /** Speaker expression → display name. */
  names: Map<string, string>;
  /** Only these lines (search results); scene and choice context is left out. */
  only?: DialogueLine[];
}

/** The script as a readable screenplay: labels as headings, scenes, dialogue and choices. */
export function screenplay(index: AnalyzerIndex, opts: ScreenplayOptions): string {
  const md = opts.format === "md";
  const out: string[] = [md ? `# ${opts.title}` : opts.title.toUpperCase(), ""];
  const speaker = (who: string | null) => (who ? (opts.names.get(speakerId(who)) ?? speakerId(who)) : null);
  const say = (who: string | null, what: string) => {
    const name = speaker(who);
    const text = plainText(what);
    if (md) return name ? `**${name}:** ${text}` : `*${text}*`;
    return name ? `${name.toUpperCase()}: ${text}` : text;
  };
  const heading = (label: string, file: string) => (md ? `## ${label}\n\n<sub>${file}</sub>` : `=== ${label} (${file}) ===`);
  let current: string | null = null;
  if (opts.only) {
    for (const l of opts.only) {
      if (l.label !== current) {
        out.push("", heading(l.label, l.loc.file), "");
        current = l.label;
      }
      out.push(say(l.who, l.what), "");
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  for (const s of index.scenes) {
    if (s.label !== current) {
      out.push("", heading(s.label, s.loc.file), "");
      current = s.label;
    }
    for (const e of s.events) {
      if (e.type === "scene" && e.image) out.push(md ? `> *Scene: ${e.image}*` : `[Scene: ${e.image}]`, "");
      else if (e.type === "say") out.push(say(e.who, e.what), "");
      else if (e.type === "menu") {
        out.push(md ? "**Choice:**" : "CHOICE:");
        for (const it of e.items) out.push(md ? `- ${plainText(it)}` : `  * ${plainText(it)}`);
        out.push("");
      }
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
