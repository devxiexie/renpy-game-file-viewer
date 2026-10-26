/**
 * Evaluate a sequence of adjacent Python string literals ("a" 'b' """c""", optional u/U
 * prefix), as matched by Ren'Py's translation string scanner. Returns null if malformed.
 */
export function evalPyStrings(src: string): string | null {
  let i = 0;
  let out = "";
  const n = src.length;
  const skipWs = () => {
    while (i < n && /[\s\\]/.test(src[i])) i++;
  };
  skipWs();
  if (i >= n) return null;
  while (i < n) {
    if (src[i] === "u" || src[i] === "U") i++;
    const q = src[i];
    if (q !== '"' && q !== "'") return null;
    const triple = src.startsWith(q.repeat(3), i);
    const delim = triple ? q.repeat(3) : q;
    i += delim.length;
    for (;;) {
      if (i >= n) return null;
      if (src.startsWith(delim, i)) {
        i += delim.length;
        break;
      }
      const c = src[i];
      if (c === "\\") {
        const e = src[i + 1];
        i += 2;
        switch (e) {
          case "\n": break;
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "a": out += "\x07"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "v": out += "\v"; break;
          case "x": out += String.fromCharCode(parseInt(src.slice(i, i + 2), 16)); i += 2; break;
          case "u": out += String.fromCharCode(parseInt(src.slice(i, i + 4), 16)); i += 4; break;
          case "U": out += String.fromCodePoint(parseInt(src.slice(i, i + 8), 16)); i += 8; break;
          default:
            if (e !== undefined && /[0-7]/.test(e)) {
              const m = /^[0-7]{1,3}/.exec(src.slice(i - 1))![0];
              out += String.fromCharCode(parseInt(m, 8));
              i += m.length - 1;
            } else if (e === "\\" || e === "'" || e === '"') out += e;
            else out += "\\" + (e ?? "");
        }
      } else {
        if (!triple && c === "\n") return null;
        out += c;
        i++;
      }
    }
    skipWs();
  }
  return out;
}

/** renpy.minstore._p: reflow paragraphs, collapsing single newlines and runs of spaces. */
export function reflowParagraphs(s: string): string {
  return s
    .split(/\n\s*\n/)
    .map((p) => p.split(/\s+/).filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n\n");
}

// Port of renpy.translation.scanstrings.STRING_RE.
const STRING_RE =
  /\b(_|__|___|_p)\s*(\((?:[\s\\\n]*[uU]?(?:"""(?:\\.|\\\n|"{1,2}|[^\\"])*?"""|'''(?:\\.|\\\n|'{1,2}|[^\\'])*?'''|"(?:\\.|\\\n|[^\\"])*"|'(?:\\.|\\\n|[^\\'])*'))+\s*\))/g;

/** Strings marked for translation with _(), __(), ___() or _p() in a line of code. */
export function scanMarkedStrings(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(STRING_RE)) {
    const inner = m[2].slice(1, -1).replace(/\\\n/g, "");
    let s = evalPyStrings(inner.trim());
    if (s === null) continue;
    if (m[1] === "_p") s = reflowParagraphs(s);
    if (s) out.push(s);
  }
  return out;
}
