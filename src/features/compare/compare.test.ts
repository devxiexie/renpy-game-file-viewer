import { describe, expect, it } from "vitest";
import { bytesSource } from "../../core/vfs/source";
import { FileTree } from "../../core/vfs/tree";
import { writeRpa } from "../../formats/rpa/rpa";
import { listArchive } from "../../formats/archive";
import { blobSource } from "../../core/vfs/source";
import { pairFiles, sourcesEqual } from "./compare";

const blob = (s: string) => new Blob([s]);

describe("compare", () => {
  it("pairs files between two builds, flattening archives", async () => {
    const tree = new FileTree();
    const rpaA = await writeRpa([{ path: "images/bg.png", data: new TextEncoder().encode("AAAA") }]);
    const rpaB = await writeRpa([
      { path: "images/bg.png", data: new TextEncoder().encode("AAAB") },
      { path: "images/new.png", data: new TextEncoder().encode("N") },
    ]);
    tree.addFiles([
      { path: "v1/game/script.rpy", file: blob("label start:\n") },
      { path: "v1/game/old.rpy", file: blob("x") },
      { path: "v1/game/images.rpa", file: rpaA },
      { path: "v2/game/script.rpy", file: blob("label start:\n    return\n") },
      { path: "v2/game/images.rpa", file: rpaB },
    ]);
    tree.expandArchive(tree.get("v1/game/images.rpa")!, await listArchive("images.rpa", blobSource(rpaA)));
    tree.expandArchive(tree.get("v2/game/images.rpa")!, await listArchive("images.rpa", blobSource(rpaB)));
    const entries = pairFiles(tree, tree.get("v1")!, tree.get("v2")!, { flattenArchives: true });
    expect(entries.map((e) => [e.path, e.status])).toEqual([
      ["game/images/bg.png", "pending"],
      ["game/images/new.png", "added"],
      ["game/old.rpy", "removed"],
      ["game/script.rpy", "changed"],
    ]);
    const bg = entries[0];
    expect(await sourcesEqual(bg.a!.source!, bg.b!.source!)).toBe(false);
  });

  it("detects identical content", async () => {
    expect(await sourcesEqual(bytesSource(new Uint8Array([1, 2, 3])), bytesSource(new Uint8Array([1, 2, 3])))).toBe(true);
  });
});
