import { extensionOf } from "../core/files/types";
import type { FileSource } from "../core/vfs/source";
import { readRpaIndex, rpaEntrySource } from "./rpa/rpa";
import { readZipIndex, zipEntrySource } from "./zip/zip";

export interface ArchiveMember {
  path: string;
  source: FileSource;
}

export interface ArchiveListing {
  /** e.g. "RPA-3.0", "ZIP" */
  format: string;
  members: ArchiveMember[];
  /** Members that can't be read (e.g. encrypted ZIP entries). */
  skipped: string[];
}

/** List the members of an archive file (.rpa or .zip). `rpi` is the RPA-1.0 index file, if any. */
export async function listArchive(name: string, src: FileSource, rpi?: FileSource): Promise<ArchiveListing> {
  const ext = extensionOf(name);
  if (ext === "zip" || ext === "apk") {
    const entries = await readZipIndex(src);
    const members: ArchiveMember[] = [];
    const skipped: string[] = [];
    for (const e of entries) {
      if (e.encrypted || (e.method !== 0 && e.method !== 8)) skipped.push(e.path);
      else members.push({ path: e.path, source: zipEntrySource(src, e) });
    }
    return { format: "ZIP", members, skipped };
  }
  const index = await readRpaIndex(src, rpi);
  return { format: index.version, members: index.entries.map((e) => ({ path: e.path, source: rpaEntrySource(src, e) })), skipped: [] };
}
