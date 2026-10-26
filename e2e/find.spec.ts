import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { FIX, files, openFiles } from "./helpers";

test("find in file bar searches the whole script", async ({ page }) => {
  await page.goto("/");
  await openFiles(page, [{ name: "script.rpyc", buffer: readFileSync(`${FIX}/rpyc/8.5.3/the_question_script.rpyc`) }]);
  await (await files(page)).getByText("script.rpyc").click();
  await expect(page.locator(".cm-content")).toContainText("scene bg lecturehall", { timeout: 15_000 });

  // Ctrl/Cmd+F opens our bar instead of the browser's.
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+f");
  const bar = page.getByRole("search", { name: "Find in file" });
  const input = bar.getByRole("textbox", { name: "Find in file" });
  await expect(input).toBeFocused();

  // Searching starts at the cursor and wraps around.
  await input.fill("sylvie");
  await expect(bar.getByText("of 20", { exact: false })).toBeVisible();
  const at = Number((await bar.getByText(/ of 20$/).textContent())!.split(" of ")[0]);
  await input.press("Enter");
  await expect(bar.getByText(`${(at % 20) + 1} of 20`)).toBeVisible();
  await input.press("Shift+Enter");
  await input.press("Shift+Enter");
  await expect(bar.getByText(`${((at + 18) % 20) + 1} of 20`)).toBeVisible();

  await input.fill("Good Ending");
  await expect(bar.getByText("1 of 1")).toBeVisible();
  await expect(bar.getByText(/^1 of \d+$/)).toBeVisible();
  // The match is near the end of the file, beyond what CodeMirror rendered at first.
  await expect(page.locator(".cm-find-current")).toHaveText("Good Ending");

  await input.fill("good ending");
  await expect(bar.getByText("1 of 1")).toBeVisible();
  await bar.getByRole("button", { name: "Match case" }).click();
  await expect(bar.getByText("No results")).toBeVisible();
  await bar.getByRole("button", { name: "Match case" }).click();
  await bar.getByRole("button", { name: "Regular expression" }).click();
  await input.fill("(");
  await expect(bar.getByText("Invalid regex")).toBeVisible();
  await input.fill("^label \\w+:");
  await expect(bar.getByText(/^1 of \d+$/)).toBeVisible();

  await input.press("Escape");
  await expect(bar).toBeHidden();
  await expect(page.locator(".cm-find-match")).toHaveCount(0);
  await page.getByRole("button", { name: "Find in file" }).click();
  await expect(input).toHaveValue("^label \\w+:");
});
