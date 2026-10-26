import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesSource } from "../../core/vfs/source";
import { buildIndex } from "./build";
import { imageCatalog, mergeShow, replay, resolveLayers, xalignFor } from "./stage";

const GAME = "test/fixtures/analyzer/src/game";
function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe("stage", async () => {
  const all = [...walk(GAME)];
  const images = all.filter((p) => p.endsWith(".png")).map((p) => p.slice(GAME.length + 1));
  const ix = await buildIndex({
    scripts: all.filter((p) => p.endsWith(".rpyc")).map((p) => ({ fileId: p, path: p, source: bytesSource(readFileSync(p)) })),
    imageFiles: images.map((g) => ({ fileId: g, gamePath: g })),
  });
  const cat = imageCatalog(ix, images);

  it("resolves plain, aliased and layered images", () => {
    expect(resolveLayers(cat, "bg street")).toEqual(["images/bg room.png"]);
    expect(resolveLayers(cat, "eileen happy")).toEqual(["images/sprites/eileen happy.png"]);
    expect(resolveLayers(cat, "lucy")).toEqual(["images/lucy_base.png", "images/lucy_smile.png"]);
    expect(resolveLayers(cat, "lucy frown glasses")).toEqual(["images/lucy_base.png", "images/lucy_frown.png", "images/lucy_glasses.png"]);
  });

  it("merges layered attributes like Ren'Py", () => {
    expect(mergeShow(cat, "lucy smile glasses", "lucy frown")).toBe("lucy glasses frown");
    expect(mergeShow(cat, "eileen happy", "eileen sad")).toBe("eileen sad");
  });

  it("replays a scene", () => {
    const scene = ix.scenes.find((s) => s.label === "meet_lucy")!;
    const lastSay = scene.events.map((e) => e.type).lastIndexOf("say");
    const st = replay(cat, scene.background, scene.events, lastSay);
    expect(st.background).toBe("bg street");
    expect(st.sprites).toEqual([{ tag: "lucy", image: "lucy glasses frown", at: [] }]);
    expect(xalignFor(["left"])).toBe(0);
    expect(xalignFor(["right"])).toBe(1);
  });
});
