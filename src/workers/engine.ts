import { decodeUtf8 } from "../core/binary/text";
import { isSearchable, kindOf } from "../core/files/types";
import { readSource, sourceToBlob, type FileSource } from "../core/vfs/source";
import { listArchive, type ArchiveListing } from "../formats/archive";
import { decompileRpyc } from "../formats/rpyc";

/**
 * CPU-heavy operations. Runs inside a Web Worker in the app (see engine.worker.ts) and
 * directly in tests / Node scripts.
 */

export interface DecompiledScript {
  source: string;
  warnings: string[];
  scriptVersion: number | null;
}

export async function decompile(src: FileSource): Promise<DecompiledScript> {
  const result = decompileRpyc(await readSource(src));
  return { source: result.source, warnings: result.warnings, scriptVersion: result.scriptVersion };
}

export async function archiveListing(name: string, archive: FileSource, rpi?: FileSource): Promise<ArchiveListing> {
  return listArchive(name, archive, rpi);
}

/** Text of a file for viewing/searching: decompiles .rpyc, decodes text files as UTF-8. */
export async function fileText(name: string, src: FileSource): Promise<string> {
  if (kindOf(name) === "rpyc") return (await decompile(src)).source;
  return decodeUtf8(await readSource(src)).replace(/^﻿/, "");
}

export interface SearchFile {
  id: string;
  path: string;
  name: string;
  source: FileSource;
}

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Skip .rpyc files whose .rpy sibling is also in the list. */
  preferSource: boolean;
  maxResults: number;
}

export interface SearchHit {
  fileId: string;
  path: string;
  line: number;
  column: number;
  length: number;
  text: string;
}

export interface SearchResult {
  hits: SearchHit[];
  filesSearched: number;
  truncated: boolean;
  errors: { path: string; message: string }[];
}

export function buildMatcher(query: string, opts: Pick<SearchOptions, "regex" | "caseSensitive" | "wholeWord">): RegExp {
  let pattern = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  return new RegExp(pattern, opts.caseSensitive ? "g" : "gi");
}

export async function search(
  files: SearchFile[],
  query: string,
  opts: SearchOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<SearchResult> {
  const re = buildMatcher(query, opts);
  const candidates = files.filter((f) => isSearchable(f.name));
  const sourcePaths = new Set(candidates.filter((f) => kindOf(f.name) === "script").map((f) => f.path));
  const targets = opts.preferSource
    ? candidates.filter((f) => !(kindOf(f.name) === "rpyc" && sourcePaths.has(f.path.slice(0, -1))))
    : candidates;

  const hits: SearchHit[] = [];
  const errors: SearchResult["errors"] = [];
  let truncated = false;
  let done = 0;
  for (const f of targets) {
    if (truncated) break;
    try {
      const text = await fileText(f.name, f.source);
      const lines = text.split("\n");
      for (let i = 0; i < lines.length && !truncated; i++) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(lines[i]))) {
          hits.push({ fileId: f.id, path: f.path, line: i + 1, column: m.index, length: m[0].length, text: lines[i].slice(0, 400) });
          if (hits.length >= opts.maxResults) {
            truncated = true;
            break;
          }
          if (m[0].length === 0) re.lastIndex++;
        }
      }
    } catch (e) {
      errors.push({ path: f.path, message: e instanceof Error ? e.message : String(e) });
    }
    done++;
    if (onProgress && (done % 20 === 0 || done === targets.length)) onProgress(done, targets.length);
  }
  return { hits, filesSearched: done, truncated, errors };
}

/**
 * Downscaled WebP thumbnail of an image (longest side `size` px). Uses createImageBitmap +
 * OffscreenCanvas, available in workers in all evergreen browsers.
 */
export async function imageThumbnail(src: FileSource, size: number): Promise<Blob | null> {
  const blob = await sourceToBlob(src);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null; // undecodable format
  }
  const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
}

export { sourcesEqual } from "../features/compare/compare";

export { extractTranslations } from "../features/translate/extract";

export interface RecompressResult {
  blob: Blob;
  before: number;
  after: number;
}

/**
 * Re-encode a PNG/JPEG as WebP. Returns null when decoding fails or WebP isn't smaller.
 * Ren'Py (SDL_image) detects the format from file contents, so names can stay *.png.
 */
export async function recompressImage(src: FileSource, quality: number): Promise<RecompressResult | null> {
  const blob = await sourceToBlob(src);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  } catch {
    return null;
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const webp = await canvas.convertToBlob({ type: "image/webp", quality });
  if (webp.type !== "image/webp" || webp.size >= blob.size) return null;
  return { blob: webp, before: blob.size, after: webp.size };
}

export { buildIndex as buildAnalyzerIndex } from "../features/analyzer/build";

export { labelProgram } from "../features/analyzer/program";
