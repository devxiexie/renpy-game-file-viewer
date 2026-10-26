import type { InputFile } from "./tree";

/** Collect files (recursively) from a drag-and-drop DataTransfer, preserving folder paths. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<InputFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) {
    return Array.from(dt.files).map((file) => ({ path: file.name, file }));
  }
  const out: InputFile[] = [];
  await Promise.all(entries.map((e) => walkEntry(e, "", out)));
  return out;
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: InputFile[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ path, file });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    // readEntries returns results in batches (100 in Chrome); call until empty.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      children.push(...batch);
    }
    await Promise.all(children.map((c) => walkEntry(c, path, out)));
  }
}

/** Files from an <input type="file"> (with or without webkitdirectory). */
export function filesFromInput(list: FileList): InputFile[] {
  return Array.from(list).map((file) => ({ path: file.webkitRelativePath || file.name, file }));
}

interface DirectoryHandleLike {
  name: string;
  kind: "directory";
  values(): AsyncIterable<{ kind: "file" | "directory"; name: string; getFile?: () => Promise<File> }>;
}

export function canPickDirectory(): boolean {
  return typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function";
}

/** Chromium's File System Access API directory picker. */
export async function filesFromDirectoryPicker(): Promise<InputFile[]> {
  const picker = (globalThis as unknown as { showDirectoryPicker: (o?: object) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
  const root = await picker({ mode: "read" });
  const out: InputFile[] = [];
  const walk = async (dir: DirectoryHandleLike, prefix: string) => {
    for await (const h of dir.values()) {
      const path = `${prefix}/${h.name}`;
      if (h.kind === "file" && h.getFile) out.push({ path, file: await h.getFile() });
      else if (h.kind === "directory") await walk(h as unknown as DirectoryHandleLike, path);
    }
  };
  await walk(root, root.name);
  return out;
}
