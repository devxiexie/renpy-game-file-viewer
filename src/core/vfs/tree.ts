import { kindOf } from "../files/types";
import type { ArchiveListing } from "../../formats/archive";
import { blobSource, sourceSize, type FileSource } from "./source";

export type ArchiveStatus = "idle" | "loading" | "ready" | "error";

export interface TreeNode {
  id: string;
  name: string;
  /** Path relative to the opened root, "/" separated. Archive members: "<archive path>/<member path>". */
  path: string;
  kind: "dir" | "file";
  parentId: string | null;
  children?: TreeNode[];
  source?: FileSource;
  size: number;
  /** Set on files that live inside an archive. */
  archiveId?: string;
  /** Set on .rpa files: lazy expansion state. */
  archive?: { status: ArchiveStatus; error?: string; version?: string; entryCount?: number; skipped?: number };
}

export interface InputFile {
  /** Relative path, "/" separated (e.g. "MyGame/game/script.rpy"). */
  path: string;
  file: Blob;
}

/**
 * Mutable file tree. Nodes are kept in a flat registry for O(1) lookup; the UI keys
 * re-renders off a revision counter instead of copying 100k-node trees.
 */
export class FileTree {
  readonly nodes = new Map<string, TreeNode>();
  readonly roots: TreeNode[] = [];

  get(id: string): TreeNode | undefined {
    return this.nodes.get(id);
  }

  clear(): void {
    this.nodes.clear();
    this.roots.length = 0;
  }

  private ensureDir(parent: TreeNode | null, name: string, path: string, archiveId?: string): TreeNode {
    const siblings = parent ? (parent.children ??= []) : this.roots;
    let dir = siblings.find((n) => n.name === name && n.kind === "dir");
    if (!dir) {
      dir = { id: path, name, path, kind: "dir", parentId: parent?.id ?? null, children: [], size: 0, archiveId };
      siblings.push(dir);
      this.nodes.set(dir.id, dir);
    }
    return dir;
  }

  private addAt(parent: TreeNode | null, relPath: string, basePath: string, source: FileSource, archiveId?: string): TreeNode {
    const parts = relPath.split("/").filter(Boolean);
    let dir = parent;
    let path = basePath;
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part;
      dir = this.ensureDir(dir, part, path, archiveId);
    }
    const name = parts[parts.length - 1] ?? relPath;
    const fullPath = path ? `${path}/${name}` : name;
    const siblings = dir ? (dir.children ??= []) : this.roots;
    const existing = this.nodes.get(fullPath);
    if (existing) {
      existing.source = source;
      existing.size = sourceSize(source);
      return existing;
    }
    const node: TreeNode = {
      id: fullPath,
      name,
      path: fullPath,
      kind: "file",
      parentId: dir?.id ?? null,
      source,
      size: sourceSize(source),
      archiveId,
    };
    if (kindOf(name) === "archive") node.archive = { status: "idle" };
    siblings.push(node);
    this.nodes.set(node.id, node);
    return node;
  }

  addFiles(files: InputFile[]): void {
    for (const f of files) this.addAt(null, f.path, "", blobSource(f.file));
    this.finish();
  }

  /** Attach an archive's listing as children of its node. */
  expandArchive(archiveNode: TreeNode, listing: ArchiveListing): void {
    archiveNode.children = [];
    for (const m of listing.members) this.addAt(archiveNode, m.path, archiveNode.path, m.source, archiveNode.id);
    archiveNode.archive = { status: "ready", version: listing.format, entryCount: listing.members.length, skipped: listing.skipped.length };
    this.finish(archiveNode);
  }

  /** Add a single file at the top level (e.g. opened from a URL). */
  addSource(path: string, source: FileSource): TreeNode {
    const node = this.addAt(null, path, "", source);
    this.finish();
    return node;
  }

  /** Sort children (folders first, natural order) and compute folder sizes. */
  finish(from?: TreeNode): void {
    const visit = (n: TreeNode): number => {
      if (!n.children) return n.size;
      n.children.sort(compareNodes);
      let total = 0;
      for (const c of n.children) total += visit(c);
      if (n.kind === "dir") n.size = total;
      return n.kind === "dir" ? total : n.size;
    };
    if (from) visit(from);
    else {
      this.roots.sort(compareNodes);
      this.roots.forEach(visit);
    }
  }

  /** All file nodes under `node` (or the whole tree), including expanded archive members. */
  *files(node?: TreeNode): Generator<TreeNode> {
    const stack = node ? [node] : [...this.roots];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.kind === "file" && n.source) yield n;
      if (n.children) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }

  isExpandable(n: TreeNode): boolean {
    return n.kind === "dir" || !!n.archive;
  }
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareNodes(a: TreeNode, b: TreeNode): number {
  const ad = a.kind === "dir" ? 0 : 1;
  const bd = b.kind === "dir" ? 0 : 1;
  return ad - bd || collator.compare(a.name, b.name);
}

export interface VisibleRow {
  node: TreeNode;
  depth: number;
}

/** Flatten the expanded part of the tree into rows for a virtualized list. */
export function visibleRows(tree: FileTree, expanded: Set<string>, filter?: (n: TreeNode) => boolean): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      if (filter && !filter(n)) continue;
      rows.push({ node: n, depth });
      if (n.children && expanded.has(n.id)) walk(n.children, depth + 1);
    }
  };
  walk(tree.roots, 0);
  return rows;
}
