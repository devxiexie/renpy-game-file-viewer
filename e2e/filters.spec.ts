import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { zipSync } from "fflate";
import { FIX, files, openFiles } from "./helpers";

test("images / videos filter buttons", async ({ page }) => {
  const png = readFileSync(`${FIX}/gradient.png`);
  const zip = Buffer.from(zipSync({ "game/images/in_zip.png": [new Uint8Array(png), { level: 0 }], "game/intro.webm": new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]) }));
  await page.goto("/");
  await openFiles(page, [
    { name: "gradient.png", buffer: png, mimeType: "image/png" },
    { name: "clip.webm", buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) },
    { name: "script.rpy", buffer: Buffer.from("label start:\n") },
    { name: "game.zip", buffer: zip },
  ]);
  const tree = await files(page);
  await page.getByRole("button", { name: "Images" }).click();
  await expect(tree.getByText("gradient.png")).toBeVisible();
  await expect(tree.getByText("script.rpy")).toHaveCount(0);
  await expect(tree.getByText("clip.webm")).toHaveCount(0);
  // Folders containing matches start closed and open / close on click (archives are read automatically).
  await expect(tree.getByText("game.zip")).toBeVisible();
  await expect(tree.getByText("in_zip.png")).toHaveCount(0);
  const row = (name: string) => tree.getByRole("treeitem").filter({ has: page.getByText(name, { exact: true }) });
  await row("game.zip").getByRole("button", { name: "Expand" }).click();
  await row("game").getByRole("button", { name: "Expand" }).click();
  await row("images").getByRole("button", { name: "Expand" }).click();
  await expect(tree.getByText("in_zip.png")).toBeVisible();
  await row("game.zip").getByRole("button", { name: "Collapse" }).click();
  await expect(tree.getByText("in_zip.png")).toHaveCount(0);

  await page.getByRole("button", { name: "Videos" }).click();
  await expect(tree.getByText("clip.webm")).toBeVisible();
  await expect(tree.getByText("gradient.png")).toHaveCount(0);
  await row("game.zip").getByRole("button", { name: "Expand" }).click();
  await row("game").getByRole("button", { name: "Expand" }).click();
  await expect(tree.getByText("intro.webm")).toBeVisible();

  await page.getByRole("button", { name: "Videos" }).click();
  await expect(tree.getByText("script.rpy")).toBeVisible();
});
