import { quoteString } from "../../formats/rpyc/decompiler/util";
import type { TranslationProject } from "./model";

export interface Translations {
  dialogue: Record<string, string>;
  strings: Record<string, string>;
}

export interface GenerateOptions {
  /** Write the original text for untranslated entries (Ren'Py's default) instead of omitting them. */
  fillMissing: boolean;
}

/** Same escaping as renpy.translation.quote_unicode (used for old/new strings). */
export function quoteUnicode(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\x07/g, "\\a")
    .replace(/\x08/g, "\\b")
    .replace(/\f/g, "\\f")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/\v/g, "\\v");
}

export function isValidLanguageName(s: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

/**
 * Build `game/tl/<language>/*.rpy` files in the format written by Ren'Py's
 * "Generate Translations": dialogue blocks first, then a `strings` block per file.
 */
export function generateTlFiles(project: TranslationProject, language: string, t: Translations, opts: GenerateOptions): Record<string, string> {
  if (!isValidLanguageName(language)) throw new Error("Language names must be identifiers, e.g. french or pt_br");
  const files = new Map<string, string[]>();
  const out = (file: string) => {
    const name = `game/tl/${language}/${file.endsWith(".rpym") ? file.slice(0, -1) : file}`;
    let parts = files.get(name);
    if (!parts) files.set(name, (parts = ["﻿\n"]));
    return parts;
  };

  for (const d of project.dialogue) {
    const tr = t.dialogue[d.id];
    if (tr === undefined && !opts.fillMissing) continue;
    const text = tr ?? d.what;
    const lines = [`# ${d.sourcePath}:${d.line}`, `translate ${language} ${d.id}:`, ""];
    for (const c of d.code) lines.push(`    # ${c}`);
    d.code.forEach((c, i) => lines.push(`    ${i === d.sayIndex ? d.template[0] + quoteString(text) + d.template[1] : c}`));
    lines.push("", "");
    out(d.file).push(lines.join("\n"));
  }

  const byFile = new Map<string, typeof project.strings>();
  for (const s of project.strings) {
    if (t.strings[s.text] === undefined && !opts.fillMissing) continue;
    (byFile.get(s.file) ?? byFile.set(s.file, []).get(s.file)!).push(s);
  }
  for (const [file, list] of byFile) {
    const lines = [`translate ${language} strings:`, ""];
    for (const s of list) {
      lines.push(`    # ${s.sourcePath}:${s.line}`, `    old "${quoteUnicode(s.text)}"`, `    new "${quoteUnicode(t.strings[s.text] ?? s.text)}"`, "");
    }
    lines.push("");
    out(file).push(lines.join("\n"));
  }

  const result: Record<string, string> = {};
  for (const [name, parts] of files) result[name] = parts.join("");
  return result;
}
