import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesSource } from "../../core/vfs/source";
import { autoImageName, buildIndex, countWords } from "./build";
import type { AnalyzerIndex } from "./model";

const GAME = "test/fixtures/analyzer/src/game";

function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function index(): Promise<AnalyzerIndex> {
  const all = [...walk(GAME)];
  return buildIndex({
    scripts: all.filter((p) => p.endsWith(".rpyc")).map((p) => ({ fileId: p, path: p, source: bytesSource(readFileSync(p)) })),
    imageFiles: all.filter((p) => /\.(png|jpg)$/.test(p)).map((p) => ({ fileId: p, gamePath: p.slice(GAME.length + 1) })),
  });
}

describe("analyzer index", () => {
  it("helpers", () => {
    expect(countWords("Hello {b}[name]{/b}, it's 3 o'clock!")).toBe(5);
    expect(autoImageName("images/sprites/Eileen Happy@2.png")).toBe("eileen happy");
    expect(autoImageName("gui/button.png")).toBeNull();
  });

  it("labels and flow", async () => {
    const ix = await index();
    expect(ix.errors).toEqual([]);
    const names = ix.labels.map((l) => l.name).sort();
    expect(names).toEqual(["after_park", "bad_end", "ending", "good_end", "meet_lucy", "park", "sam_good", "sam_route", "sam_secret", "sam_shared", "start", "stay_here"]);
    expect(ix.labels.find((l) => l.name === "sam_route")!.reachable).toBe(false);
    expect(ix.diagnostics).toMatchObject({ parsedFiles: 3, failedFiles: 0, dynamicRoutes: 0, unreachableLabels: 4 });
    const start = ix.labels.find((l) => l.name === "start")!;
    expect(start.entry).toBe(true);
    expect(start.menus).toBe(1);
    expect(start.ending).toBe("menu");
    const edge = (from: string, to: string) => ix.edges.find((e) => e.from === from && e.to === to);
    expect(edge("start", "park")).toMatchObject({ kind: "jump", conditional: true });
    expect(edge("start", "stay_here")).toMatchObject({ kind: "call" });
    expect(edge("park", "after_park")).toMatchObject({ kind: "fallthrough" });
    expect(edge("ending", "bad_end")).toMatchObject({ kind: "jump", conditional: false });
    expect(edge("ending", "good_end")).toMatchObject({ kind: "jump", conditional: true });
    expect(ix.labels.find((l) => l.name === "stay_here")!.ending).toBe("return");
    expect(edge("stay_here", "meet_lucy")).toBeUndefined();
  });

  it("characters", async () => {
    const ix = await index();
    const e = ix.characters.find((c) => c.id === "e")!;
    expect(e).toMatchObject({ name: "Eileen", defined: true, color: "#c8ffc8", image: "eileen" });
    expect(e.lines).toBe(7);
    expect(e.labels).toEqual({ start: 3, park: 3, stay_here: 1 });
    expect(ix.characters.find((c) => c.id === "l")!.name).toBe("Lucy");
    expect(ix.characters.find((c) => c.id === "n")!.kind).toBe("nvl");
    expect(ix.characters.find((c) => c.id === "dyn")!.name).toBe("[player_name]");
    expect(ix.characters.find((c) => c.id === "narrator")!.lines).toBe(4);
    expect(ix.characters.find((c) => c.id === "narrator_alt")).toMatchObject({ defined: true, lines: 0 });
  });

  it("images, layered images and uses", async () => {
    const ix = await index();
    const img = (n: string) => ix.images.find((i) => i.name === n)!;
    expect(img("bg room")).toMatchObject({ kind: "auto", file: "images/bg room.png", uses: 2 });
    expect(img("room combo").composite).toEqual({ width: 640, height: 480, parts: [{ x: 0, y: 0, displayable: "images/bg room.png" }, { x: 100, y: 50, displayable: "images/sprites/eileen happy.png" }] });
    expect(img("intro_clip")).toMatchObject({ kind: "movie", movie: "intro.webm" });
    expect(img("eileen happy")).toMatchObject({ kind: "auto", file: "images/sprites/eileen happy.png", uses: 1 });
    expect(img("bg street")).toMatchObject({ kind: "file", file: "images/bg room.png", uses: 1 });
    expect(img("cg kiss")).toMatchObject({ kind: "file", file: "images/bg park.png" });
    expect(img("intro_movie").kind).toBe("movie");
    expect(img("black_screen").kind).toBe("solid");
    expect(img("eileen wink")).toMatchObject({ kind: "atl", file: "images/sprites/eileen happy.png", uses: 1 });
    expect(img("eileen sad").uses).toBe(1);
    const lucy = img("lucy");
    expect(lucy.kind).toBe("layered");
    expect(lucy.uses).toBe(2);
    expect(lucy.layers).toEqual([
      { group: null, attribute: null, isDefault: true, condition: null, displayable: "lucy_base" },
      { group: "face", attribute: "smile", isDefault: true, condition: null, displayable: "lucy_smile" },
      { group: "face", attribute: "frown", isDefault: false, condition: null, displayable: "lucy_frown" },
      { group: null, attribute: "glasses", isDefault: false, condition: null, displayable: "lucy_glasses" },
      { group: null, attribute: null, isDefault: false, condition: "met_lucy", displayable: "lucy_glasses" },
    ]);
  });

  it("menus", async () => {
    const ix = await index();
    const first = ix.menus[0];
    expect(first.label).toBe("start");
    expect(first.caption).toEqual({ who: "e", what: "Where should we go?" });
    expect(first.items.map((i) => [i.text, i.condition, i.targets])).toEqual([
      ["The park", null, ["park"]],
      ["Stay here", "affection < MAX_AFFECTION", ["stay_here", "ending"]],
      ["Meet Lucy", "not met_lucy", ["meet_lucy"]],
    ]);
    const lucy = ix.menus.find((m) => m.label === "meet_lucy")!;
    expect(lucy.name).toBe("lucy_choice");
    expect(ix.totals.choices).toBe(8);
    const sam = ix.menus.find((m) => m.label === "sam_route")!;
    expect(sam.items.map((i) => [i.text, i.outcome, i.rejoin, i.uniqueLabels, i.writes])).toEqual([
      ["Help Sam", "rejoins", "sam_shared", [], ["sam_points", "money"]],
      ["Refuse", "rejoins", "sam_shared", [], []],
      ["Ask about the secret", "rejoins", "sam_good", ["sam_secret"], ["seen_secret"]],
    ]);
    const startMenu = ix.menus[0];
    expect(startMenu.important).toBe(true);
    expect(startMenu.items.find((i) => i.text === "Stay here")!.major).toBe(false); // stay_here is called, not an ending
  });

  it("variables", async () => {
    const ix = await index();
    const v = (n: string) => ix.variables.find((x) => x.name === n)!;
    const kinds = (n: string) => v(n).refs.map((r) => `${r.kind}:${r.label ?? "-"}`);
    expect(v("affection").declared).toBe("default");
    expect(kinds("affection")).toEqual([
      "declare:-",
      "write:start",
      "write:start",
      "write:park",
      "condition:start",
      "condition:park",
      "condition:ending",
      "read:park",
    ]);
    expect(kinds("met_lucy")).toEqual(["declare:-", "write:start", "condition:start", "condition:ending"]);
    expect(kinds("inventory")).toEqual(["declare:-", "write:park"]);
    expect(v("MAX_AFFECTION").declared).toBe("define");
    expect(kinds("player_name")).toEqual(["declare:-", "write:start"]);
    expect(ix.variables.find((x) => x.name.startsWith("config"))).toBeUndefined();
  });

  it("scenes", async () => {
    const ix = await index();
    const park = ix.scenes.find((s) => s.label === "park")!;
    expect(park.background).toBe("bg park");
    expect(park.events.map((e) => e.type)).toEqual(["scene", "with", "show", "say", "say", "say", "hide", "say"]);
    const lucy = ix.scenes.find((s) => s.label === "meet_lucy")!;
    expect(lucy.events.filter((e) => e.type === "show").map((e) => e.type === "show" && e.image)).toEqual(["lucy smile glasses", "lucy frown"]);
    expect(ix.totals.dialogue).toBe(27);
  });
});

describe("scene continuity", () => {
  it("carries the background into labels that continue a scene", async () => {
    const ix = await index();
    // stay_here is only *called*, so it keeps no inherited background; after_park falls through from park.
    expect(ix.scenes.find((s) => s.label === "after_park")!.background).toBe("bg park");
  });
});

describe("variables & characters v2", () => {
  it("categorizes variables and finds requirements", async () => {
    const ix = await index();
    const v = (n: string) => ix.variables.find((x) => x.name === n)!;
    expect(v("money")).toMatchObject({ category: "currency", command: "money = 99999" });
    expect(v("money").facts.needsAtLeast).toBe(100);
    expect(v("sam_points")).toMatchObject({ category: "relationship", command: "sam_points = 5" });
    expect(v("sam_points").tags).toEqual(expect.arrayContaining(["clear-target", "repeatedly-increased", "grind"]));
    expect(v("met_lucy")).toMatchObject({ category: "flag", command: "met_lucy = True" });
    expect(v("inventory").command).toBeNull();
    expect(v("MAX_AFFECTION").command).toBeNull();
  });

  it("finds portraits and dialogue share", async () => {
    const ix = await index();
    const c = (id: string) => ix.characters.find((x) => x.id === id)!;
    expect(c("e").portrait).toBe("eileen happy");
    expect(c("s").portrait).toBe("side sam"); // side images are face portraits
    expect(c("l").portrait).toBe("lucy");
    expect(ix.characters.reduce((n, x) => n + x.share, 0)).toBeCloseTo(1);
  });
});

import { shortestRoute } from "./route";
describe("route inspector", () => {
  it("finds the shortest static route", async () => {
    const ix = await index();
    const all = { kinds: new Set(["jump", "call", "fallthrough"] as const), conditional: true };
    expect(shortestRoute(ix, "start", "after_park", all)!.map((e) => `${e.from}-${e.kind}->${e.to}`)).toEqual(["start-jump->park", "park-fallthrough->after_park"]);
    expect(shortestRoute(ix, "start", "after_park", { ...all, conditional: false })).toBeNull();
    expect(shortestRoute(ix, "start", "sam_route", all)).toBeNull();
  });
});

import { characterPortraits } from "./analysis";
import type { CharacterInfo, ImageInfo } from "./model";
describe("portrait matching", () => {
  const ch = (id: string, name: string, image: string | null = null): CharacterInfo => ({
    id, name, defined: true, color: null, image, kind: null, loc: null, lines: 10, words: 50, labels: {}, sample: null, portrait: null, share: 0,
  });
  const img = (name: string, file: string | null, uses = 0): ImageInfo => {
    const [tag, ...attributes] = name.split(" ");
    return { name, tag, attributes, kind: file ? "auto" : "expression", code: null, file, loc: null, uses };
  };
  it("matches side images, name prefixes and folders", () => {
    const index = {
      characters: [ch("ab", "Abigail"), ch("ca", "Carmen"), ch("br", "Brianna"), ch("m", "[persistent.player_name]"), ch("e", "Eileen", "eileen")],
      images: [
        img("abigail_dia17_conversa36", "images/dia17/abigail_dia17_conversa36.webp", 3),
        img("abigail_dia17_conversa12", "images/dia17/abigail_dia17_conversa12.webp", 1),
        img("bg cafe", "images/bg cafe.webp", 40),
        img("carmen_face_happy", "images/sprites/carmen_face_happy.png"),
        img("carmen_dia05_01", "images/dia05/carmen_dia05_01.png", 9),
        img("b01", "images/characters/brianna/b01.png"),
        img("side eileen happy", "images/side eileen happy.png"),
        img("eileen happy", "images/eileen happy.png", 20),
      ],
    } as unknown as Parameters<typeof characterPortraits>[0];
    characterPortraits(index);
    const p = Object.fromEntries(index.characters.map((c) => [c.id, c.portrait]));
    expect(p).toEqual({ ab: "abigail_dia17_conversa36", ca: "carmen_face_happy", br: "b01", m: null, e: "side eileen happy" });
  });
});
