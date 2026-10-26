// Print the top-level AST of an .rpyc file. Usage: tsx scripts/dump-rpyc.ts <file> [depth] [maxStatements]
import { readFileSync } from "node:fs";
import { readRpyc } from "../src/formats/rpyc/container";
import { pyRepr } from "../src/formats/pickle/repr";
const [file, depth = "5", max = "20"] = process.argv.slice(2);
const r = readRpyc(readFileSync(file));
console.log("format:", r.format, "slots:", JSON.stringify(r.slots), "meta:", pyRepr(r.meta, 2));
for (const s of r.statements.slice(0, Number(max))) console.log(pyRepr(s, Number(depth)), "\n");
