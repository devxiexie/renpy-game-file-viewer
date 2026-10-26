import { inflateSync } from "fflate";
import { concatBytes } from "../binary/text";

/**
 * A FileSource describes where a file's bytes live. It is plain structured-cloneable
 * data (Blob / Uint8Array / nested descriptors), so it can be posted to Web Workers
 * without copying the underlying file: Blobs are passed by reference.
 */
export type FileSource =
  | { type: "blob"; blob: Blob }
  | { type: "bytes"; bytes: Uint8Array }
  | { type: "slice"; parent: FileSource; offset: number; length: number; prefix?: Uint8Array }
  /** Remote file read with HTTP Range requests. */
  | { type: "url"; url: string; size: number }
  /** Member of a ZIP archive. Data starts after the local header at `headerOffset`. */
  | { type: "zip"; parent: FileSource; headerOffset: number; compressedSize: number; size: number; method: number };

export function blobSource(blob: Blob): FileSource {
  return { type: "blob", blob };
}

export function bytesSource(bytes: Uint8Array): FileSource {
  return { type: "bytes", bytes };
}

export function sliceSource(parent: FileSource, offset: number, length: number, prefix?: Uint8Array): FileSource {
  return prefix && prefix.length ? { type: "slice", parent, offset, length, prefix } : { type: "slice", parent, offset, length };
}

export function sourceSize(src: FileSource): number {
  switch (src.type) {
    case "blob":
      return src.blob.size;
    case "bytes":
      return src.bytes.length;
    case "slice":
      return src.length + (src.prefix?.length ?? 0);
    case "url":
    case "zip":
      return src.size;
  }
}

export class SourceError extends Error {}

/** Read bytes [start, end) of a source (end defaults to the whole file). */
export async function readSource(src: FileSource, start = 0, end?: number): Promise<Uint8Array> {
  const size = sourceSize(src);
  const s = Math.max(0, Math.min(start, size));
  const e = Math.max(s, Math.min(end ?? size, size));
  switch (src.type) {
    case "blob":
      return new Uint8Array(await src.blob.slice(s, e).arrayBuffer());
    case "bytes":
      return src.bytes.subarray(s, e);
    case "slice": {
      const prefix = src.prefix ?? new Uint8Array(0);
      const parts: Uint8Array[] = [];
      if (s < prefix.length) parts.push(prefix.subarray(s, Math.min(e, prefix.length)));
      const ds = Math.max(0, s - prefix.length);
      const de = e - prefix.length;
      if (de > ds) parts.push(await readSource(src.parent, src.offset + ds, src.offset + de));
      return parts.length === 1 ? parts[0] : concatBytes(parts);
    }
    case "url":
      return e > s ? fetchRange(src.url, s, e) : new Uint8Array(0);
    case "zip": {
      if (src.method === 0) {
        const dataStart = await zipDataOffset(src);
        return readSource(src.parent, dataStart + s, dataStart + e);
      }
      const whole = await inflateZipEntry(src);
      return whole.subarray(s, e);
    }
  }
}

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
  if (res.status === 206) return new Uint8Array(await res.arrayBuffer());
  if (res.status === 200) {
    // Server ignored the range; only acceptable when we asked for everything from 0.
    const all = new Uint8Array(await res.arrayBuffer());
    return all.subarray(start, end);
  }
  throw new SourceError(`HTTP ${res.status} while reading ${url}`);
}

const ZIP_LOCAL_SIG = 0x04034b50;

async function zipDataOffset(src: Extract<FileSource, { type: "zip" }>): Promise<number> {
  const header = await readSource(src.parent, src.headerOffset, src.headerOffset + 30);
  const v = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (header.length < 30 || v.getUint32(0, true) !== ZIP_LOCAL_SIG) throw new SourceError("Corrupt ZIP local header");
  return src.headerOffset + 30 + v.getUint16(26, true) + v.getUint16(28, true);
}

// Small cache so repeated range reads of one deflated member don't re-inflate it.
const inflateCache: { key: Extract<FileSource, { type: "zip" }>; data: Uint8Array }[] = [];

async function inflateZipEntry(src: Extract<FileSource, { type: "zip" }>): Promise<Uint8Array> {
  const hit = inflateCache.find((c) => c.key === src);
  if (hit) return hit.data;
  if (src.method !== 8) throw new SourceError(`Unsupported ZIP compression method ${src.method}`);
  const dataStart = await zipDataOffset(src);
  const compressed = await readSource(src.parent, dataStart, dataStart + src.compressedSize);
  const data = inflateSync(compressed, { out: new Uint8Array(src.size) });
  inflateCache.unshift({ key: src, data });
  if (inflateCache.length > 4) inflateCache.pop();
  return data;
}

/** Materialize a source as a Blob (for downloads, object URLs, <img>/<audio> previews). */
export async function sourceToBlob(src: FileSource, type = ""): Promise<Blob> {
  switch (src.type) {
    case "blob":
      return type && src.blob.type !== type ? new Blob([src.blob], { type }) : src.blob;
    case "slice": {
      const parts: BlobPart[] = [];
      if (src.prefix?.length) parts.push(src.prefix as Uint8Array<ArrayBuffer>);
      if (src.parent.type === "blob") parts.push(src.parent.blob.slice(src.offset, src.offset + src.length));
      else parts.push((await readSource(src.parent, src.offset, src.offset + src.length)) as Uint8Array<ArrayBuffer>);
      return new Blob(parts, { type });
    }
    case "zip":
      if (src.method === 0 && src.parent.type === "blob") {
        const start = await zipDataOffset(src);
        return new Blob([src.parent.blob.slice(start, start + src.size)], { type });
      }
      return new Blob([(await readSource(src)) as Uint8Array<ArrayBuffer>], { type });
    default:
      return new Blob([(await readSource(src)) as Uint8Array<ArrayBuffer>], { type });
  }
}

export interface UrlProbe {
  size: number;
  rangeSupported: boolean;
  name: string;
}

/** Find a remote file's size and whether it can be read with Range requests (needs CORS). */
export async function probeUrl(url: string): Promise<UrlProbe> {
  const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
  const nameFromUrl = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "download");
  const disposition = res.headers.get("content-disposition") ?? "";
  const nameFromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1];
  const name = nameFromHeader ? decodeURIComponent(nameFromHeader) : nameFromUrl;
  if (res.status === 206) {
    const range = res.headers.get("content-range") ?? "";
    const total = Number(/\/(\d+)$/.exec(range)?.[1]);
    await res.body?.cancel();
    if (Number.isFinite(total) && total > 0) return { size: total, rangeSupported: true, name };
  }
  if (res.ok) {
    const len = Number(res.headers.get("content-length"));
    await res.body?.cancel();
    return { size: Number.isFinite(len) ? len : 0, rangeSupported: false, name };
  }
  throw new SourceError(`Server answered HTTP ${res.status}`);
}
