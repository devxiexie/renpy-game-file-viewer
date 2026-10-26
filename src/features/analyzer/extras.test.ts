import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesSource } from "../../core/vfs/source";
import { buildIndex } from "./build";
import { dialogueLines, dialogueMatcher, screenplay } from "./dialogue";
import { compareText, comparisons } from "./compare";
import { audioNames, parseAudioStatement } from "./extras";
import { choiceGuide, findEndings, routeRequirements, routeTo, viaText } from "./guide";
import type { AnalyzerIndex } from "./model";

function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function load(game: string): Promise<AnalyzerIndex> {
  const all = [...walk(game)];
  const rel = (p: string) => ({ fileId: p, gamePath: p.slice(game.length + 1) });
  return buildIndex({
    scripts: all.filter((p) => p.endsWith(".rpyc")).map((p) => ({ fileId: p, path: p, source: bytesSource(readFileSync(p)) })),
    imageFiles: all.filter((p) => /\.(png|jpg)$/.test(p)).map(rel),
    audioFiles: all.filter((p) => /\.(wav|ogg)$/.test(p)).map(rel),
  });
}

const extras = () => load("test/fixtures/analyzer/extras/game");
const main = () => load("test/fixtures/analyzer/src/game");

describe("audio", () => {
  it("parses statements", () => {
    expect(parseAudioStatement('play music "a.ogg" fadein 1.0')).toEqual({ statement: "play", channel: "music", expr: '"a.ogg"' });
    expect(parseAudioStatement("queue sound [\"a.ogg\", 'b.ogg'] loop")).toMatchObject({ statement: "queue", expr: "[\"a.ogg\", 'b.ogg']" });
    expect(parseAudioStatement('voice "v1.ogg"')).toMatchObject({ statement: "voice", channel: "voice" });
    expect(parseAudioStatement("voice sustain")).toBeNull();
    expect(audioNames('"<loop 2.0>bgm/x.ogg"')).toEqual({ files: ["bgm/x.ogg"], names: [] });
    expect(audioNames("audio.theme")).toEqual({ files: [], names: ["theme"] });
    expect(audioNames("config.sample_sound")).toEqual({ files: [], names: [] });
  });

  it("finds tracks, uses, unused and missing files", async () => {
    const ix = await extras();
    const a = (id: string) => ix.audio.find((x) => x.id === id)!;
    expect(a("audio/theme.wav")).toMatchObject({ kind: "music", aliases: ["theme"], missing: false });
    expect(a("audio/theme.wav").uses.map((u) => u.label)).toEqual(["start"]);
    expect(a("audio/menu.wav").uses[0]).toMatchObject({ statement: "config", channel: "music" });
    expect(a("voice/v_001.wav")).toMatchObject({ kind: "voice" });
    expect(a("voice/v_001.wav").uses[0].line).toMatchObject({ who: "v", what: "Hi there. Fancy a {i}coffee{/i}?" });
    expect(a("sfx/door.wav").uses).toHaveLength(1);
    expect(a("sfx/click.wav").uses[0]).toMatchObject({ channel: "sound", statement: "python" });
    expect(a("sfx/kiss.wav").uses[0].statement).toBe("queue");
    expect(a("sfx/missing.ogg")).toMatchObject({ missing: true, file: null });
    expect(a("audio/unused_song.wav").uses).toHaveLength(0);
    // `define audio.x` isn't a game variable.
    expect(ix.variables.some((v) => v.name.startsWith("audio."))).toBe(false);
  });
});

describe("gallery", () => {
  it("reads Gallery buttons, replays and persistent flags", async () => {
    const ix = await extras();
    expect(ix.gallery.buttons.map((b) => b.name)).toEqual(["vera_date", "vera_kiss"]);
    expect(ix.gallery.buttons[0]).toMatchObject({ gallery: "g", conditions: ["persistent.vera_cg"], images: [["cg vera date"]], thumbnail: "images/cg/vera_date.png" });
    expect(ix.gallery.buttons[1]).toMatchObject({ unlockImages: ["cg vera kiss"] });
    expect(ix.gallery.replays).toMatchObject([{ label: "vera_date_scene", screen: "gallery_screen" }]);
    expect(ix.gallery.persistentInScreens["persistent.vera_cg"]).toEqual(["gallery_screen"]);
    const scene = ix.labels.find((l) => l.name === "vera_date_scene")!;
    expect(scene.replay).toBe(true);
    expect(ix.variables.find((v) => v.name === "persistent.vera_cg")!.refs.some((r) => r.kind === "write" && r.label === "vera_date_scene")).toBe(true);
  });
});

describe("walkthrough", () => {
  it("finds endings with routes and requirements", async () => {
    const ix = await extras();
    const endings = findEndings(ix);
    expect(endings.map((e) => [e.label.name, e.how])).toEqual([
      ["lonely_end", "return"],
      ["kiss", "restart"],
    ]);
    const kiss = endings.find((e) => e.label.name === "kiss")!;
    expect(kiss.tone).toBe("good"); // from its last line
    expect(kiss.route!.edges.map((e) => e.to)).toEqual(["vera_date_scene", "kiss"]);
    expect(kiss.route!.edges.flatMap((e) => e.via ?? []).map(viaText)).toEqual(["Sure", "vera_love >= 1"]);
    const req = routeRequirements(ix, kiss.route!);
    expect(req.map((r) => r.variable.name)).toEqual(["vera_love"]);
    expect(req[0].changedBy.map((c) => c.menu.items[c.item].text)).toEqual(["Sure"]);
    expect(kiss.label.last?.what).toBe("Good ending for you.");
  });

  it("ignores called labels and tags tones", async () => {
    const ix = await main();
    const endings = findEndings(ix);
    const names = endings.map((e) => e.label.name);
    expect(names).toContain("good_end");
    expect(names).toContain("bad_end");
    expect(names).not.toContain("stay_here");
    expect(endings.find((e) => e.label.name === "good_end")!.tone).toBe("good");
    expect(endings.find((e) => e.label.name === "sam_good")!.route).toBeNull();
    expect(routeTo(ix, "good_end")!.edges.at(-1)!.via).toEqual([{ kind: "condition", code: "met_lucy and affection >= 3" }]);
    expect(routeTo(ix, "bad_end")!.edges.at(-1)!.via).toBeUndefined();
  });

  it("guides choices in story order with exclusive endings", async () => {
    const ix = await extras();
    const guide = choiceGuide(ix, findEndings(ix));
    expect(guide[0].menu.label).toBe("start");
    expect(guide[0].options.map((o) => o.endings)).toEqual([["kiss"], []]);
  });
});

describe("dialogue", () => {
  it("lists, searches and exports", async () => {
    const ix = await extras();
    const lines = dialogueLines(ix);
    expect(lines[0]).toMatchObject({ who: "v", plain: "Hi there. Fancy a coffee?", label: "start" });
    const re = dialogueMatcher("coffee", { regex: false, caseSensitive: false, wholeWord: true })!;
    expect(lines.filter((l) => re.test(l.plain) && ((re.lastIndex = 0), true)).map((l) => l.label)).toEqual(["start", "lonely_end"]);
    expect(() => dialogueMatcher("(", { regex: true, caseSensitive: false, wholeWord: false })).toThrow();
    const md = screenplay(ix, { format: "md", title: "Extras", names: new Map([["v", "Vera"]]) });
    expect(md).toContain("## start");
    expect(md).toContain("**Vera:** Hi there. Fancy a coffee?");
    expect(md).toContain("- No thanks");
    expect(md).toContain("*You drink your coffee alone.*");
    const txt = screenplay(ix, { format: "txt", title: "Extras", names: new Map([["v", "Vera"]]), only: lines.slice(0, 1) });
    expect(txt).toBe("EXTRAS\n\n=== start (game/script.rpy) ===\n\nVERA: Hi there. Fancy a coffee?\n");
  });
});

describe("comparisons", () => {
  const of = (ix: AnalyzerIndex, name: string) =>
    comparisons(ix.variables.find((v) => v.name === name)!).map((c) => ({ test: compareText(c), label: c.ref.label, screen: c.ref.screen, line: c.ref.loc.line, gate: c.ref.gate }));

  it("lists every test of a variable with what it decides", async () => {
    const ix = await main();
    const aff = of(ix, "affection");
    expect(aff.map((c) => c.test)).toEqual(expect.arrayContaining(["< MAX_AFFECTION", "> 2", "≥ 3"]));
    expect(aff.find((c) => c.test === "< MAX_AFFECTION")!.gate).toEqual({ kind: "choice", text: "Stay here" });
    expect(aff.find((c) => c.test === "> 2")!.line).toBe(28);
    expect(aff.find((c) => c.test === "≥ 3")!.gate).toMatchObject({ kind: "branch", targets: ["good_end"] });
    expect(of(ix, "met_lucy").map((c) => c.test)).toEqual(expect.arrayContaining(["is false / unset", "is true / set"]));
  });

  it("includes screen conditions", async () => {
    const ix = await extras();
    expect(of(ix, "persistent.vera_cg")).toContainEqual(expect.objectContaining({ test: "is true / set", screen: "gallery_screen", label: null, gate: { kind: "screen", screen: "gallery_screen", showif: false } }));
    expect(of(ix, "vera_love")).toEqual([expect.objectContaining({ test: "≥ 1", label: "vera_date_scene", gate: { kind: "branch", targets: ["kiss"], elif: false } })]);
  });
});
