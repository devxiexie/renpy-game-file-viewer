import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickle } from "./pickler";
import { PyObject, isTuple, makeTuple } from "./types";
import { unpickle } from "./unpickler";

const fixtures = JSON.parse(readFileSync("test/fixtures/pickle/protocols.json", "utf8")) as Record<string, string>;
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

describe("unpickle (CPython fixtures)", () => {
  for (const [protocol, data] of Object.entries(fixtures)) {
    it(`reads protocol ${protocol}`, () => {
      const root = unpickle(b64(data)) as Map<string, unknown>;
      expect(root).toBeInstanceOf(Map);
      const thing = root.get("thing") as PyObject;
      expect(thing).toBeInstanceOf(PyObject);
      expect(thing.cls).toBe("fixturemod.Thing");
      expect(thing.attrs.name).toBe("thing");
      expect(thing.attrs.text).toBe("héllo ✓ \u{1F600}");
      const values = thing.attrs.values as unknown[];
      expect(values.slice(0, 3)).toEqual([1, -2, 3.5]);
      expect(values[3]).toBe(2n ** 70n);
      expect(values[4]).toBe(-(2 ** 40));
      expect(values.slice(5)).toEqual([null, true, false]);
      const nested = thing.attrs.nested as Map<unknown, unknown>;
      const k = nested.get("k");
      expect(isTuple(k)).toBe(true);
      expect(k).toEqual([1, 2]);
      expect(nested.get("bytes")).toEqual(Uint8Array.from([0, 0xff, 97, 98, 99]));
      const list = root.get("list") as unknown[];
      expect(list[2]).toBe(list[0]); // shared reference via memo
      expect(root.get("set")).toEqual(new Set([1, 2, 3]));
      expect(root.get("frozen")).toEqual(new Set(["a"]));
    });
  }
});

describe("pickle → unpickle round trip", () => {
  it("round-trips plain data", () => {
    const value = new Map<unknown, unknown>([
      ["a", [1, 255, 256, 65535, 65536, -1, 2 ** 31, -(2 ** 31) - 1, 2n ** 64n, -(2n ** 64n), 1.5, null, true, false]],
      ["t", makeTuple(["x", makeTuple([1, 2, 3]), makeTuple([1, 2, 3, 4])])],
      ["b", Uint8Array.from([1, 2, 3])],
      ["u", "ünïcode"],
      ["big", Array.from({ length: 2500 }, (_, i) => i)],
    ]);
    const back = unpickle(pickle(value), { py2Str: "bytes" }) as Map<unknown, unknown>;
    expect(back.get("a")).toEqual(value.get("a"));
    expect(back.get("t")).toEqual(value.get("t"));
    expect(isTuple((back.get("t") as unknown[])[1])).toBe(true);
    expect(back.get("b")).toEqual(value.get("b"));
    expect(back.get("u")).toBe("ünïcode");
    expect(back.get("big")).toEqual(value.get("big"));
  });
});
