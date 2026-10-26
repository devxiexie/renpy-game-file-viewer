import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FIX, openFiles, files } from "./helpers";

async function searchFor(page: Page, query: string) {
  await files(page);
  await page.getByRole("tab", { name: "Search" }).click();
  await page.getByPlaceholder("Search scripts and text files").fill(query);
  await page.getByRole("button", { name: "Search" }).click();
}

test("open, decompile, browse archive, search", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByText("Open a Ren'Py game")).toBeVisible();

  await openFiles(page, [
    { name: "script.rpyc", buffer: readFileSync(`${FIX}/rpyc/8.5.3/the_question_script.rpyc`) },
    { name: "screens.rpyc", buffer: readFileSync(`${FIX}/rpyc/7.8.7/the_question_screens.rpyc`) },
    { name: "archive.rpa", buffer: readFileSync(`${FIX}/rpa/v3.rpa`) },
    { name: "gradient.png", buffer: readFileSync(`${FIX}/gradient.png`), mimeType: "image/png" },
  ]);

  await expect((await files(page)).getByText("script.rpyc")).toBeVisible();

  // Decompile (CodeMirror only renders visible lines, so check the top of the file)
  await (await files(page)).getByText("script.rpyc").click();
  await expect(page.locator(".cm-content")).toContainText('define s = Character(_("Sylvie"), color="#c8ffc8")', { timeout: 15_000 });
  await expect(page.locator(".cm-content")).toContainText("scene bg lecturehall");

  // Image preview
  await (await files(page)).getByText("gradient.png").click();
  await expect(page.getByText("64 × 48")).toBeVisible();

  // Archive expansion
  await (await files(page)).getByText("archive.rpa").dblclick();
  await expect((await files(page)).getByText(/^4 files ·/)).toBeVisible();
  await (await files(page)).getByText("images", { exact: true }).dblclick();
  await expect((await files(page)).getByText("bg room.png")).toBeVisible();
  await (await files(page)).getByText("script.rpy", { exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText('"Hello, world."');

  await page.screenshot({ path: info.outputPath("viewer.png"), fullPage: true });

  // Search across decompiled scripts, then jump to the hit (scrolls the editor to it)
  await searchFor(page, "screen say(");
  await expect(page.getByText(/1 match in 1 file/)).toBeVisible({ timeout: 15_000 });
  await page.locator("mark").first().click();
  await expect(page.locator(".cm-content")).toContainText("screen say(who, what):");
  await expect(page.locator(".cm-content")).toContainText("window:");

  await searchFor(page, "Hi there");
  await page.locator("mark").first().click();
  await expect(page.locator(".cm-content")).toContainText('s "Hi there! How was class?"');

  await page.screenshot({ path: info.outputPath("search.png"), fullPage: true });
});

test("export all opened files downloads a zip", async ({ page }) => {
  await page.goto("/");
  await openFiles(page, [{ name: "script.rpyc", buffer: readFileSync(`${FIX}/rpyc/8.5.3/the_question_script.rpyc`) }]);
  await page.getByRole("button", { name: "Export" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio", { name: "All opened files" })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Export" })).toBeEnabled();
  // Force the Blob download path (no File System Access picker in tests).
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
  });
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("export.zip");
});
