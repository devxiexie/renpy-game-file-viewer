// Decompile every .rpyc under <dir> that has a sibling .rpy and report line-level agreement.
// Usage: tsx scripts/compare-decompile.ts <dir> [--show N] [--file substring]
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { decompileRpyc } from "../src/formats/rpyc";

const args = process.argv.slice(2);
const dir = args[0];
const show = args.includes("--show") ? Number(args[args.indexOf("--show") + 1]) : 0;
const only = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;

function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (n.endsWith(".rpyc")) yield p;
  }
}
const norm = (s: string) => s.replace(/#.*$/, "").replace(/\s+/g, " ").trim();
const isCode = (s: string) => norm(s) !== "";

let total = 0, matched = 0, files = 0, errors = 0;
const perFile: { f: string; pct: number; miss: string[] }[] = [];
for (const f of walk(dir)) {
  const src = f.slice(0, -1);
  if (!existsSync(src) || (only && !f.includes(only))) continue;
  files++;
  let out: string;
  try {
    out = decompileRpyc(readFileSync(f)).source;
  } catch (e) {
    errors++;
    console.log("ERROR", f, e);
    continue;
  }
  const orig = readFileSync(src, "utf8").replace(/^﻿/, "").split(/\r?\n/);
  const ours = out.split("\n");
  let t = 0, m = 0;
  const miss: string[] = [];
  orig.forEach((line, i) => {
    if (!isCode(line)) return;
    t++;
    if (norm(ours[i] ?? "") === norm(line)) m++;
    else if (miss.length < 400) miss.push(`${i + 1}\n  - ${line.trim()}\n  + ${(ours[i] ?? "<eof>").trim()}`);
  });
  total += t; matched += m;
  perFile.push({ f, pct: t ? m / t : 1, miss });
}
perFile.sort((a, b) => a.pct - b.pct);
console.log(`files=${files} errors=${errors} lines=${total} exact=${matched} (${((100 * matched) / total).toFixed(2)}%)`);
for (const p of perFile.slice(0, 15)) console.log(`${(100 * p.pct).toFixed(1).padStart(6)}%  ${p.f.split("-sdk/").pop()}`);
if (show) for (const p of perFile.slice(0, show)) { console.log("\n=== " + p.f); console.log(p.miss.slice(0, 40).join("\n")); }
