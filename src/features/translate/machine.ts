/**
 * Browser-built-in machine translation (Chrome's Translator API). Ren'Py text tags
 * ({b}…{/b}), interpolations ([name]) and %-formats are swapped for numbered markers
 * before translating and restored afterwards so they survive unchanged.
 */

interface TranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?(): void;
}
interface TranslatorStatic {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(o: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }): Promise<TranslatorInstance>;
}

function api(): TranslatorStatic | null {
  const t = (globalThis as { Translator?: TranslatorStatic }).Translator;
  return t && typeof t.create === "function" ? t : null;
}

export function machineTranslationSupported(): boolean {
  return api() !== null;
}

const PROTECTED = /\{[^{}]*\}|\[[^[\]]*\]|%\([^)]*\)[-#0 +]*\d*(?:\.\d+)?[diouxXeEfFgGcrs%]|%[diouxXeEfFgGcrs%]/g;

export function protect(text: string): { masked: string; tokens: string[] } {
  const tokens: string[] = [];
  const masked = text.replace(PROTECTED, (m) => `⟦${tokens.push(m) - 1}⟧`);
  return { masked, tokens };
}

export function restore(text: string, tokens: string[]): string {
  const used = new Set<number>();
  let out = text.replace(/⟦\s*(\d+)\s*⟧/g, (_, i: string) => {
    used.add(Number(i));
    return tokens[Number(i)] ?? "";
  });
  // Re-append any tags the translator dropped so markup stays balanced.
  tokens.forEach((t, i) => {
    if (!used.has(i)) out += t;
  });
  return out;
}

export async function createMachineTranslator(sourceLanguage: string, targetLanguage: string): Promise<(text: string) => Promise<string>> {
  const T = api();
  if (!T) throw new Error("This browser has no built-in translator. Chrome 138+ on desktop provides one.");
  const availability = await T.availability({ sourceLanguage, targetLanguage });
  if (availability === "unavailable") throw new Error(`Translation from "${sourceLanguage}" to "${targetLanguage}" isn't available in this browser.`);
  const translator = await T.create({ sourceLanguage, targetLanguage });
  return async (text: string) => {
    const { masked, tokens } = protect(text);
    return restore(await translator.translate(masked), tokens);
  };
}

/** Best-guess BCP 47 code for common Ren'Py language folder names. */
export const LANGUAGE_CODES: Record<string, string> = {
  english: "en", french: "fr", german: "de", spanish: "es", italian: "it", portuguese: "pt", pt_br: "pt", brazilian: "pt",
  russian: "ru", ukrainian: "uk", polish: "pl", czech: "cs", dutch: "nl", danish: "da", swedish: "sv", finnish: "fi",
  norwegian: "no", turkish: "tr", greek: "el", hungarian: "hu", romanian: "ro", japanese: "ja", korean: "ko",
  schinese: "zh", tchinese: "zh-Hant", chinese: "zh", vietnamese: "vi", thai: "th", indonesian: "id", malay: "ms",
  arabic: "ar", hebrew: "he", hindi: "hi", persian: "fa",
};
