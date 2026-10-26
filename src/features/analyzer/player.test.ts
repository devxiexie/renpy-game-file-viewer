import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bytesSource } from "../../core/vfs/source";
import { buildIndex } from "./build";
import { choose, decisionOptions, rewind, startPlayer, startPlayerAt, step, type PlayerEnv } from "./player";
import { labelProgram, type LabelProgram } from "./program";
import { imageCatalog } from "./stage";

const GAME = "test/fixtures/analyzer/src/game";
function* walk(d: string): Generator<string> {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

describe("label player", async () => {
  const all = [...walk(GAME)];
  const images = all.filter((p) => p.endsWith(".png")).map((p) => p.slice(GAME.length + 1));
  const scripts = all.filter((p) => p.endsWith(".rpyc")).map((p) => ({ fileId: p, path: p, source: bytesSource(readFileSync(p)) }));
  const ix = await buildIndex({ scripts, imageFiles: images.map((g) => ({ fileId: g, gamePath: g })) });
  const programs = new Map<string, LabelProgram>();
  for (const l of ix.labels) {
    const s = scripts.find((x) => x.fileId === l.loc.fileId)!;
    programs.set(l.name, (await labelProgram(s.fileId, s.source, l.name))!);
  }
  const env: PlayerEnv = {
    programs,
    catalog: imageCatalog(ix, images),
    fallthrough: (label) => ix.edges.find((e) => e.from === label && e.kind === "fallthrough")?.to ?? null,
  };
  const say = (s: { current: unknown }) => (s.current as { what?: string }).what;

  it("plays dialogue with stage state, choices, calls and fall-through", () => {
    let s = startPlayer("start", env);
    expect(say(s)).toBe("Hello! Welcome to the analyzer test.");
    expect(s.background).toBe("bg room");
    expect(s.sprites).toEqual([{ tag: "eileen", image: "eileen happy", at: ["left"] }]);
    expect(s.transition).toBe("fade");
    s = step(s, env);
    expect(say(s)).toBe("What's your name?");
    expect(s.passed.map((p) => p.t)).toEqual(["python"]); // $ affection += 1
    s = step(s, env);
    expect(s.decision?.kind).toBe("menu");
    expect(decisionOptions(s.decision!).map((o) => o.text)).toEqual(["The park", "Stay here", "Meet Lucy"]);
    expect(s.passed.map((p) => p.t)).toEqual(["python"]); // $ player_name = ...

    // "Stay here": call stay_here, return, then jump ending.
    const atMenu = s;
    s = choose(s, 1, env);
    expect(s.label).toBe("stay_here");
    expect(say(s)).toBe("Staying in is nice too.");
    expect(s.sprites.map((x) => x.image)).toEqual(["eileen wink"]);
    s = step(s, env);
    expect(s.label).toBe("ending");
    expect(say(s)).toBe("The end.");
    s = step(s, env);
    expect(say(s)).toBe("Bye!");
    s = step(s, env);
    expect(s.decision?.kind).toBe("if");
    expect(decisionOptions(s.decision!).map((o) => o.text)).toEqual(["if met_lucy and affection >= 3", "Skip condition (none true)"]);
    s = choose(s, 1, env);
    expect(s.label).toBe("bad_end"); // jump expression "bad_end" resolved statically
    expect(say(s)).toBe("Bad ending.");
    s = step(s, env);
    expect(s.ended).toBe("return");
    expect(s.history.map((h) => h.chosen)).toEqual(["Stay here", "Skip condition (none true)"]);

    // Rewind to the menu and take the park instead; park falls through into after_park.
    s = rewind(s, 0);
    expect(s).toBe(atMenu);
    s = choose(s, 0, env);
    expect(s.label).toBe("park");
    expect(s.background).toBe("bg park");
    s = step(step(s, env), env);
    expect(s.decision?.kind).toBe("if");
    s = choose(s, 0, env);
    expect(say(s)).toBe("But I'm glad you came.");
    s = step(s, env);
    expect(say(s)).toBe("Eileen leaves.");
    expect(s.sprites).toEqual([]);
    s = step(s, env);
    expect(s.label).toBe("after_park");
    expect(say(s)).toBe("The day goes on.");
  });

  it("merges layered image attributes on show", () => {
    let s = startPlayer("meet_lucy", env);
    expect(s.sprites[0].image).toBe("lucy smile glasses");
    s = step(s, env);
    expect(s.sprites[0].image).toBe("lucy glasses frown");
  });

  it("waits for programs that aren't loaded", () => {
    const partial: PlayerEnv = { ...env, programs: new Map([["after_park", programs.get("after_park")!]]) };
    let s = startPlayer("after_park", partial);
    s = step(s, partial);
    expect(s.waitingFor).toBe("ending");
    partial.programs.set("ending", programs.get("ending")!);
    s = step(s, partial);
    expect(say(s)).toBe("The end.");
  });

  it("starts at a line inside a branch with the stage set up", () => {
    // meet_lucy, "Ask for directions" option: l "Sure, the park is that way."
    const line = ix.scenes.flatMap((sc) => sc.events).find((e) => e.type === "say" && e.what.startsWith("Sure, the park"))!.loc.line;
    let s = startPlayerAt("meet_lucy", line, env);
    expect(say(s)).toBe("Sure, the park is that way.");
    expect(s.background).toBe("bg street");
    expect(s.sprites.map((x) => x.image)).toEqual(["lucy glasses frown"]);
    s = step(s, env); // jump park
    expect(s.label).toBe("park");
    // A line at the top level of a label.
    s = startPlayerAt("park", ix.scenes.flatMap((sc) => sc.events).find((e) => e.type === "say" && e.what === "Eileen leaves.")!.loc.line, env);
    expect(say(s)).toBe("Eileen leaves.");
    expect(s.sprites).toEqual([]);
    s = step(s, env);
    expect(s.label).toBe("after_park");
  });
});
