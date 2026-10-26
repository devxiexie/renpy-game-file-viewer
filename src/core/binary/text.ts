const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const utf8Lenient = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

export function decodeUtf8(bytes: Uint8Array): string {
  return utf8Lenient.decode(bytes);
}

/** Decode as UTF-8 if valid, otherwise as Latin-1 (byte-preserving). */
export function decodeUtf8OrLatin1(bytes: Uint8Array): string {
  try {
    return utf8Strict.decode(bytes);
  } catch {
    return decodeLatin1(bytes);
  }
}

export function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

export function encodeUtf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

export function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export function startsWithBytes(data: Uint8Array, prefix: string): boolean {
  if (data.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (data[i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
