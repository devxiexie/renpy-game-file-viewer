import { readSource, type FileSource } from "../../core/vfs/source";
import { unpickle } from "../../formats/pickle/unpickler";
import { readRpycPickle } from "../../formats/rpyc/container";
import { decompileStatements, sayCode } from "../../formats/rpyc/decompiler/decompiler";
import { asArray, attr, className, lineOf, quoteString, str } from "../../formats/rpyc/decompiler/util";
import type { DialogueEntry, ExistingTranslations, StringEntry, TranslationProject } from "./model";
import { scanMarkedStrings } from "./pystring";

export interface ScriptFile {
  path: string;
  source: FileSource;
}

const SENTINEL = "\u0000";

function statementsOf(data: Uint8Array, slot: number): unknown[] {
  const root = unpickle(readRpycPickle(data, slot).pickle);
  if (Array.isArray(root) && root.length === 2 && Array.isArray(root[1])) return root[1];
  return Array.isArray(root) ? root : [];
}

/** Children of any AST node that can contain statements. */
function* childBlocks(node: unknown): Generator<unknown[]> {
  const block = attr<unknown>(node, "block", null);
  if (Array.isArray(block)) yield block;
  for (const e of asArray(attr(node, "entries", null))) {
    const b = asArray(e)[1];
    if (Array.isArray(b)) yield b;
  }
  for (const it of asArray(attr(node, "items", null))) {
    const b = asArray(it)[2];
    if (Array.isArray(b)) yield b;
  }
}

function* walk(nodes: unknown[]): Generator<unknown> {
  for (const n of nodes) {
    yield n;
    for (const b of childBlocks(n)) yield* walk(b);
  }
}

/** "game/script.rpy" → "script.rpy"; null for Ren'Py's own common files. */
function elide(filename: string): string | null {
  const f = filename.replace(/\\/g, "/");
  if (/(^|\/)renpy\/common\//.test(f) || f.startsWith("common/")) return null;
  const i = f.indexOf("game/");
  return i >= 0 ? f.slice(i + 5) : f.split("/").pop()!;
}

function statementCode(n: unknown): string {
  const k = className(n);
  if (k === "Say" || k === "TranslateSay") return sayCode(n);
  if (k === "UserStatement") return str(attr(n, "line"));
  return "";
}

function dialogueEntry(node: unknown, block: unknown[], file: string, sourcePath: string): DialogueEntry | null {
  const code = block.map(statementCode);
  if (code.every((c) => c === 'extend ""')) return null; // Ren'Py skips empty extends
  const sayIndex = block.findIndex((n) => className(n) === "Say" || className(n) === "TranslateSay");
  if (sayIndex < 0) return null;
  const say = block[sayIndex];
  const withSentinel = sayCode(say, { what: SENTINEL });
  const q = quoteString(SENTINEL);
  const at = withSentinel.indexOf(q);
  return {
    id: str(attr(node, "identifier")).replace(/\./g, "_"),
    file,
    sourcePath,
    line: lineOf(node),
    who: attr<unknown>(say, "who", null) ? str(attr(say, "who")) : null,
    what: str(attr(say, "what", "")),
    code,
    sayIndex,
    template: [withSentinel.slice(0, at), withSentinel.slice(at + q.length)],
  };
}

export async function extractTranslations(files: ScriptFile[]): Promise<TranslationProject> {
  const dialogue: DialogueEntry[] = [];
  const strings: StringEntry[] = [];
  const existing: Record<string, ExistingTranslations> = {};
  const errors: TranslationProject["errors"] = [];
  const seenIds = new Set<string>();
  const seenStrings = new Set<string>();

  for (const f of files) {
    try {
      const data = await readSource(f.source);
      const slot1 = statementsOf(data, 1);
      const sourcePath = str(attr(slot1.find((n) => attr(n, "filename", null)), "filename", f.path));
      const file = elide(sourcePath);
      if (file === null) continue;

      if (file.startsWith("tl/")) {
        for (const n of walk(slot1)) {
          const lang = attr<unknown>(n, "language", null);
          if (typeof lang !== "string") continue;
          const ex = (existing[lang] ??= { dialogue: {}, strings: {} });
          if (className(n) === "Translate") {
            const say = asArray(attr(n, "block", [])).find((b) => className(b) === "Say");
            if (say) ex.dialogue[str(attr(n, "identifier")).replace(/\./g, "_")] = str(attr(say, "what", ""));
          } else if (className(n) === "TranslateString") {
            ex.strings[str(attr(n, "old"))] = str(attr(n, "new"));
          }
        }
        continue;
      }

      // Dialogue: identifiers assigned by Ren'Py's translation pass live in slot 2.
      let slot2: unknown[];
      try {
        slot2 = statementsOf(data, 2);
      } catch {
        slot2 = [];
      }
      for (const n of walk(slot2)) {
        const k = className(n);
        let entry: DialogueEntry | null = null;
        if (k === "TranslateSay" && attr(n, "language", null) === null) entry = dialogueEntry(n, [n], file, sourcePath);
        else if (k === "Translate" && attr(n, "language", null) === null) entry = dialogueEntry(n, asArray(attr(n, "block", [])), file, sourcePath);
        if (entry && !seenIds.has(entry.id)) {
          seenIds.add(entry.id);
          dialogue.push(entry);
        }
      }

      // Strings: menu choices, then _()-marked strings in the (line-aligned) decompiled source.
      const found: StringEntry[] = [];
      for (const n of walk(slot1)) {
        if (className(n) !== "Menu") continue;
        for (const item of asArray(attr(n, "items", []))) {
          const label = str(asArray(item)[0]);
          if (label) found.push({ text: label, file, sourcePath, line: lineOf(n) });
        }
      }
      const text = decompileStatements(slot1).source.split("\n");
      text.forEach((line, i) => {
        if (!line.includes("_")) return;
        for (const s of scanMarkedStrings(line)) found.push({ text: s, file, sourcePath, line: i + 1 });
      });
      found.sort((a, b) => a.line - b.line);
      for (const s of found) {
        if (seenStrings.has(s.text)) continue;
        seenStrings.add(s.text);
        strings.push(s);
      }
    } catch (e) {
      errors.push({ path: f.path, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { dialogue, strings, existing, errors };
}
