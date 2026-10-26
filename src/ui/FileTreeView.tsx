import { Box, Chip, Checkbox, Stack, CircularProgress, IconButton, InputAdornment, Slider, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FilterListIcon from "@mui/icons-material/FilterList";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import MovieOutlinedIcon from "@mui/icons-material/MovieOutlined";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, kindOf } from "../core/files/types";
import { visibleRows, type TreeNode } from "../core/vfs/tree";
import { useApp, type TreeViewMode } from "../state/store";
import { FileIcon } from "./fileIcons";
import { IconGrid } from "./IconGrid";
import { Thumbnail } from "./Thumbnail";

const ROW_HEIGHT = 28;

export type TypeFilter = "image" | "video" | null;

export function FileTreeView() {
  const tree = useApp((s) => s.tree);
  const revision = useApp((s) => s.revision);
  const expanded = useApp((s) => s.expanded);
  const selectedId = useApp((s) => s.selectedId);
  const checked = useApp((s) => s.checked);
  const toggleExpand = useApp((s) => s.toggleExpand);
  const select = useApp((s) => s.select);
  const toggleChecked = useApp((s) => s.toggleChecked);
  const viewMode = useApp((s) => s.viewMode);
  const setViewMode = useApp((s) => s.setViewMode);
  const thumbSize = useApp((s) => s.thumbSize);
  const setThumbSize = useApp((s) => s.setThumbSize);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(null);
  const expandArchive = useApp((s) => s.expandArchive);
  // With only an Images/Videos filter on, folders open and close normally and start closed.
  const typeMode = !!typeFilter && !filter.trim();
  const [typeExpanded, setTypeExpanded] = useState<Set<string>>(new Set());
  useEffect(() => setTypeExpanded(new Set()), [typeFilter]);
  const isOpen = (id: string) => (typeMode ? typeExpanded.has(id) : filter.trim() ? true : expanded.has(id));
  const toggle = (id: string) => {
    if (!typeMode) return toggleExpand(id);
    setTypeExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Archive contents only exist once an archive is opened; open them all so the filter sees them.
  useEffect(() => {
    if (!typeFilter) return;
    for (const f of [...tree.files()]) if (f.archive?.status === "idle") void expandArchive(f.id);
  }, [typeFilter, tree, revision, expandArchive]);
  const compact = viewMode === "compact";
  const rowHeight = compact ? thumbSize + 6 : ROW_HEIGHT;

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q && !typeFilter) return visibleRows(tree, expanded);
    // Keep matching files and the folders that contain them. A text search opens those
    // folders; the type filter alone leaves them for the user to open.
    const keep = new Set<string>();
    for (const f of tree.files()) {
      if (q && !f.path.toLowerCase().includes(q)) continue;
      if (typeFilter && kindOf(f.name) !== typeFilter) continue;
      let n: TreeNode | undefined = f;
      while (n) {
        keep.add(n.id);
        n = n.parentId ? tree.get(n.parentId) : undefined;
      }
    }
    return visibleRows(tree, q ? keep : typeExpanded, (n) => keep.has(n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, revision, expanded, filter, typeFilter, typeExpanded]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, overscan: compact ? 6 : 20 });
  useEffect(() => virtualizer.measure(), [virtualizer, rowHeight]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = rows.findIndex((r) => r.node.id === selectedId);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, idx + (e.key === "ArrowDown" ? 1 : -1)))];
      if (next) {
        select(next.node.id);
        virtualizer.scrollToIndex(rows.indexOf(next));
      }
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && idx >= 0) {
      const node = rows[idx].node;
      const open = isOpen(node.id);
      if (tree.isExpandable(node) && (e.key === "ArrowRight") !== open) toggle(node.id);
      else if (e.key === "ArrowLeft" && node.parentId) select(node.parentId);
    } else if (e.key === " " && idx >= 0) {
      e.preventDefault();
      toggleChecked(rows[idx].node.id);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Filter by name or path"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><FilterListIcon fontSize="small" /></InputAdornment> } }}
        />
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1 }}>
          <ToggleButtonGroup size="small" exclusive value={viewMode} onChange={(_, v: TreeViewMode | null) => v && setViewMode(v)}>
            <ToggleButton value="tree" aria-label="Tree view">
              <Tooltip title="Tree"><AccountTreeOutlinedIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="compact" aria-label="Compact preview">
              <Tooltip title="Compact Preview: tree with thumbnails"><ViewListIcon fontSize="small" /></Tooltip>
            </ToggleButton>
            <ToggleButton value="icons" aria-label="Large icons">
              <Tooltip title="Large Icons: gallery of the current folder"><GridViewIcon fontSize="small" /></Tooltip>
            </ToggleButton>
          </ToggleButtonGroup>
          {viewMode !== "tree" && (
            <Slider size="small" min={40} max={128} step={4} value={thumbSize} onChange={(_, v) => setThumbSize(v as number)} aria-label="Thumbnail size" valueLabelDisplay="auto" valueLabelFormat={(v) => `${v}px`} sx={{ flex: 1 }} />
          )}
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {(["image", "video"] as const).map((k) => (
            <Chip
              key={k}
              size="small"
              icon={k === "image" ? <ImageOutlinedIcon /> : <MovieOutlinedIcon />}
              label={k === "image" ? "Images" : "Videos"}
              color={typeFilter === k ? "primary" : "default"}
              variant={typeFilter === k ? "filled" : "outlined"}
              onClick={() => setTypeFilter(typeFilter === k ? null : k)}
              aria-pressed={typeFilter === k}
            />
          ))}
        </Stack>
        {checked.size > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {checked.size} file{checked.size === 1 ? "" : "s"} selected for export
          </Typography>
        )}
      </Box>
      {viewMode === "icons" ? (
        <IconGrid filter={filter} typeFilter={typeFilter} />
      ) : (
      <Box ref={parentRef} tabIndex={0} onKeyDown={onKeyDown} role="tree" aria-label="Files" sx={{ flex: 1, minHeight: 0, overflow: "auto", outline: "none" }}>
        <Box sx={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => {
            const { node, depth } = rows[v.index];
            return (
              <TreeRow
                key={node.id}
                node={node}
                depth={depth}
                top={v.start}
                height={rowHeight}
                thumbSize={compact ? thumbSize : 0}
                open={isOpen(node.id)}
                selected={node.id === selectedId}
                checkState={checkState(node, checked, tree.files.bind(tree))}
                expandable={tree.isExpandable(node)}
                onToggle={() => toggle(node.id)}
                onSelect={() => select(node.id)}
                onCheck={() => toggleChecked(node.id)}
              />
            );
          })}
        </Box>
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            No files match.
          </Typography>
        )}
      </Box>
      )}
    </Box>
  );
}

function checkState(node: TreeNode, checked: Set<string>, files: (n: TreeNode) => Iterable<TreeNode>): "none" | "some" | "all" {
  if (checked.size === 0) return "none";
  if (node.kind === "file" && !node.children) return checked.has(node.id) ? "all" : "none";
  let any = false;
  let all = true;
  for (const f of files(node)) {
    if (checked.has(f.id)) any = true;
    else all = false;
    if (any && !all) break;
  }
  return any ? (all ? "all" : "some") : "none";
}

interface RowProps {
  node: TreeNode;
  depth: number;
  top: number;
  height: number;
  thumbSize: number;
  open: boolean;
  selected: boolean;
  checkState: "none" | "some" | "all";
  expandable: boolean;
  onToggle(): void;
  onSelect(): void;
  onCheck(): void;
}

function TreeRow({ node, depth, top, height, thumbSize, open, selected, checkState, expandable, onToggle, onSelect, onCheck }: RowProps) {
  const archive = node.archive;
  return (
    <Box
      role="treeitem"
      aria-selected={selected}
      aria-expanded={expandable ? open : undefined}
      onClick={onSelect}
      onDoubleClick={() => expandable && onToggle()}
      sx={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        height,
        display: "flex",
        alignItems: "center",
        pl: `${depth * 14 + 2}px`,
        pr: 1,
        gap: 0.5,
        cursor: "pointer",
        userSelect: "none",
        bgcolor: selected ? "action.selected" : "transparent",
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
        "& .row-check": { opacity: checkState === "none" ? 0 : 1 },
        "&:hover .row-check": { opacity: 1 },
        "@media (hover: none)": { "& .row-check": { opacity: 1 } },
      }}
    >
      <Box sx={{ width: 20, display: "flex", justifyContent: "center", flexShrink: 0 }}>
        {expandable && (
          <IconButton
            size="small"
            sx={{ p: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={open ? "Collapse" : "Expand"}
          >
            {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
        )}
      </Box>
      <Checkbox
        className="row-check"
        size="small"
        sx={{ p: 0.25, "& svg": { fontSize: 16 } }}
        checked={checkState === "all"}
        indeterminate={checkState === "some"}
        onClick={(e) => e.stopPropagation()}
        onChange={onCheck}
        slotProps={{ input: { "aria-label": `Select ${node.name}` } }}
      />
      {thumbSize ? <Thumbnail node={node} size={thumbSize} open={open} /> : <FileIcon node={node} open={open} />}
      <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0, fontSize: 13 }} title={node.path}>
        {node.name}
      </Typography>
      {archive?.status === "loading" && <CircularProgress size={12} />}
      {archive?.status === "error" && (
        <Tooltip title={archive.error ?? "Could not read archive"}>
          <ErrorOutlineIcon color="error" sx={{ fontSize: 16 }} />
        </Tooltip>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
        {archive?.status === "ready" ? `${archive.entryCount} files · ` : ""}
        {formatBytes(node.size)}
      </Typography>
    </Box>
  );
}
