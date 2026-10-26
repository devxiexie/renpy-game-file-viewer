/** File-type classification used for previews, search and export. */
export type FileKind = "image" | "audio" | "video" | "text" | "script" | "rpyc" | "archive" | "font" | "save" | "binary";

const EXT_KIND: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => exts.split(" ").forEach((e) => (EXT_KIND[e] = kind));
add("image", "png jpg jpeg webp gif bmp avif svg ico tga");
add("audio", "ogg opus mp3 wav flac m4a aac");
add("video", "webm ogv mp4 m4v mkv mpg mpeg avi mov");
add("script", "rpy rpym py");
add("text", "txt json csv tsv xml html htm js css ini cfg md yml yaml toml log rpyb lst");
add("rpyc", "rpyc rpymc");
add("archive", "rpa zip apk");
add("font", "ttf otf woff woff2");
add("save", "save");

export function extensionOf(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith("_ren.py")) return "py";
  const i = lower.lastIndexOf(".");
  return i < 0 ? "" : lower.slice(i + 1);
}

export function kindOf(name: string): FileKind {
  if (name === "persistent") return "save";
  return EXT_KIND[extensionOf(name)] ?? "binary";
}

export function isSearchable(name: string): boolean {
  const k = kindOf(name);
  return k === "script" || k === "text" || k === "rpyc";
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
  avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon",
  ogg: "audio/ogg", opus: "audio/ogg", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac",
  webm: "video/webm", ogv: "video/ogg", mp4: "video/mp4", m4v: "video/mp4", mkv: "video/x-matroska", mov: "video/quicktime",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2",
  txt: "text/plain", json: "application/json", rpy: "text/plain", py: "text/plain",
};

export function mimeOf(name: string): string {
  return MIME[extensionOf(name)] ?? "application/octet-stream";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}
