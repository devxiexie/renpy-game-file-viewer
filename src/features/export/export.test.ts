import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { blobSource } from "../../core/vfs/source";
import { FileTree } from "../../core/vfs/tree";
import { listArchive } from "../../formats/archive";
import { collectExportItems, exportPath, zipToBlob } from "./export";

async function treeWithArchive() {
  const tree = new FileTree();
  const rpa = new Blob([readFileSync("test/fixtures/rpa/v3.rpa")]);
  tree.addFiles([
    { path: "Game/game/archive.rpa", file: rpa },
    { path: "Game/game/script.rpy", file: new Blob(["label start:\n    return\n"]) },
  ]);
  const node = tree.get("Game/game/archive.rpa")!;
  tree.expandArchive(node, await listArchive("archive.rpa", blobSource(rpa)));
  return tree;
}

describe("export", () => {
  it("maps archive members next to the archive", async () => {
    const tree = await treeWithArchive();
    expect(exportPath(tree, tree.get("Game/game/archive.rpa/images/bg room.png")!)).toBe("Game/game/images/bg room.png");
  });

  it("lets loose files win over archive members and builds a valid zip", async () => {
    const tree = await treeWithArchive();
    const items = collectExportItems(tree, [...tree.files()], { extractArchives: true, decompileScripts: false });
    const paths = items.map((i) => i.path);
    expect(paths).toContain("Game/game/script.rpy");
    expect(paths).not.toContain("Game/game/archive.rpa");
    expect(paths.filter((p) => p === "Game/game/script.rpy")).toHaveLength(1);

    const zip = unzipSync(new Uint8Array(await (await zipToBlob(items)).arrayBuffer()));
    expect(new TextDecoder().decode(zip["Game/game/script.rpy"])).toBe("label start:\n    return\n");
    expect(zip["Game/game/images/bg room.png"].length).toBe(1024);
    expect(zip["Game/game/empty.txt"].length).toBe(0);
  });
});
