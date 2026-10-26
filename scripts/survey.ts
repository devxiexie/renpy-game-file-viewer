// Survey AST node classes + attributes across a directory of .rpyc files.
// Usage: tsx scripts/survey.ts <dir> [classFilter]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readRpyc } from "../src/formats/rpyc/container";
import { PyObject } from "../src/formats/pickle/types";

function* walkFiles(dir: string): Generator<string> {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) yield* walkFiles(p);
    else if (n.endsWith(".rpyc") || n.endsWith(".rpymc")) yield p;
  }
}

const [dir, filter] = process.argv.slice(2);
const fields = new Map<string, Map<string, number>>();
const argCounts = new Map<string, Set<number>>();
let ok = 0, fail = 0;
for (const f of walkFiles(dir)) {
  try {
    const r = readRpyc(readFileSync(f));
    const seen = new Set<unknown>();
    const visit = (o: unknown): void => {
      if (o === null || typeof o !== "object" || seen.has(o)) return;
      seen.add(o);
      if (o instanceof PyObject) {
        const key = Object.keys(o.attrs).sort().join(" ") + (o.state !== undefined ? " <state>" : "");
        const m = fields.get(o.cls) ?? new Map();
        m.set(key, (m.get(key) ?? 0) + 1);
        fields.set(o.cls, m);
        (argCounts.get(o.cls) ?? argCounts.set(o.cls, new Set()).get(o.cls)!).add(o.args.length);
        Object.values(o.attrs).forEach(visit);
        o.args.forEach(visit);
        visit(o.state);
        o.items?.forEach(visit);
      } else if (Array.isArray(o) || o instanceof Set) {
        for (const x of o) visit(x);
      } else if (o instanceof Map) {
        for (const [k, v] of o) { visit(k); visit(v); }
      }
    };
    visit(r.statements);
    ok++;
  } catch (e) {
    fail++;
    console.log("ERR", f, String(e).slice(0, 200));
  }
}
console.log(`ok=${ok} fail=${fail}`);
for (const [cls, m] of [...fields].sort()) {
  if (filter && !cls.includes(filter)) continue;
  console.log(`${cls}  args=${[...argCounts.get(cls)!].join(",")}`);
  for (const [k, c] of [...m].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`    ${c}  ${k}`);
}
