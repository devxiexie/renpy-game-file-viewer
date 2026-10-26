import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { encodeUtf8 } from "../../core/binary/text";
import { kindOf } from "../../core/files/types";
import { readSource, sourceSize, sourceToBlob, type FileSource } from "../../core/vfs/source";
import type { FileTree, TreeNode } from "../../core/vfs/tree";
import { writeRpa } from "../../formats/rpa/rpa";

export interface ExportItem {
  /** Path inside the export. */
  path: string;
  source: FileSource;
  name: string;
}

export interface ExportOptions {
  /** Replace .rpa files with their contents. */
  extractArchives: boolean;
  /** Add a decompiled .rpy next to every .rpyc that has no .rpy. */
  decompileScripts: boolean;
}

/**
 * Path a file gets when exported: archive members are placed where Ren'Py would see
 * them (next to the archive, without the archive name), like an extracted game folder.
 */
export function exportPath(tree: FileTree, node: TreeNode): string {
  if (!node.archiveId) return node.path;
  const archive = tree.get(node.archiveId);
  if (!archive) return node.path;
  const inner = node.path.slice(archive.path.length + 1);
  const parent = archive.path.includes("/") ? archive.path.slice(0, archive.path.lastIndexOf("/")) : "";
  return parent ? `${parent}/${inner}` : inner;
}

export function collectExportItems(tree: FileTree, nodes: TreeNode[], opts: ExportOptions): ExportItem[] {
  const items = new Map<string, ExportItem>();
  for (const n of nodes) {
    if (!n.source) continue;
    if (opts.extractArchives && n.archive && n.archive.status === "ready") continue; // members are listed instead
    const path = exportPath(tree, n);
    // Loose files take precedence over archive members at the same path (Ren'Py does the same).
    if (items.has(path) && n.archiveId) continue;
    items.set(path, { path, source: n.source, name: n.name });
  }
  return [...items.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export type DecompileFn = (src: FileSource) => Promise<string>;

/** Add `.rpy` sources for `.rpyc` files that don't already have one. */
export async function withDecompiledScripts(items: ExportItem[], decompile: DecompileFn, onProgress?: (msg: string) => void): Promise<ExportItem[]> {
  const paths = new Set(items.map((i) => i.path));
  const out = [...items];
  const targets = items.filter((i) => kindOf(i.name) === "rpyc" && !paths.has(i.path.slice(0, -1)));
  let done = 0;
  for (const item of targets) {
    onProgress?.(`Decompiling ${++done}/${targets.length}: ${item.path}`);
    try {
      const text = await decompile(item.source);
      out.push({ path: item.path.slice(0, -1), name: item.name.slice(0, -1), source: { type: "bytes", bytes: encodeUtf8(text) } });
    } catch {
      /* keep the .rpyc only */
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const STORE_KINDS = new Set(["image", "audio", "video", "archive", "font"]);

interface ChunkSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

/** Write a ZIP of `items` to `sink` (streaming, so memory stays bounded when the sink is a file). */
export async function writeZip(items: ExportItem[], sink: ChunkSink, onProgress?: (done: number, total: number) => void): Promise<void> {
  let pending: Promise<void> = Promise.resolve();
  let failure: unknown = null;
  let finished!: () => void;
  const done = new Promise<void>((r) => (finished = r));
  const zip = new Zip((err, chunk, final) => {
    if (err) failure = err;
    else pending = pending.then(() => sink.write(chunk));
    if (final || err) void pending.then(finished, (e) => ((failure = e), finished()));
  });
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = STORE_KINDS.has(kindOf(item.name)) ? new ZipPassThrough(item.path) : new ZipDeflate(item.path, { level: 6 });
    zip.add(entry);
    const size = sourceSize(item.source);
    if (size === 0) entry.push(new Uint8Array(0), true);
    for (let pos = 0; pos < size; pos += CHUNK) {
      const end = Math.min(size, pos + CHUNK);
      entry.push(await readSource(item.source, pos, end), end === size);
      await pending; // backpressure: let the sink drain
      if (failure) throw failure;
    }
    onProgress?.(i + 1, items.length);
  }
  zip.end();
  await done;
  if (failure) throw failure;
  await sink.close();
}

export async function zipToBlob(items: ExportItem[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  await writeZip(items, { write: async (c) => void parts.push(c as Uint8Array<ArrayBuffer>), close: async () => {} }, onProgress);
  return new Blob(parts, { type: "application/zip" });
}

export async function rpaFromItems(items: ExportItem[]): Promise<Blob> {
  const files = await Promise.all(items.map(async (i) => ({ path: i.path, data: await sourceToBlob(i.source) })));
  return writeRpa(files);
}

interface SaveFilePicker {
  (opts: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }): Promise<{
    createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
  }>;
}

function savePicker(): SaveFilePicker | null {
  const p = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  return typeof p === "function" ? p : null;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Save a ZIP. Uses the File System Access API to stream straight to disk when available
 * (no size limit), otherwise builds a Blob and triggers a download.
 */
export async function saveZip(items: ExportItem[], filename: string, onProgress?: (done: number, total: number) => void): Promise<"stream" | "download"> {
  const picker = savePicker();
  if (picker) {
    let handle;
    try {
      handle = await picker({ suggestedName: filename, types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }] });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      handle = null;
    }
    if (handle) {
      const w = await handle.createWritable();
      await writeZip(items, { write: (c) => w.write(c as Uint8Array<ArrayBuffer>), close: () => w.close() }, onProgress);
      return "stream";
    }
  }
  downloadBlob(await zipToBlob(items, onProgress), filename);
  return "download";
}
