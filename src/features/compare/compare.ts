import { readSource, sourceSize, type FileSource } from "../../core/vfs/source";
import type { FileTree, TreeNode } from "../../core/vfs/tree";
import { exportPath } from "../export/export";

export type CompareStatus = "added" | "removed" | "changed" | "same" | "pending";

export interface CompareEntry {
  /** Path relative to each side's root. */
  path: string;
  status: CompareStatus;
  a?: TreeNode;
  b?: TreeNode;
}

export interface CompareOptions {
  /** Compare archive members as if they were extracted next to their archive. */
  flattenArchives: boolean;
}

/** Path of `node` relative to `root` as used for matching files between two builds. */
export function relativePath(tree: FileTree, root: TreeNode, node: TreeNode, opts: CompareOptions): string {
  if (root.archive) return node.path.slice(root.path.length + 1);
  const p = opts.flattenArchives ? exportPath(tree, node) : node.path;
  return p.startsWith(root.path + "/") ? p.slice(root.path.length + 1) : p;
}

function filesUnder(tree: FileTree, root: TreeNode, opts: CompareOptions): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>();
  for (const f of tree.files(root)) {
    if (f.id === root.id) continue;
    if (opts.flattenArchives && f.archive?.status === "ready") continue; // compare its members instead
    const rel = relativePath(tree, root, f, opts);
    const existing = out.get(rel);
    if (existing && !existing.archiveId) continue; // loose files win over archive members
    out.set(rel, f);
  }
  return out;
}

/** Pair the files of two roots. Same-size pairs come back as "pending" until their bytes are checked. */
export function pairFiles(tree: FileTree, rootA: TreeNode, rootB: TreeNode, opts: CompareOptions): CompareEntry[] {
  const a = filesUnder(tree, rootA, opts);
  const b = filesUnder(tree, rootB, opts);
  const entries: CompareEntry[] = [];
  for (const [path, na] of a) {
    const nb = b.get(path);
    if (!nb) entries.push({ path, status: "removed", a: na });
    else entries.push({ path, status: na.size !== nb.size ? "changed" : "pending", a: na, b: nb });
  }
  for (const [path, nb] of b) if (!a.has(path)) entries.push({ path, status: "added", b: nb });
  return entries.sort((x, y) => x.path.localeCompare(y.path));
}

/** Byte-for-byte comparison in chunks (no hashing needed when both files are local). */
export async function sourcesEqual(a: FileSource, b: FileSource): Promise<boolean> {
  const size = sourceSize(a);
  if (size !== sourceSize(b)) return false;
  const CHUNK = 1 << 20;
  for (let pos = 0; pos < size; pos += CHUNK) {
    const end = Math.min(size, pos + CHUNK);
    const [x, y] = await Promise.all([readSource(a, pos, end), readSource(b, pos, end)]);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}
