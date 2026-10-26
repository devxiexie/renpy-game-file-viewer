import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { blobSource, readSource } from "../../core/vfs/source";
import { listArchive } from "../archive";

describe("ZIP archives", () => {
  it("lists and reads stored and deflated members, including ranges", async () => {
    const big = new Uint8Array(200_000).map((_, i) => (i * 7) % 251);
    const zip = zipSync({
      "Game/game/script.rpy": [new TextEncoder().encode("label start:\n    return\n"), { level: 9 }],
      "Game/game/images/bg.png": [big, { level: 0 }],
      "Game/game/deflated.bin": [big, { level: 6 }],
      "Game/empty/": new Uint8Array(0),
      "Ünïcode name.txt": new TextEncoder().encode("ok"),
    });
    const listing = await listArchive("game.zip", blobSource(new Blob([zip])));
    expect(listing.format).toBe("ZIP");
    const byPath = new Map(listing.members.map((m) => [m.path, m.source]));
    expect([...byPath.keys()].sort()).toEqual(["Game/game/deflated.bin", "Game/game/images/bg.png", "Game/game/script.rpy", "Ünïcode name.txt"]);
    expect(new TextDecoder().decode(await readSource(byPath.get("Game/game/script.rpy")!))).toBe("label start:\n    return\n");
    expect(await readSource(byPath.get("Game/game/images/bg.png")!)).toEqual(big);
    expect(await readSource(byPath.get("Game/game/deflated.bin")!, 1000, 1010)).toEqual(big.subarray(1000, 1010));
    expect(await readSource(byPath.get("Game/game/images/bg.png")!, 5, 9)).toEqual(big.subarray(5, 9));
  });

  it("rejects non-zip data", async () => {
    await expect(listArchive("x.zip", blobSource(new Blob(["nope"])))).rejects.toThrow(/Not a ZIP/);
  });
});
