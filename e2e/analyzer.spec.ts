import { expect, test } from "@playwright/test";
import { files, openFolder } from "./helpers";

test("analyzer tab opens automatically and every section works", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => indexedDB.deleteDatabase("rpv-analyzer"));
  await openFolder(page, "test/fixtures/analyzer/src");

  // Auto-opened tab with header and Explore
  await expect(page.getByRole("tab", { name: /Ren'Py Analyzer/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analyzer Test" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Version 1.0")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Explore the game" })).toBeVisible();
  const nav = page.getByRole("tablist", { name: "Analyzer sections" });

  // Overview
  await nav.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Project profile")).toBeVisible();
  await expect(page.getByText("3 / 3 parsed")).toBeVisible();

  // Characters
  await nav.getByRole("tab", { name: "Characters" }).click();
  await expect(page.getByText("Dialogue share").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Sam/ })).toBeVisible();

  // Choices: Sam's decision with exclusive content
  await nav.getByRole("tab", { name: "Choices" }).click();
  await page.getByLabel("Search choices").fill("secret");
  await expect(page.getByText("Ask about the secret")).toBeVisible();
  await expect(page.getByText("Available if sam_points >= 3")).toBeVisible();

  // Variables: console command
  await nav.getByRole("tab", { name: "Variables" }).click();
  await page.getByLabel("Search game state (money, affection…)").fill("money");
  await expect(page.getByText("money = 99999")).toBeVisible();
  await expect(page.getByText("needs ≥ 100")).toBeVisible();
  // Where it's compared: operator chips, filter, what the test decides
  await page.getByLabel("Search game state (money, affection…)").fill("affection");
  await page.getByRole("combobox", { name: "Show" }).click();
  await page.getByRole("option", { name: "All variables" }).click();
  const tests = page.getByRole("group", { name: "Tests of affection" });
  await expect(tests.getByText("> 2", { exact: true })).toBeVisible();
  await tests.getByText("< MAX_AFFECTION", { exact: true }).click();
  const card = page.locator(".MuiPaper-root").filter({ has: tests });
  await expect(card.getByText(/shows choice “Stay here”/)).toBeVisible();
  await tests.getByText("≥ 3", { exact: true }).click();
  await expect(card.getByText(/^if → good_end/)).toBeVisible();

  // Story: label player with a menu, rewind
  await nav.getByRole("tab", { name: "Story / Labels" }).click();
  await page.getByRole("button", { name: "Explore start" }).click();
  await expect(page.getByText("Hello! Welcome to the analyzer test.")).toBeVisible();
  await page.getByRole("button", { name: "Next line" }).click();
  await page.getByRole("button", { name: "Next line" }).click();
  await page.getByRole("button", { name: "Stay here" }).click();
  await expect(page.getByText("Staying in is nice too.")).toBeVisible();
  await page.getByRole("button", { name: /^Stay here Menu in start/ }).click(); // rewind from "Choices made"
  await page.getByRole("button", { name: "The park" }).click();
  await expect(page.getByText("It's a bit cold here.")).toBeVisible();

  // Route inspector
  await page.getByRole("button", { name: "Labels" }).click();
  await page.getByRole("button", { name: "Route inspector" }).click();
  await page.getByLabel("Destination").fill("after_park");
  await page.getByRole("option", { name: "after_park" }).click();
  await expect(page.getByText("2 steps on the shortest static route:")).toBeVisible();

  // Flowchart
  await page.getByRole("button", { name: "Flowchart" }).click();
  await expect(page.locator(".react-flow__node").filter({ hasText: "good_end" })).toBeVisible();

  // Visuals: layered attributes
  await nav.getByRole("tab", { name: "Visuals" }).click();
  await page.getByLabel("Search visuals").fill("lucy");
  await page.getByText("lucy", { exact: true }).first().click();
  await expect(page.getByText("face: frown")).toBeVisible();

  // Cached on reload of the same game
  await page.getByRole("button", { name: "Clear cache & rescan" }).click();
  await expect(page.getByText("Saved to local cache")).toBeVisible({ timeout: 20_000 });
  void files;
});

test("files open in tabs next to the analyzer", async ({ page }) => {
  await page.goto("/");
  await openFolder(page, "test/fixtures/analyzer/src");
  const tree = await files(page);
  await tree.getByText("script.rpy", { exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("label start:");
  const tabs = page.getByRole("tablist", { name: "Open tabs" });
  await expect(tabs.getByRole("tab")).toHaveCount(2);
  await tabs.getByRole("tab", { name: /Ren'Py Analyzer/ }).click();
  await expect(page.getByRole("heading", { name: "Explore the game" })).toBeVisible();
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(3);
  await tabs.getByRole("button", { name: "Close New tab" }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(2);
});
