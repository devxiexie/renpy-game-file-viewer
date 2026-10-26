import { encodeUtf8 } from "../../core/binary/text";
import { isTuple } from "./types";

/**
 * Minimal protocol-2 pickler for plain data: None, bool, int, bigint, float, str,
 * bytes (as py2 str, which Python 3 reads back as bytes with encoding="bytes"),
 * list, tuple and Map/dict. Readable by both Python 2 and 3 (Ren'Py 6–8).
 */
export function pickle(value: unknown): Uint8Array {
  const out: number[] = [];
  const chunks: Uint8Array[] = [];
  const flush = () => {
    if (out.length) {
      chunks.push(Uint8Array.from(out));
      out.length = 0;
    }
  };
  const bytes = (b: Uint8Array) => {
    flush();
    chunks.push(b);
  };
  const u32 = (n: number) => out.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);

  const writeInt = (n: number | bigint) => {
    const big = BigInt(n);
    if (big >= 0n && big < 256n) {
      out.push(0x4b, Number(big)); // BININT1
    } else if (big >= 0n && big < 65536n) {
      const v = Number(big);
      out.push(0x4d, v & 0xff, v >> 8); // BININT2
    } else if (big >= -(2n ** 31n) && big < 2n ** 31n) {
      out.push(0x4a); // BININT
      u32(Number(BigInt.asUintN(32, big)));
    } else {
      // LONG1: little-endian two's complement, minimal length.
      const le: number[] = [];
      let v = big;
      for (;;) {
        le.push(Number(v & 0xffn));
        v >>= 8n;
        const last = le[le.length - 1];
        if ((v === 0n && !(last & 0x80)) || (v === -1n && last & 0x80)) break;
      }
      out.push(0x8a, le.length, ...le);
    }
  };

  const write = (v: unknown): void => {
    if (v === null || v === undefined) out.push(0x4e);
    else if (v === true) out.push(0x88);
    else if (v === false) out.push(0x89);
    else if (typeof v === "bigint") writeInt(v);
    else if (typeof v === "number") {
      if (Number.isInteger(v)) writeInt(v);
      else {
        out.push(0x47); // BINFLOAT (big-endian double)
        const b = new Uint8Array(8);
        new DataView(b.buffer).setFloat64(0, v, false);
        out.push(...b);
      }
    } else if (typeof v === "string") {
      const b = encodeUtf8(v);
      out.push(0x58); // BINUNICODE
      u32(b.length);
      bytes(b);
    } else if (v instanceof Uint8Array) {
      if (v.length < 256) out.push(0x55, v.length); // SHORT_BINSTRING
      else {
        out.push(0x54); // BINSTRING
        u32(v.length);
      }
      bytes(v);
    } else if (isTuple(v)) {
      if (v.length === 0) out.push(0x29);
      else if (v.length <= 3) {
        v.forEach(write);
        out.push([0x85, 0x86, 0x87][v.length - 1]);
      } else {
        out.push(0x28);
        v.forEach(write);
        out.push(0x74);
      }
    } else if (Array.isArray(v)) {
      out.push(0x5d); // EMPTY_LIST
      for (let i = 0; i < v.length; i += 1000) {
        out.push(0x28); // MARK
        v.slice(i, i + 1000).forEach(write);
        out.push(0x65); // APPENDS
      }
    } else if (v instanceof Map) {
      out.push(0x7d); // EMPTY_DICT
      const items = [...v];
      for (let i = 0; i < items.length; i += 1000) {
        out.push(0x28);
        for (const [k, x] of items.slice(i, i + 1000)) {
          write(k);
          write(x);
        }
        out.push(0x75); // SETITEMS
      }
    } else {
      throw new TypeError(`Cannot pickle value of type ${typeof v}`);
    }
  };

  out.push(0x80, 2); // PROTO 2
  write(value);
  out.push(0x2e); // STOP
  flush();
  let len = 0;
  for (const c of chunks) len += c.length;
  const result = new Uint8Array(len);
  let pos = 0;
  for (const c of chunks) {
    result.set(c, pos);
    pos += c.length;
  }
  return result;
}
