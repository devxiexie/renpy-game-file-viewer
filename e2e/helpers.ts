import { readFileSync } from "node:fs";
import type { Download, Page } from "@playwright/test";

export const FIX = "test/fixtures";

export async function openFiles(page: Page, files: { name: string; buffer: Buffer; mimeType?: string }[]) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Open files$/ }).first().click();
  await (await chooser).setFiles(files.map((f) => ({ mimeType: "application/octet-stream", ...f })));
}

/** Open a directory through the <input webkitdirectory> fallback. */
export async function openFolder(page: Page, dir: string) {
  await page.evaluate(() => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = undefined;
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /^Open folder$/ }).first().click();
  await (await chooser).setFiles(dir);
}

export function fixture(path: string, name = path.split("/").pop()!) {
  return { name, buffer: readFileSync(`${FIX}/${path}`) };
}

export async function downloadBytes(d: Download): Promise<Uint8Array> {
  const stream = await d.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export async function noSavePicker(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
  });
}

export async function openTool(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("menuitem", { name }).click();
}

/** The file tree, switching back from the viewer pane first on small screens. */
export async function files(page: Page) {
  const back = page.getByRole("button", { name: "Back to files" }).first();
  if (await back.isVisible()) await back.click();
  return page.getByRole("tree", { name: "Files" });
}
