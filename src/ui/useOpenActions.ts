import { useCallback } from "react";
import { canPickDirectory, filesFromDirectoryPicker, filesFromInput } from "../core/vfs/collect";
import type { InputFile } from "../core/vfs/tree";
import { useApp } from "../state/store";

function pickWithInput(directory: boolean): Promise<InputFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (directory) input.webkitdirectory = true;
    input.onchange = () => resolve(input.files ? filesFromInput(input.files) : []);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export function useOpenActions() {
  const openFiles = useApp((s) => s.openFiles);
  const setLoading = useApp((s) => s.setLoading);

  const run = useCallback(
    async (get: () => Promise<InputFile[]>) => {
      try {
        const files = await get();
        if (files.length) {
          setLoading(`Opening ${files.length} files…`);
          openFiles(files);
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") console.error(e);
      } finally {
        setLoading(null);
      }
    },
    [openFiles, setLoading],
  );

  return {
    openFolder: () => run(() => (canPickDirectory() ? filesFromDirectoryPicker() : pickWithInput(true))),
    openFilesDialog: () => run(() => pickWithInput(false)),
  };
}
