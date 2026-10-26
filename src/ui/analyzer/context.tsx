import { Link, Typography } from "@mui/material";
import { createContext, useContext, type ReactNode } from "react";
import type { TreeNode } from "../../core/vfs/tree";
import type { AnalyzerIndex, Loc } from "../../features/analyzer/model";
import type { ImageCatalog } from "../../features/analyzer/stage";
import { useApp } from "../../state/store";

export type AnalyzerTab = "explore" | "visuals" | "overview" | "characters" | "story" | "choices" | "variables" | "walkthrough" | "dialogue" | "audio" | "gallery";

export interface Selection {
  /** Story: open this label in the player. */
  label?: string;
  /** Story: start the player at this line of the label. */
  line?: number;
  /** Story sub-view. */
  story?: "cards" | "route" | "flow";
  /** Prefill the section's search box. */
  search?: string;
  character?: string;
  image?: string;
  variable?: string;
}

export interface AnalyzerCtx {
  index: AnalyzerIndex;
  catalog: ImageCatalog;
  /** Game-relative image / video / audio path → tree node. */
  fileNodes: Map<string, TreeNode>;
  query: string;
  go(tab: AnalyzerTab, sel?: Selection): void;
  selection: Selection;
}

const Ctx = createContext<AnalyzerCtx | null>(null);
export const AnalyzerProvider = Ctx.Provider;

export function useAnalyzer(): AnalyzerCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAnalyzer outside provider");
  return c;
}

export function useOpenSource() {
  const revealLine = useApp((s) => s.revealLine);
  return (loc: Loc) => revealLine({ fileId: loc.fileId, line: loc.line });
}

/** "script.rpy:42" link that opens the decompiled script at that line. */
export function SourceLink({ loc }: { loc: Loc | null }) {
  const open = useOpenSource();
  if (!loc) return <Typography variant="caption" color="text.secondary">images folder</Typography>;
  return (
    <Link component="button" variant="caption" onClick={() => open(loc)} sx={{ fontFamily: "inherit", whiteSpace: "nowrap" }}>
      {loc.file.replace(/^game\//, "")}:{loc.line}
    </Link>
  );
}

export function LabelLink({ name, children }: { name: string; children?: ReactNode }) {
  const { go, index } = useAnalyzer();
  const exists = index.labels.some((l) => l.name === name);
  if (!exists) return <Typography component="span" variant="body2" color="error" title="No label with this name">{name}</Typography>;
  return (
    <Link component="button" variant="body2" onClick={() => go("story", { label: name })} sx={{ fontFamily: "inherit", verticalAlign: "baseline" }}>
      {children ?? name}
    </Link>
  );
}

export function matches(query: string, ...fields: (string | null | undefined)[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => f && f.toLowerCase().includes(q));
}

/** Small swatch for a character's color (their colors are often too light to use as text). */
export function ColorDot({ color }: { color: string | null }) {
  if (!color) return null;
  return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: color.length === 9 ? color.slice(0, 7) : color, border: "1px solid rgba(128,128,128,.6)", marginRight: 6, verticalAlign: "middle" }} />;
}
