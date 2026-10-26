import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bytesSource } from "../../core/vfs/source";
import { extractTranslations } from "./extract";
import { generateTlFiles } from "./generate";
import { evalPyStrings, scanMarkedStrings } from "./pystring";

const file = (path: string) => ({ path, source: bytesSource(readFileSync(path)) });

describe("python string literals", () => {
  it("evaluates literals like Ren'Py's scanner", () => {
    expect(evalPyStrings(`"a" 'b' u"c\\n\\u00e9"`)).toBe("abc\né");
    expect(evalPyStrings(`"""x "y" z"""`)).toBe('x "y" z');
    expect(scanMarkedStrings(`define s = Character(_("Sylvie"), color="#c8ffc8")`)).toEqual(["Sylvie"]);
    expect(scanMarkedStrings(`text _p("""one\n  two\n\n three""")`)).toEqual(["one two\n\nthree"]);
    expect(scanMarkedStrings(`$ renpy.notify(__('Saved') + x)`)).toEqual(["Saved"]);
  });
});

describe.each(["8.5.3", "7.8.7", "6.99.14.3"])("translation extraction (Ren'Py %s)", (version) => {
  it("finds the same dialogue ids and strings as Ren'Py's generator", async () => {
    const project = await extractTranslations([file(`test/fixtures/rpyc/${version}/the_question_script.rpyc`)]);
    expect(project.errors).toEqual([]);
    const shipped = readFileSync("test/fixtures/tl/japanese_script.rpy", "utf8");
    const shippedIds = [...shipped.matchAll(/^translate japanese (\w+):/gm)].map((m) => m[1]).filter((id) => id !== "strings");
    expect(project.dialogue.map((d) => d.id)).toEqual(shippedIds);
    const shippedComments = [...shipped.matchAll(/^ {4}# (.*)$/gm)].map((m) => m[1]).filter((c) => !c.startsWith("game/"));
    expect(project.dialogue.flatMap((d) => d.code)).toEqual(shippedComments);
    const shippedStrings = [...shipped.matchAll(/^ {4}old "(.*)"$/gm)].map((m) => m[1]);
    expect(project.strings.map((s) => s.text)).toEqual(shippedStrings);
  });
});

describe("tl file generation", () => {
  it("writes Ren'Py-format translation files and reads existing translations", async () => {
    const project = await extractTranslations([file("test/fixtures/rpyc/8.5.3/the_question_script.rpyc"), file("test/fixtures/tl/japanese_script.rpyc")]);
    const ja = project.existing.japanese;
    expect(ja.dialogue["rightaway_cf214f74"]).toBeTruthy();
    expect(ja.strings["Sylvie"]).toBe("シルビー");

    const files = generateTlFiles(project, "french", { dialogue: { rightaway_cf214f74: 'Salut ! "Ça" va ?' }, strings: { Me: "Moi" } }, { fillMissing: false });
    expect(Object.keys(files)).toEqual(["game/tl/french/script.rpy"]);
    expect(files["game/tl/french/script.rpy"]).toBe(
      '﻿\n# game/script.rpy:57\ntranslate french rightaway_cf214f74:\n\n    # s "Hi there! How was class?"\n    s "Salut ! \\"Ça\\" va ?"\n\n' +
        'translate french strings:\n\n    # game/script.rpy:3\n    old "Me"\n    new "Moi"\n\n',
    );
    const full = generateTlFiles(project, "french", { dialogue: {}, strings: {} }, { fillMissing: true });
    expect(full["game/tl/french/script.rpy"].match(/^translate french /gm)!.length).toBe(project.dialogue.length + 1);
  });
});
