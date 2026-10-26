import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge as RFEdge, type Node as RFNode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Alert, Autocomplete, Box, Button, Chip, Menu, MenuItem, Slider, Stack, Switch, FormControlLabel, TextField, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useColorScheme } from "@mui/material/styles";
import { useMemo, useState } from "react";
import { graphToHtml, graphToSvg, layoutGraph, neighborhood, type GraphOptions } from "../../features/analyzer/graph";
import type { EdgeKind } from "../../features/analyzer/model";
import { downloadBlob } from "../../features/export/export";
import { useAnalyzer, useOpenSource } from "./context";

const WHOLE_GRAPH_LIMIT = 400;
const KIND_LABEL: [EdgeKind, string][] = [["jump", "Jumps"], ["call", "Calls"], ["fallthrough", "Fall-through"]];

async function rasterize(svg: string, type: string, scale = 2): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    await new Promise<void>((res, rej) => ((img.onload = () => res()), (img.onerror = () => rej(new Error("Could not render the flowchart")), (img.src = url))));
    const c = document.createElement("canvas");
    c.width = img.width * scale;
    c.height = img.height * scale;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, type, 0.92));
    if (!blob) throw new Error("This browser could not export that format");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function FlowView({ onOpenLabel }: { onOpenLabel?(label: string): void }) {
  const { index, selection, go } = useAnalyzer();
  const openSource = useOpenSource();
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === "system" ? systemMode : mode) === "dark";
  const small = index.labels.length <= WHOLE_GRAPH_LIMIT;
  const [whole, setWhole] = useState(small && !selection.label);
  const [focus, setFocus] = useState<string>(selection.label ?? (index.labels.find((l) => l.name === "start") ?? index.labels[0])?.name ?? "");
  const [depth, setDepth] = useState(2);
  const [kinds, setKinds] = useState<Set<EdgeKind>>(new Set(["jump", "call", "fallthrough"]));
  const [collapseHelpers, setCollapseHelpers] = useState(false);
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opts: GraphOptions = useMemo(() => ({ kinds, collapseHelpers }), [kinds, collapseHelpers]);

  const graph = useMemo(() => layoutGraph(index, neighborhood(index, whole ? null : focus, depth, opts), opts), [index, whole, focus, depth, opts]);

  const nodes: RFNode[] = graph.nodes.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.id },
    width: n.width,
    height: n.height,
    style: {
      width: n.width,
      fontSize: 12,
      fontFamily: "ui-monospace, Menlo, monospace",
      borderRadius: 8,
      border: n.id === focus && !whole ? "2px solid #d9480f" : n.missing ? "1px dashed #c92a2a" : "1px solid #888",
      background: n.entry ? "#ffe8d9" : n.ending === "return" ? "#e6fcf5" : n.missing ? "#fff5f5" : dark ? "#262626" : "#fff",
      color: n.entry || n.ending === "return" || n.missing ? "#222" : undefined,
    },
  }));
  const edges: RFEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    animated: e.kind === "call",
    label: e.count > 1 ? `×${e.count}` : undefined,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { strokeDasharray: e.kind === "fallthrough" ? "4 4" : e.conditional ? "8 3" : undefined, stroke: e.kind === "call" ? "#1c7ed6" : undefined },
  }));

  const doExport = async (format: "svg" | "png" | "jpg" | "webp" | "html") => {
    setExportAnchor(null);
    setError(null);
    if (graph.nodes.length === 0) return setError("No flowchart nodes to export.");
    const title = `${index.game.name ?? "Ren'Py"} flowchart`;
    const svg = graphToSvg(graph, title);
    const base = (index.game.name ?? "flowchart").replace(/[^\w-]+/g, "_");
    try {
      if (format === "svg") downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${base}-flowchart.svg`);
      else if (format === "html") downloadBlob(new Blob([graphToHtml(svg, title)], { type: "text/html" }), `${base}-flowchart.html`);
      else downloadBlob(await rasterize(svg, `image/${format === "jpg" ? "jpeg" : format}`), `${base}-flowchart.${format}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggle = (k: EdgeKind) => setKinds((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", p: 1, flexWrap: "wrap" }}>
        {small && <FormControlLabel control={<Switch size="small" checked={whole} onChange={(e) => setWhole(e.target.checked)} />} label={<Typography variant="body2">Whole story</Typography>} />}
        {!whole && (
          <>
            <Autocomplete
              size="small"
              options={index.labels.map((l) => l.name)}
              value={focus}
              disableClearable
              onChange={(_, v) => v && setFocus(v)}
              renderInput={(p) => <TextField {...p} label="Centered on" />}
              sx={{ width: 220 }}
            />
            <Box sx={{ width: 150, display: "flex", alignItems: "center", gap: 1 }}>
              <Typography variant="caption">Depth</Typography>
              <Slider size="small" min={1} max={6} value={depth} onChange={(_, v) => setDepth(v as number)} valueLabelDisplay="auto" aria-label="Depth" />
            </Box>
          </>
        )}
        {KIND_LABEL.map(([k, l]) => (
          <Chip key={k} size="small" label={l} color={kinds.has(k) ? "primary" : "default"} variant={kinds.has(k) ? "filled" : "outlined"} onClick={() => toggle(k)} />
        ))}
        <Chip size="small" label="Collapse repeated calls" color={collapseHelpers ? "primary" : "default"} variant={collapseHelpers ? "filled" : "outlined"} onClick={() => setCollapseHelpers(!collapseHelpers)} />
        <Button size="small" startIcon={<DownloadIcon />} onClick={(e) => setExportAnchor(e.currentTarget)} sx={{ ml: "auto" }}>Export</Button>
        <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
          {(["svg", "png", "jpg", "webp", "html"] as const).map((f) => (
            <MenuItem key={f} onClick={() => void doExport(f)}>{f === "html" ? "Interactive HTML" : f.toUpperCase()}</MenuItem>
          ))}
        </Menu>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pb: 0.5 }}>
        {graph.nodes.length} labels · solid = jump, blue animated = call, dashed = falls through, long dash = conditional. Click to center, double-click to explore, right-click to open source.
      </Typography>
      {!small && whole && <Alert severity="info">This game has {index.labels.length} labels; the flowchart shows the area around one label at a time.</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Box sx={{ flex: 1, minHeight: 300 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          minZoom={0.05}
          nodesDraggable={false}
          nodesConnectable={false}
          selectionOnDrag
          panOnDrag={[1, 2]}
          colorMode={dark ? "dark" : "light"}
          onNodeClick={(_, n) => {
            if (index.labels.some((l) => l.name === n.id)) {
              setFocus(n.id);
              setWhole(false);
            }
          }}
          onNodeDoubleClick={(_, n) => {
            if (onOpenLabel) onOpenLabel(n.id);
            else go("story", { label: n.id });
          }}
          onNodeContextMenu={(e, n) => {
            e.preventDefault();
            const l = index.labels.find((x) => x.name === n.id);
            if (l) openSource(l.loc);
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </Box>
    </Box>
  );
}
