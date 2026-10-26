import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync, zipSync } from "fflate";
import { writeRpa } from "../src/formats/rpa/rpa";
import { loadSave } from "../src/formats/renpysave/save";
import { listArchive } from "../src/formats/archive";
import { blobSource } from "../src/core/vfs/source";
import { FIX, downloadBytes, fixture, noSavePicker, openFiles, openFolder, openTool, files } from "./helpers";

const png = readFileSync(`${FIX}/gradient.png`);

test("thumbnail views and zip archives", async ({ page }) => {
  await page.goto("/");
  const zip = Buffer.from(zipSync({ "Game/game/images/inside.png": [new Uint8Array(png), { level: 0 }], "Game/game/notes.txt": new TextEncoder().encode("hello from zip") }));
  await openFiles(page, [{ name: "gradient.png", buffer: png, mimeType: "image/png" }, { name: "game.zip", buffer: zip }]);
  await (await files(page)).getByText("game.zip").dblclick();
  await expect((await files(page)).getByText(/^2 files ·/)).toBeVisible();
  await (await files(page)).getByText("Game", { exact: true }).dblclick();
  await (await files(page)).getByText("game", { exact: true }).dblclick();
  await (await files(page)).getByText("notes.txt").click();
  await expect(page.locator(".cm-content")).toContainText("hello from zip");

  await files(page);
  await page.getByRole("button", { name: "Compact preview" }).click();
  await expect((await files(page)).locator("img").first()).toBeVisible();
  await page.getByRole("button", { name: "Large icons" }).click();
  const grid = page.getByRole("grid", { name: "Files" });
  await grid.getByRole("gridcell", { name: /images/ }).click();
  await expect(grid.locator("img").first()).toBeVisible();
  await page.getByRole("button", { name: "Tree view" }).click();
});

test("save editor edits a variable and downloads a loadable save", async ({ page }) => {
  await page.goto("/");
  await openFiles(page, [fixture("saves/proto5-1-1-LT1.save")]);
  await (await files(page)).getByText("proto5-1-1-LT1.save").click();
  await expect(page.getByText("Chapter 2")).toBeVisible();
  const input = page.getByRole("textbox", { name: "Value of money" });
  await expect(input).toHaveValue("120");
  await input.fill("5000");
  await input.press("Enter");
  await expect(page.getByText("1 edited")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download edited save/ }).click();
  const save = loadSave(await downloadBytes(await download));
  expect(save.root.get("store.money")).toBe(5000);
  expect(save.root.get("store.mc_name")).toBe("Tom");
});

test("compare two builds", async ({ page }, info) => {
  const base = info.outputPath("builds");
  for (const [v, script, extra] of [["v1", "label start:\n    \"Hello.\"\n", "old.rpy"], ["v2", "label start:\n    \"Hello there.\"\n    return\n", "new.rpy"]]) {
    mkdirSync(join(base, v, "game"), { recursive: true });
    writeFileSync(join(base, v, "game", "script.rpy"), script);
    writeFileSync(join(base, v, "game", extra), "# x\n");
    writeFileSync(join(base, v, "game", "same.txt"), "same");
  }
  await page.goto("/");
  await openFolder(page, join(base, "v1"));
  await openFolder(page, join(base, "v2"));
  await openTool(page, /Compare files/);
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByText("changed 1")).toBeVisible();
  await expect(page.getByText("added 1")).toBeVisible();
  await expect(page.getByText("removed 1")).toBeVisible();
  await page.getByText("game/script.rpy").click();
  await expect(page.getByText('"Hello there."')).toBeVisible();
  await expect(page.getByText("+2")).toBeVisible();
});

test("translation tool exports a tl patch", async ({ page }) => {
  await page.goto("/");
  await openFiles(page, [fixture("rpyc/8.5.3/the_question_script.rpyc", "script.rpyc")]);
  await openTool(page, /Translation/);
  await page.getByRole("button", { name: "Scan scripts" }).click();
  await expect(page.getByRole("tab", { name: /Dialogue 0\/70/ })).toBeVisible({ timeout: 15_000 });
  const field = page.getByRole("textbox", { name: /Translation of It's only when I hear/ });
  await field.fill("Ce n'est qu'en entendant…");
  await field.blur();
  await expect(page.getByRole("tab", { name: /Dialogue 1\/70/ })).toBeVisible();
  await page.getByRole("switch", { name: /Keep original text/ }).uncheck();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download patch" }).click();
  const files = unzipSync(await downloadBytes(await download));
  const tl = new TextDecoder().decode(files["game/tl/french/script.rpy"]);
  expect(tl).toContain("translate french start_915cb944:");
  expect(tl).toContain(`    "Ce n'est qu'en entendant…"`);
  expect(tl.match(/^translate french /gm)).toHaveLength(1);
});

test("compress rpa re-encodes images as webp", async ({ page }) => {
  const big = await writeRpa([{ path: "images/bg.png", data: new Blob([png]) }, { path: "script.rpy", data: new TextEncoder().encode("label start:\n") }]);
  await page.goto("/");
  await openFiles(page, [{ name: "images.rpa", buffer: Buffer.from(await big.arrayBuffer()) }]);
  await openTool(page, /Compress RPA/);
  await page.getByRole("combobox", { name: "Archive or folder to pack" }).click();
  await page.getByRole("option", { name: "images.rpa" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Compress and download" }).click();
  const bytes = await downloadBytes(await download);
  const listing = await listArchive("images.rpa", blobSource(new Blob([bytes as Uint8Array<ArrayBuffer>])));
  expect(listing.members.map((m) => m.path).sort()).toEqual(["images/bg.png", "script.rpy"]);
  await expect(page.getByText(/1 of 2 files re-encoded/)).toBeVisible();
});

test("merge images and open from url", async ({ page }) => {
  // Serve a fake remote archive that supports Range requests.
  const rpa = readFileSync(`${FIX}/rpa/v3.rpa`);
  await page.route("https://files.example.test/**", async (route) => {
    const range = /bytes=(\d+)-(\d+)?/.exec(route.request().headers()["range"] ?? "");
    const headers = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range, content-length", "accept-ranges": "bytes" };
    if (!range) return route.fulfill({ status: 200, body: rpa, headers });
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : rpa.length - 1;
    await route.fulfill({ status: 206, body: rpa.subarray(start, end + 1), headers: { ...headers, "content-range": `bytes ${start}-${end}/${rpa.length}` } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "From URL" }).click();
  await page.getByLabel("File URL").fill("https://files.example.test/game/archive.rpa");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect((await files(page)).getByText(/^4 files ·/)).toBeVisible();
  await (await files(page)).getByText("script.rpy", { exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText('"Hello, world."');

  await openFiles(page, [{ name: "gradient.png", buffer: png, mimeType: "image/png" }]);
  await (await files(page)).getByText("gradient.png").click();
  await page.getByRole("button", { name: "Add to merge" }).click();
  await expect(page.getByText("Merge Images", { exact: true })).toBeVisible();
  await noSavePicker(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save PNG" }).click();
  expect((await download).suggestedFilename()).toBe("gradient-merged.png");
});
