import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lineAgreement } from "../../../test/lineMatch";
import { decompileRpyc } from ".";

const FIXTURES = "test/fixtures/rpyc";

describe("decompileRpyc (bundled fixtures)", () => {
  for (const version of readdirSync(FIXTURES).filter((d) => statSync(join(FIXTURES, d)).isDirectory())) {
    for (const file of readdirSync(join(FIXTURES, version)).filter((f) => f.endsWith(".rpyc"))) {
      it(`${version}/${file} matches its source`, () => {
        const result = decompileRpyc(readFileSync(join(FIXTURES, version, file)));
        const original = readFileSync(join(FIXTURES, version, file.slice(0, -1)), "utf8");
        const { ratio, misses } = lineAgreement(original, result.source);
        // Screens lose keyword placement/order (not stored), so allow some drift there.
        const threshold = file.includes("screens") ? 0.7 : 0.95;
        expect(ratio, misses.slice(0, 20).join("\n")).toBeGreaterThanOrEqual(threshold);
        expect(result.warnings).toEqual([]);
      });
    }
  }

  it("decompiles say, menu, and show-with constructs exactly", () => {
    const { source } = decompileRpyc(readFileSync(join(FIXTURES, "8.5.3", "the_question_script.rpyc")));
    expect(source).toContain('    s "Sure, but what\'s a \\"visual novel?\\""');
    expect(source).toContain("    scene bg lecturehall");
    expect(source).toContain("    menu:");
    expect(source).toContain("label rightaway:");
  });
});

// Full-corpus check against unpacked Ren'Py SDKs: RENPY_SDK_DIRS="/path/a:/path/b" npm test
const sdkDirs = (process.env.RENPY_SDK_DIRS ?? "").split(":").filter((d) => d && existsSync(d));
describe.skipIf(sdkDirs.length === 0)("decompileRpyc (SDK corpus)", () => {
  function* walk(d: string): Generator<string> {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) yield* walk(p);
      else if (n.endsWith(".rpyc")) yield p;
    }
  }
  for (const dir of sdkDirs) {
    it(`agrees with ≥96% of source lines in ${dir}`, () => {
      let total = 0;
      let matched = 0;
      for (const f of walk(dir)) {
        const src = f.slice(0, -1);
        if (!existsSync(src) || f.includes("testcases")) continue;
        const { source } = decompileRpyc(readFileSync(f));
        const original = readFileSync(src, "utf8");
        const lines = original.split("\n").filter((l) => l.replace(/#.*$/, "").trim()).length;
        total += lines;
        matched += lineAgreement(original, source).ratio * lines;
      }
      expect(matched / total).toBeGreaterThanOrEqual(0.96);
    });
  }
});
