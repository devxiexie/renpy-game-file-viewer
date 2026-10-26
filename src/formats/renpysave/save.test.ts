import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { pickle } from "../pickle/pickler";
import { patchPickle } from "../pickle/patch";
import { PyObject } from "../pickle/types";
import { SpanTracker, unpickle } from "../pickle/unpickler";
import { loadSave, writeSave } from "./save";

const DIR = "test/fixtures/saves";

describe.each(["proto2-1-1-LT1.save", "proto5-1-1-LT1.save"])("save %s", (file) => {
  const data = readFileSync(`${DIR}/${file}`);

  it("reads metadata, screenshot and store roots", () => {
    const save = loadSave(data);
    expect(save.kind).toBe("save");
    expect(save.meta.saveName).toBe("Chapter 2");
    expect(save.meta.renpyVersion).toBe("8.3.0.0");
    expect(save.meta.runtimeSeconds).toBe(754.5);
    expect(save.screenshot?.length).toBeGreaterThan(100);
    expect(save.signed).toBe(true);
    expect(save.root.get("store.money")).toBe(120);
    expect(save.root.get("store.mc_name")).toBe("Tom");
    expect(save.root.get("store.inventory")).toEqual(["sword", "potion", 3]);
    expect((save.root.get("store.player") as PyObject).attrs.hp).toBe(42);
  });

  it("patches scalars in place and keeps everything else intact", () => {
    const save = loadSave(data);
    const t = save.tracker;
    const roots = save.rootContainer;
    const player = save.root.get("store.player") as PyObject;
    const inventory = save.root.get("store.inventory") as unknown[];
    const stats = player.attrs.stats as Map<string, unknown>;
    const edits = [
      { span: t.get(roots, "store.money")!, value: 999999 },
      { span: t.get(roots, "store.big")!, value: 2n ** 70n },
      { span: t.get(roots, "store.affection")!, value: 0.5 },
      { span: t.get(roots, "store.met_sylvie")!, value: false },
      { span: t.get(roots, "store.mc_name")!, value: "Zoë ✓" },
      { span: t.get(player, "hp")!, value: -5 },
      { span: t.get(inventory, 1)!, value: "elixir" },
      { span: t.get(stats, "luck")!, value: 9.75 },
    ];
    expect(edits.every((e) => e.span)).toBe(true);
    const out = writeSave(save, edits);
    const again = loadSave(out);
    expect(again.root.get("store.money")).toBe(999999);
    expect(again.root.get("store.big")).toBe(2n ** 70n);
    expect(again.root.get("store.affection")).toBe(0.5);
    expect(again.root.get("store.met_sylvie")).toBe(false);
    expect(again.root.get("store.mc_name")).toBe("Zoë ✓");
    expect(again.root.get("store.inventory")).toEqual(["sword", "elixir", 3]);
    const p2 = again.root.get("store.player") as PyObject;
    expect(p2.attrs.hp).toBe(-5);
    expect((p2.attrs.stats as Map<string, unknown>).get("luck")).toBe(9.75);
    expect(again.tracker.frames).toEqual([]);
    // Non-log entries are carried over unchanged.
    const before = unzipSync(data);
    const after = unzipSync(out);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(after["screenshot.png"]).toEqual(before["screenshot.png"]);
    expect(after["json"]).toEqual(before["json"]);
  });
});

describe("persistent", () => {
  it("reads and edits persistent fields", () => {
    const p = loadSave(readFileSync(`${DIR}/persistent`));
    expect(p.kind).toBe("persistent");
    expect(p.root.get("endings")).toBe(2);
    const out = writeSave(p, [
      { span: p.tracker.get(p.rootContainer, "endings")!, value: 7 },
      { span: p.tracker.get(p.rootContainer, "gallery_unlocked")!, value: true },
    ]);
    const again = loadSave(out);
    expect(again.root.get("endings")).toBe(7);
    expect(again.root.get("gallery_unlocked")).toBe(true);
    expect(again.root.get("player_name")).toBe("Tom");
  });
});

describe("Python 2 str values", () => {
  it("keeps py2 str type when editing", () => {
    const data = pickle(new Map<unknown, unknown>([["store.name", new TextEncoder().encode("Bob")]]));
    const tracker = new SpanTracker();
    const root = unpickle(data, { track: tracker }) as Map<unknown, unknown>;
    const span = tracker.get(root, "store.name")!;
    expect(span.type).toBe("py2str");
    const out = patchPickle(data, [{ span, value: "Alice" }]);
    expect((unpickle(out, { py2Str: "bytes" }) as Map<unknown, unknown>).get("store.name")).toEqual(new TextEncoder().encode("Alice"));
  });
});

describe("real Ren'Py 8.5 save", () => {
  // Saved right after `$ money = 99` changed it from its default of 42, so the active rollback
  // entry still holds 42: that's the value Ren'Py restores on load unless it is patched too.
  const data = readFileSync(`${DIR}/real/renpy853-money-changed-after-checkpoint.save`);

  it("patches the rollback entry Ren'Py restores on load", () => {
    const save = loadSave(data);
    expect(save.root.get("store.money")).toBe(99);
    expect(save.rollbackStores[0].get("store")!.get("money")).toBe(42);
    const out = loadSave(writeSave(save, [{ span: save.tracker.get(save.rootContainer, "store.money")!, value: 12345 }]));
    expect(out.root.get("store.money")).toBe(12345);
    expect(out.rollbackStores[0].get("store")!.get("money")).toBe(12345);
  });
});
