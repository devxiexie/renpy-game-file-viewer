/** A dialogue translation unit: one `translate <lang> <id>:` block. */
export interface DialogueEntry {
  id: string;
  /** Game-relative source file, e.g. "script.rpy". */
  file: string;
  /** Original "game/script.rpy" style path used in the comment line. */
  sourcePath: string;
  line: number;
  who: string | null;
  /** Original dialogue text. */
  what: string;
  /** Canonical code of each statement in the block (shown as comments). */
  code: string[];
  /** Index into `code` of the say statement whose text gets translated. */
  sayIndex: number;
  /** Translated statement code with a placeholder for the new text: [before, after] the quoted string. */
  template: [string, string];
}

/** A `translate <lang> strings:` entry (menu choices, _() strings, character names...). */
export interface StringEntry {
  text: string;
  file: string;
  sourcePath: string;
  line: number;
}

export interface ExistingTranslations {
  dialogue: Record<string, string>;
  strings: Record<string, string>;
}

export interface TranslationProject {
  dialogue: DialogueEntry[];
  strings: StringEntry[];
  /** Translations already shipped in game/tl/<language>/, keyed by language. */
  existing: Record<string, ExistingTranslations>;
  /** Scripts that couldn't be read. */
  errors: { path: string; message: string }[];
}
