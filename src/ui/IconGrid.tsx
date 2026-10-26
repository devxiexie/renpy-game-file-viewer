import { Box, Breadcrumbs, IconButton, Typography } from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { kindOf } from "../core/files/types";
import type { TreeNode } from "../core/vfs/tree";
import type { TypeFilter } from "./FileTreeView";
import { useApp } from "../state/store";
import { Thumbnail } from "./Thumbnail";

/** Large Icons view: a virtualized gallery of the current folder's entries. */
export function IconGrid({ filter, typeFilter }: { filter: string; typeFilter: TypeFilter }) {
  const tree = useApp((s) => s.tree);
  const revision = useApp((s) => s.revision);
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const toggleExpand = useApp((s) => s.toggleExpand);
  const expanded = useApp((s) => s.expanded);
  const size = useApp((s) => s.thumbSize);

  // Current folder: the selected folder/archive, else the selected file's folder, else the top level.
  const folder = useMemo(() => {
    const sel = selectedId ? tree.get(selectedId) : undefined;
    if (sel && tree.isExpandable(sel) && (sel.kind === "dir" || sel.archive?.status === "ready")) return sel;
    return sel?.parentId ? tree.get(sel.parentId) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, selectedId, revision]);

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (typeFilter) {
      // Type filter: every matching file in the current folder and below, as a flat gallery.
      const all = folder ? [...tree.files(folder)] : [...tree.files()];
      return all.filter((n) => kindOf(n.name) === typeFilter && (!q || n.name.toLowerCase().includes(q)));
    }
    const base = folder ? (folder.children ?? []) : tree.roots;
    return q ? base.filter((n) => n.name.toLowerCase().includes(q)) : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, folder, filter, typeFilter, revision]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tile = size + 16;
  const tileHeight = size + 40;
  const columns = Math.max(1, Math.floor((width - 8) / tile));
  const rowCount = Math.ceil(items.length / columns);
  const virtualizer = useVirtualizer({ count: rowCount, getScrollElement: () => scrollRef.current, estimateSize: () => tileHeight, overscan: 4 });
  useEffect(() => virtualizer.measure(), [virtualizer, tileHeight]);

  const open = (n: TreeNode) => {
    if (n.archive && n.archive.status !== "ready") {
      if (!expanded.has(n.id)) toggleExpand(n.id);
    }
    select(n.id);
  };

  const crumbs: TreeNode[] = [];
  for (let n = folder; n; n = n.parentId ? tree.get(n.parentId) : undefined) crumbs.unshift(n);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" }}>
        <IconButton size="small" disabled={!folder} onClick={() => folder && select(folder.parentId)} aria-label="Up one folder">
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <Breadcrumbs maxItems={3} sx={{ fontSize: 12, minWidth: 0 }}>
          <Typography variant="caption" sx={{ cursor: "pointer" }} onClick={() => select(null)}>
            All files
          </Typography>
          {crumbs.map((c) => (
            <Typography key={c.id} variant="caption" noWrap sx={{ cursor: "pointer" }} onClick={() => select(c.id)}>
              {c.name}
            </Typography>
          ))}
        </Breadcrumbs>
      </Box>
      <Box ref={scrollRef} role="grid" aria-label="Files" sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 0.5 }}>
        <Box sx={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => (
            <Box key={v.index} role="row" sx={{ position: "absolute", top: v.start, left: 0, right: 0, height: tileHeight, display: "flex" }}>
              {items.slice(v.index * columns, v.index * columns + columns).map((n) => (
                <Box
                  key={n.id}
                  role="gridcell"
                  aria-selected={n.id === selectedId}
                  title={n.path}
                  onClick={() => (n.kind === "dir" ? select(n.id) : open(n))}
                  sx={{
                    width: tile,
                    p: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 0.5,
                    cursor: "pointer",
                    borderRadius: 1,
                    bgcolor: n.id === selectedId ? "action.selected" : undefined,
                    "&:hover": { bgcolor: "action.hover" },
                  }}
                >
                  <Thumbnail node={n} size={size} />
                  <Typography variant="caption" noWrap sx={{ width: "100%", textAlign: "center", fontSize: 11 }}>
                    {n.name}
                  </Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        {items.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Empty folder.
          </Typography>
        )}
      </Box>
    </Box>
  );
}
