import { unzlibSync, zlibSync } from "fflate";
import { decodeLatin1, decodeUtf8OrLatin1, encodeLatin1 } from "../../core/binary/text";
import { readSource, sliceSource, sourceSize, type FileSource } from "../../core/vfs/source";
import { pickle } from "../pickle/pickler";
import { makeTuple } from "../pickle/types";
import { unpickle } from "../pickle/unpickler";

export type RpaVersion = "RPA-1.0" | "RPA-2.0" | "RPA-3.0" | "RPA-3.2" | "ALT-1.0" | "custom";

export interface RpaEntry {
  /** Path inside the archive, using "/" separators. */
  path: string;
  offset: number;
  length: number;
  /** Bytes stored in the index that precede the file data (rarely used). */
  prefix: Uint8Array;
  /** Total file size (prefix + length). */
  size: number;
}

export interface RpaIndex {
  version: RpaVersion;
  header: string;
  key: number;
  indexOffset: number;
  entries: RpaEntry[];
}

export class RpaError extends Error {}

const HEADER_BYTES = 256;

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  throw new RpaError(`Unexpected index value ${String(v)}`);
}

function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") return encodeLatin1(v);
  return new Uint8Array(0);
}

function pathString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Uint8Array) return decodeUtf8OrLatin1(v);
  return String(v);
}

interface ParsedHeader {
  version: RpaVersion;
  header: string;
  indexOffset: number;
  key: bigint;
}

/** Parse the first line of an archive. Unknown variants with hex fields are tried as RPA-3.0. */
export function parseRpaHeader(head: Uint8Array): ParsedHeader | null {
  const nl = head.indexOf(0x0a);
  const line = decodeLatin1(head.subarray(0, nl < 0 ? Math.min(head.length, 80) : nl)).trim();
  const parts = line.split(/\s+/);
  const hex = (s: string | undefined) => (s && /^[0-9a-fA-F]+$/.test(s) ? BigInt("0x" + s) : null);

  if (parts[0] === "RPA-3.0" || parts[0] === "RPA-3.2") {
    const offset = hex(parts[1]);
    if (offset === null) return null;
    // RPA-3.2 has an extra (unused) field before the key; unrpa XORs every remaining field.
    let key = 0n;
    for (const p of parts.slice(parts[0] === "RPA-3.2" ? 3 : 2)) key ^= hex(p) ?? 0n;
    return { version: parts[0], header: line, indexOffset: Number(offset), key };
  }
  if (parts[0] === "RPA-2.0") {
    const offset = hex(parts[1]);
    return offset === null ? null : { version: "RPA-2.0", header: line, indexOffset: Number(offset), key: 0n };
  }
  if (parts[0] === "ALT-1.0") {
    const key = hex(parts[1]);
    const offset = hex(parts[2]);
    if (key === null || offset === null) return null;
    return { version: "ALT-1.0", header: line, indexOffset: Number(offset), key: key ^ 0xdabe8df0n };
  }
  // Renamed magic (games sometimes patch Ren'Py's header): "<magic> <offset> <key>".
  if (parts.length >= 3 && hex(parts[1]) !== null && hex(parts[2]) !== null && parts[1].length >= 8) {
    return { version: "custom", header: line, indexOffset: Number(hex(parts[1])), key: hex(parts[2])! };
  }
  return null;
}

function buildEntries(index: unknown, key: bigint): RpaEntry[] {
  if (!(index instanceof Map)) throw new RpaError("Archive index is not a dictionary");
  const entries: RpaEntry[] = [];
  for (const [rawPath, rawList] of index) {
    const list = Array.isArray(rawList) ? rawList : [];
    const first = list[0];
    if (!Array.isArray(first) || first.length < 2) continue;
    const offset = Number(toBigInt(first[0]) ^ key);
    const length = Number(toBigInt(first[1]) ^ key);
    const prefix = first.length >= 3 ? toBytes(first[2]) : new Uint8Array(0);
    entries.push({ path: pathString(rawPath).replace(/\\/g, "/"), offset, length, prefix, size: length + prefix.length });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

function decodeIndex(compressed: Uint8Array): unknown {
  let raw: Uint8Array;
  try {
    raw = unzlibSync(compressed);
  } catch (e) {
    throw new RpaError(`Archive index is not valid zlib data: ${String(e)}`);
  }
  return unpickle(raw, { py2Str: "bytes" });
}

/** Read the index of an .rpa archive. For RPA-1.0, pass the matching .rpi file as `rpi`. */
export async function readRpaIndex(archive: FileSource, rpi?: FileSource): Promise<RpaIndex> {
  if (rpi) {
    const index = decodeIndex(await readSource(rpi));
    return { version: "RPA-1.0", header: "", key: 0, indexOffset: 0, entries: buildEntries(index, 0n) };
  }
  const head = await readSource(archive, 0, HEADER_BYTES);
  const parsed = parseRpaHeader(head);
  if (!parsed) throw new RpaError("Unrecognized archive header. This may be an obfuscated or non-Ren'Py archive.");
  const size = sourceSize(archive);
  if (parsed.indexOffset <= 0 || parsed.indexOffset >= size) throw new RpaError("Archive index offset is out of range");
  const index = decodeIndex(await readSource(archive, parsed.indexOffset, size));
  const entries = buildEntries(index, parsed.key);
  for (const e of entries) {
    if (e.offset < 0 || e.offset + e.length > size) throw new RpaError(`Entry ${e.path} points outside the archive (wrong key?)`);
  }
  return { version: parsed.version, header: parsed.header, key: Number(parsed.key), indexOffset: parsed.indexOffset, entries };
}

export function rpaEntrySource(archive: FileSource, entry: RpaEntry): FileSource {
  return sliceSource(archive, entry.offset, entry.length, entry.prefix);
}

export interface RpaWriteFile {
  path: string;
  data: Blob | Uint8Array;
}

/**
 * Build an RPA-3.0 archive (the format written by Ren'Py 6.18+ and readable by 6.x–8.x).
 * Returns a Blob assembled from the input parts, so large files are not copied.
 */
export async function writeRpa(files: RpaWriteFile[], key = 0x42424242): Promise<Blob> {
  const headerLength = 34; // "RPA-3.0 " + 16 hex + " " + 8 hex + "\n"
  const filler = encodeLatin1("Made with Ren'Py.");
  const parts: BlobPart[] = [];
  const index = new Map<unknown, unknown>();
  let offset = headerLength + filler.length;
  parts.push(filler as Uint8Array<ArrayBuffer>);
  const k = BigInt(key >>> 0);
  for (const f of files) {
    const size = f.data instanceof Blob ? f.data.size : f.data.length;
    index.set(f.path, [makeTuple([Number(BigInt(offset) ^ k), Number(BigInt(size) ^ k)])]);
    parts.push(f.data as Blob | Uint8Array<ArrayBuffer>);
    offset += size;
  }
  const indexBytes = zlibSync(pickle(index));
  const header = `RPA-3.0 ${offset.toString(16).padStart(16, "0")} ${(key >>> 0).toString(16).padStart(8, "0")}\n`;
  return new Blob([encodeLatin1(header) as Uint8Array<ArrayBuffer>, ...parts, indexBytes as Uint8Array<ArrayBuffer>]);
}
