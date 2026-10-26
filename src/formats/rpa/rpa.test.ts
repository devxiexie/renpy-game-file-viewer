import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bytesSource, readSource } from "../../core/vfs/source";
import { readRpaIndex, rpaEntrySource, writeRpa } from "./rpa";

const expected = JSON.parse(readFileSync("test/fixtures/rpa/expected.json", "utf8")) as Record<string, string>;

async function extractAll(data: Uint8Array) {
  const src = bytesSource(data);
  const index = await readRpaIndex(src);
  const out: Record<string, string> = {};
  for (const e of index.entries) out[e.path] = Buffer.from(await readSource(rpaEntrySource(src, e))).toString("base64");
  return { index, out };
}

describe("readRpaIndex", () => {
  for (const [file, version] of [
    ["v3.rpa", "RPA-3.0"],
    ["v3-prefix.rpa", "RPA-3.0"],
    ["v32.rpa", "RPA-3.2"],
    ["v2.rpa", "RPA-2.0"],
  ] as const) {
    it(`extracts ${file}`, async () => {
      const { index, out } = await extractAll(readFileSync(`test/fixtures/rpa/${file}`));
      expect(index.version).toBe(version);
      expect(out).toEqual(expected);
    });
  }

  it("reads partial ranges across the prefix boundary", async () => {
    const src = bytesSource(readFileSync("test/fixtures/rpa/v3-prefix.rpa"));
    const index = await readRpaIndex(src);
    const entry = index.entries.find((e) => e.path === "images/bg room.png")!;
    expect(entry.prefix.length).toBe(16);
    const part = await readSource(rpaEntrySource(src, entry), 10, 20);
    expect([...part]).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("rejects non-archives", async () => {
    await expect(readRpaIndex(bytesSource(new TextEncoder().encode("hello world")))).rejects.toThrow(/header/);
  });
});

describe("writeRpa", () => {
  it("round-trips through the reader", async () => {
    const files = Object.entries(expected).map(([path, b]) => ({ path, data: Uint8Array.from(Buffer.from(b, "base64")) }));
    const blob = await writeRpa(files, 0xcafebabe);
    const { index, out } = await extractAll(new Uint8Array(await blob.arrayBuffer()));
    expect(index.version).toBe("RPA-3.0");
    expect(index.key).toBe(0xcafebabe);
    expect(out).toEqual(expected);
  });
});
