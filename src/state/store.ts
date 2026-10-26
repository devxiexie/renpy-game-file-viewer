import { create } from "zustand";
import type { FileSource } from "../core/vfs/source";
import { FileTree, type InputFile, type TreeNode } from "../core/vfs/tree";
import { engine } from "../workers/client";

export type SidePanel = "files" | "search";
export type ToolId = "analyzer" | "compare" | "translate" | "compress" | "merge";
export type TreeViewMode = "tree" | "compact" | "icons";

export type MainTab =
  | { key: string; kind: "file"; nodeId: string | null }
  | { key: string; kind: "tool"; tool: ToolId }
  | { key: string; kind: "help" };

let tabCounter = 0;
const newKey = () => `tab-${++tabCounter}`;

/** Folders that look like a Ren'Py game: compiled scripts, archives or a game/ directory with scripts. */
export function looksLikeRenpy(tree: FileTree): boolean {
  for (const f of tree.files()) if (/\.(rpyc|rpa|rpy|rpymc)$/i.test(f.name)) return true;
  return false;
}

export interface RevealTarget {
  fileId: string;
  line: number;
  column?: number;
  length?: number;
}

interface AppState {
  tree: FileTree;
  /** Bumped on every tree mutation so subscribers re-render. */
  revision: number;
  expanded: Set<string>;
  selectedId: string | null;
  checked: Set<string>;
  panel: SidePanel;
  reveal: RevealTarget | null;
  loading: string | null;
  tool: ToolId | null;
  viewMode: TreeViewMode;
  thumbSize: number;
  /** Image node ids queued for the Merge Images tool, bottom layer first. */
  mergeLayers: string[];
  /** Small screens show one pane at a time: the file list or the viewer/tool. */
  mobilePane: "files" | "main";
  tabs: MainTab[];
  activeKey: string | null;
  /** Bumped to ask the Analyzer to (re)scan, e.g. when it auto-opens for a new game. */
  analyzerScanRequest: number;

  openFiles(files: InputFile[]): void;
  closeAll(): void;
  toggleExpand(id: string): void;
  /** Load an archive's listing; `reveal` also expands it in the file tree. */
  expandArchive(id: string, reveal?: boolean): Promise<void>;
  select(id: string | null): void;
  revealLine(target: RevealTarget): void;
  activateTab(key: string): void;
  closeTab(key: string): void;
  newTab(): void;
  openHelp(): void;
  toggleChecked(id: string): void;
  clearChecked(): void;
  setPanel(panel: SidePanel): void;
  setLoading(message: string | null): void;
  openTool(tool: ToolId | null): void;
  setViewMode(mode: TreeViewMode): void;
  setThumbSize(px: number): void;
  addRemoteFile(path: string, source: FileSource): void;
  addMergeLayer(id: string): void;
  setMergeLayers(ids: string[]): void;
  setMobilePane(pane: "files" | "main"): void;
}

function readPref<T extends string | number>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return (typeof fallback === "number" ? Number(v) : v) as T;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string | number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable */
  }
}

export const useApp = create<AppState>((set, get) => ({
  tree: new FileTree(),
  revision: 0,
  expanded: new Set(),
  selectedId: null,
  checked: new Set(),
  panel: "files",
  reveal: null,
  loading: null,
  tool: null,
  viewMode: readPref<TreeViewMode>("rpv.viewMode", "tree"),
  thumbSize: readPref("rpv.thumbSize", 64),
  mergeLayers: [],
  mobilePane: "files",
  tabs: [],
  activeKey: null,
  analyzerScanRequest: 0,

  openFiles(files) {
    const { tree } = get();
    tree.addFiles(files);
    // Auto-expand down to the first level with more than one entry (e.g. MyGame/game).
    const expanded = new Set(get().expanded);
    let level = tree.roots;
    while (level.length === 1 && level[0].kind === "dir") {
      expanded.add(level[0].id);
      level = level[0].children ?? [];
    }
    const game = level.find((n) => n.kind === "dir" && n.name === "game");
    if (game) expanded.add(game.id);
    set({ revision: get().revision + 1, expanded });
    // Like GRV: a Ren'Py game gets an Analyzer tab automatically (can be turned off).
    if (readPref("rpv.autoAnalyzer", "1") === "1" && looksLikeRenpy(tree)) {
      get().openTool("analyzer");
      set({ analyzerScanRequest: get().analyzerScanRequest + 1 });
    }
  },

  closeAll() {
    get().tree.clear();
    set({ revision: get().revision + 1, expanded: new Set(), selectedId: null, checked: new Set(), reveal: null, tabs: [], activeKey: null, tool: null });
  },

  toggleExpand(id) {
    const node = get().tree.get(id);
    if (!node) return;
    const expanded = new Set(get().expanded);
    if (expanded.has(id)) {
      expanded.delete(id);
    } else {
      expanded.add(id);
      if (node.archive && node.archive.status === "idle") void get().expandArchive(id, true);
    }
    set({ expanded });
  },

  async expandArchive(id, reveal = false) {
    const { tree } = get();
    const node = tree.get(id);
    if (!node?.source || !node.archive || node.archive.status === "loading") return;
    node.archive = { status: "loading" };
    set({ revision: get().revision + 1 });
    try {
      // RPA-1.0 archives keep their index in a sibling .rpi file.
      const rpi = siblingIndex(tree, node);
      const listing = await engine().archiveListing(node.name, node.source, rpi?.source);
      tree.expandArchive(node, listing);
      const expanded = new Set(get().expanded);
      if (reveal) expanded.add(id);
      set({ revision: get().revision + 1, expanded });
    } catch (e) {
      node.archive = { status: "error", error: e instanceof Error ? e.message : String(e) };
      set({ revision: get().revision + 1 });
    }
  },

  select(id) {
    const node = id ? get().tree.get(id) : undefined;
    // Show it in the active file tab, else the most recent file tab, else a new one.
    const { tabs, activeKey } = get();
    const active = tabs.find((t) => t.key === activeKey);
    let target = active?.kind === "file" ? active : [...tabs].reverse().find((t) => t.kind === "file");
    let next = tabs;
    if (!target) {
      target = { key: newKey(), kind: "file", nodeId: id };
      next = [...tabs, target];
    }
    next = next.map((t) => (t.key === target!.key ? { ...t, nodeId: id } : t));
    set({
      tabs: next,
      activeKey: target.key,
      selectedId: id,
      reveal: null,
      tool: null,
      mobilePane: node?.kind === "file" && !node.archive ? "main" : get().mobilePane,
    });
  },

  openTool(tool) {
    if (!tool) {
      const last = [...get().tabs].reverse().find((t) => t.kind === "file");
      set({ tool: null, activeKey: last?.key ?? null });
      return;
    }
    let tab = get().tabs.find((t) => t.kind === "tool" && t.tool === tool);
    const tabs = tab ? get().tabs : [...get().tabs, (tab = { key: newKey(), kind: "tool", tool })];
    set({ tabs, activeKey: tab.key, tool, mobilePane: "main" });
  },

  activateTab(key) {
    const t = get().tabs.find((x) => x.key === key);
    if (!t) return;
    set({
      activeKey: key,
      tool: t.kind === "tool" ? t.tool : null,
      selectedId: t.kind === "file" ? t.nodeId : get().selectedId,
      reveal: null,
    });
  },

  closeTab(key) {
    const { tabs, activeKey } = get();
    const i = tabs.findIndex((t) => t.key === key);
    if (i < 0) return;
    const rest = tabs.filter((t) => t.key !== key);
    if (activeKey !== key) return set({ tabs: rest });
    const neighbour = rest[i] ?? rest[i - 1] ?? null;
    set({ tabs: rest, activeKey: null, tool: null });
    if (neighbour) get().activateTab(neighbour.key);
  },

  newTab() {
    const tab: MainTab = { key: newKey(), kind: "file", nodeId: null };
    set({ tabs: [...get().tabs, tab], activeKey: tab.key, tool: null, selectedId: null });
  },

  openHelp() {
    let tab = get().tabs.find((t) => t.kind === "help");
    const tabs = tab ? get().tabs : [...get().tabs, (tab = { key: newKey(), kind: "help" })];
    set({ tabs, activeKey: tab.key, tool: null, mobilePane: "main" });
  },

  setMobilePane(mobilePane) {
    set({ mobilePane });
  },

  setViewMode(viewMode) {
    writePref("rpv.viewMode", viewMode);
    set({ viewMode });
  },

  setThumbSize(thumbSize) {
    writePref("rpv.thumbSize", thumbSize);
    set({ thumbSize });
  },

  addRemoteFile(path, source) {
    const { tree } = get();
    const node = tree.addSource(path, source);
    const expanded = new Set(get().expanded);
    for (let p = node.parentId; p; p = tree.get(p)?.parentId ?? null) expanded.add(p);
    set({ revision: get().revision + 1, expanded });
    get().select(node.id);
    if (node.archive) void get().expandArchive(node.id, true);
  },

  addMergeLayer(id) {
    const layers = get().mergeLayers.filter((l) => l !== id);
    set({ mergeLayers: [...layers, id] });
    get().openTool("merge");
  },

  setMergeLayers(mergeLayers) {
    set({ mergeLayers });
  },

  revealLine(target) {
    const { tree } = get();
    const expanded = new Set(get().expanded);
    let n = tree.get(target.fileId);
    while (n?.parentId) {
      expanded.add(n.parentId);
      n = tree.get(n.parentId);
    }
    // Source lines open in a file tab of their own so the tool tab stays where it was.
    const existing = get().tabs.find((t) => t.kind === "file" && t.nodeId === target.fileId);
    const tab: MainTab = existing ?? { key: newKey(), kind: "file", nodeId: target.fileId };
    set({
      tabs: existing ? get().tabs : [...get().tabs, tab],
      activeKey: tab.key,
      selectedId: target.fileId,
      reveal: target,
      expanded,
      tool: null,
      mobilePane: "main",
    });
  },

  toggleChecked(id) {
    const { tree } = get();
    const node = tree.get(id);
    if (!node) return;
    const checked = new Set(get().checked);
    const ids = node.kind === "file" && !node.children ? [node.id] : [...tree.files(node)].map((f) => f.id);
    const allChecked = ids.every((i) => checked.has(i));
    for (const i of ids) {
      if (allChecked) checked.delete(i);
      else checked.add(i);
    }
    set({ checked });
  },

  clearChecked() {
    set({ checked: new Set() });
  },

  setPanel(panel) {
    set({ panel });
  },

  setLoading(message) {
    set({ loading: message });
  },
}));

function siblingIndex(tree: FileTree, node: TreeNode): TreeNode | undefined {
  if (!node.path.toLowerCase().endsWith(".rpa")) return undefined;
  const rpiPath = node.path.slice(0, -4) + ".rpi";
  return tree.get(rpiPath);
}

export function setAutoAnalyzer(on: boolean) {
  writePref("rpv.autoAnalyzer", on ? "1" : "0");
}

export function autoAnalyzerEnabled(): boolean {
  return readPref("rpv.autoAnalyzer", "1") === "1";
}

export function useSelectedNode(): TreeNode | null {
  const id = useApp((s) => s.selectedId);
  useApp((s) => s.revision);
  const tree = useApp((s) => s.tree);
  return id ? (tree.get(id) ?? null) : null;
}
