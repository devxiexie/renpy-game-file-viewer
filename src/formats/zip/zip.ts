import { decodeLatin1, decodeUtf8 } from "../../core/binary/text";
import { readSource, sourceSize, type FileSource } from "../../core/vfs/source";

export interface ZipEntry {
  path: string;
  size: number;
  compressedSize: number;
  method: number;
  headerOffset: number;
  encrypted: boolean;
}

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_SIG = 0x02014b50;

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function u64(v: DataView, off: number): number {
  const n = v.getBigUint64(off, true);
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError("ZIP offset too large");
  return Number(n);
}

/** Read a ZIP central directory (incl. ZIP64) without loading the archive into memory. */
export async function readZipIndex(src: FileSource): Promise<ZipEntry[]> {
  const size = sourceSize(src);
  const tailLen = Math.min(size, 65557);
  const tail = await readSource(src, size - tailLen, size);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Not a ZIP file (end of central directory not found)");

  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);

  if ((count === 0xffff || cdOffset === 0xffffffff) && eocd >= 20 && tv.getUint32(eocd - 20, true) === EOCD64_LOCATOR_SIG) {
    const eocd64Offset = u64(tv, eocd - 20 + 8);
    const rec = view(await readSource(src, eocd64Offset, eocd64Offset + 56));
    if (rec.getUint32(0, true) !== EOCD64_SIG) throw new ZipError("Corrupt ZIP64 end record");
    count = u64(rec, 32);
    cdSize = u64(rec, 40);
    cdOffset = u64(rec, 48);
  }

  const cd = await readSource(src, cdOffset, cdOffset + cdSize);
  const cv = view(cd);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cv.getUint32(p, true) !== CENTRAL_SIG) throw new ZipError("Corrupt ZIP central directory");
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    let compressedSize = cv.getUint32(p + 20, true);
    let uncompressed = cv.getUint32(p + 24, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    let headerOffset = cv.getUint32(p + 42, true);
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen);
    const name = flags & 0x800 ? decodeUtf8(nameBytes) : decodeName(nameBytes);

    // ZIP64 extra field (id 1) holds the 64-bit values that overflowed.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cv.getUint16(e, true);
      const len = cv.getUint16(e + 2, true);
      if (id === 1) {
        let q = e + 4;
        if (uncompressed === 0xffffffff) (uncompressed = u64(cv, q)), (q += 8);
        if (compressedSize === 0xffffffff) (compressedSize = u64(cv, q)), (q += 8);
        if (headerOffset === 0xffffffff) headerOffset = u64(cv, q);
      }
      e += 4 + len;
    }
    p = extraEnd + commentLen;
    if (name.endsWith("/")) continue; // directory entry
    entries.push({ path: name.replace(/\\/g, "/"), size: uncompressed, compressedSize, method, headerOffset, encrypted: !!(flags & 1) });
  }
  return entries;
}

/** Names without the UTF-8 flag: try UTF-8 (common in practice), else CP437-ish Latin-1. */
function decodeName(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(b);
  } catch {
    return decodeLatin1(b);
  }
}

export function zipEntrySource(parent: FileSource, e: ZipEntry): FileSource {
  return { type: "zip", parent, headerOffset: e.headerOffset, compressedSize: e.compressedSize, size: e.size, method: e.method };
}
