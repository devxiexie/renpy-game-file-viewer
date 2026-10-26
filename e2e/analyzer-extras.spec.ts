import { expect, test } from "@playwright/test";
import { downloadBytes, openFolder } from "./helpers";

test("walkthrough, dialogue, audio and gallery sections", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("rpv-analyzer"));
  await openFolder(page, "test/fixtures/analyzer/extras");
  await expect(page.getByRole("heading", { name: "Extras Test" })).toBeVisible({ timeout: 20_000 });
  const nav = page.getByRole("tablist", { name: "Analyzer sections" });

  // Walkthrough: endings with the route and requirements
  await nav.getByRole("tab", { name: "Walkthrough" }).click();
  await expect(page.getByText("Restarts the game")).toBeVisible();
  await expect(page.getByText("lonely_end", { exact: true })).toBeVisible();
  const kiss = page.locator(".MuiPaper-root").filter({ has: page.getByText("kiss", { exact: true }) }).filter({ hasText: "How to get it" });
  await kiss.getByRole("button", { name: "How to get it" }).click();
  await expect(kiss.getByText("“Sure”", { exact: true })).toBeVisible();
  await expect(kiss.getByText("vera_love >= 1").first()).toBeVisible();
  await expect(kiss.getByText(/Changed by:/)).toBeVisible();
  await page.getByRole("button", { name: "Choice walkthrough" }).click();
  await expect(page.getByText("Only way to kiss")).toBeVisible();

  // Dialogue: search, highlight, play from a line, export
  await nav.getByRole("tab", { name: "Dialogue" }).click();
  await page.getByLabel("Search dialogue").fill("coffee");
  await expect(page.getByText("2 of 6 lines")).toBeVisible();
  await expect(page.locator("mark", { hasText: "coffee" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Regular expression" }).click();
  await page.getByLabel("Search dialogue").fill("^(Oh|Great)");
  await expect(page.getByText("2 of 6 lines")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export screenplay" }).click();
  await page.getByRole("menuitem", { name: "Whole script · Markdown" }).click();
  const md = new TextDecoder().decode(await downloadBytes(await download));
  expect(md).toContain("**Vera:** Hi there. Fancy a coffee?");
  await page.getByRole("button", { name: /^Play from line/ }).first().click();
  await expect(page.getByText("Great, let's sit down.")).toBeVisible();
  await expect(page.getByText(/started at line/)).toBeVisible();

  // Audio: tracks, uses, jukebox
  await nav.getByRole("tab", { name: "Audio" }).click();
  await expect(page.getByText("audio.theme")).toBeVisible();
  await expect(page.getByText("file not found", { exact: true })).toBeVisible();
  await expect(page.getByText("never played", { exact: true })).toBeVisible();
  const voice = page.getByText("v_001", { exact: true });
  await expect(voice).toBeVisible();
  await page.getByRole("button", { name: "Play theme" }).click();
  const jukebox = page.getByRole("region", { name: "Jukebox" });
  await expect(jukebox.getByText("theme", { exact: true })).toBeVisible();
  await expect(jukebox.getByRole("button", { name: "Pause" })).toBeVisible({ timeout: 10_000 });
  await jukebox.getByRole("button", { name: "Next track" }).click();
  await expect(jukebox.getByText("theme", { exact: true })).toBeHidden();

  // Gallery: Gallery() buttons, replays, flags, CG guide
  await nav.getByRole("tab", { name: "Gallery" }).click();
  await expect(page.getByText("vera_date", { exact: true })).toBeVisible();
  await expect(page.getByText("persistent.vera_cg", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Replay button in screen gallery_screen", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "CG unlock guide", exact: true }).click();
  await expect(page.getByText("cg vera kiss", { exact: true })).toBeVisible();
  await expect(page.getByText("First seen after 2 decisions")).toBeVisible();
  await page.getByRole("button", { name: "Unlock flags", exact: true }).click();
  await expect(page.getByText("Used by screen:")).toBeVisible();
});
