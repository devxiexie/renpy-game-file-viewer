import {
  Alert, Autocomplete, Box, Button, Checkbox, IconButton, Slider, Stack, TextField, Tooltip, Typography,
} from "@mui/material";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadIcon from "@mui/icons-material/Download";
import { useEffect, useMemo, useRef, useState } from "react";
import { kindOf, mimeOf } from "../../core/files/types";
import { sourceToBlob } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";
import { downloadBlob } from "../../features/export/export";
import { useApp } from "../../state/store";
import { Thumbnail } from "../Thumbnail";
import { ToolHeader } from "./ToolHeader";

interface LayerSettings {
  visible: boolean;
  opacity: number;
  x: number;
  y: number;
}

const DEFAULT: LayerSettings = { visible: true, opacity: 100, x: 0, y: 0 };
const CHECKER = "repeating-conic-gradient(rgba(128,128,128,.18) 0% 25%, transparent 0% 50%) 50% / 20px 20px";

export function MergeTool() {
  const tree = useApp((s) => s.tree);
  const revision = useApp((s) => s.revision);
  const layerIds = useApp((s) => s.mergeLayers);
  const setLayers = useApp((s) => s.setMergeLayers);
  const [settings, setSettings] = useState<Record<string, LayerSettings>>({});
  const [bitmaps, setBitmaps] = useState<Record<string, ImageBitmap | null>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const layers = layerIds.map((id) => tree.get(id)).filter((n): n is TreeNode => !!n);
  const images = useMemo(() => [...tree.files()].filter((n) => kindOf(n.name) === "image"), [tree, revision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    for (const n of layers) {
      if (n.id in bitmaps) continue;
      setBitmaps((b) => ({ ...b, [n.id]: null }));
      void sourceToBlob(n.source!, mimeOf(n.name))
        .then((blob) => createImageBitmap(blob))
        .then((bmp) => setBitmaps((b) => ({ ...b, [n.id]: bmp })))
        .catch(() => setBitmaps((b) => ({ ...b, [n.id]: null })));
    }
  }, [layers, bitmaps]);

  const size = useMemo(() => {
    let w = 1;
    let h = 1;
    for (const n of layers) {
      const b = bitmaps[n.id];
      const s = settings[n.id] ?? DEFAULT;
      if (b) {
        w = Math.max(w, b.width + s.x);
        h = Math.max(h, b.height + s.y);
      }
    }
    return { w, h };
  }, [layers, bitmaps, settings]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, size.w, size.h);
    for (const n of layers) {
      const b = bitmaps[n.id];
      const s = settings[n.id] ?? DEFAULT;
      if (!b || !s.visible) continue;
      ctx.globalAlpha = s.opacity / 100;
      ctx.drawImage(b, s.x, s.y);
    }
    ctx.globalAlpha = 1;
  }, [layers, bitmaps, settings, size]);

  const update = (id: string, patch: Partial<LayerSettings>) => setSettings((s) => ({ ...s, [id]: { ...(s[id] ?? DEFAULT), ...patch } }));
  const move = (i: number, d: number) => {
    const ids = [...layerIds];
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setLayers(ids);
  };
  const exportPng = () => canvasRef.current?.toBlob((b) => b && downloadBlob(b, `${layers[0]?.name.replace(/\.[^.]+$/, "") ?? "merged"}-merged.png`), "image/png");

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ToolHeader title="Merge Images" subtitle="Stack separated layers (bodies, faces, outfits) into one picture.">
        <Button size="small" variant="contained" startIcon={<DownloadIcon />} disabled={layers.length === 0} onClick={exportPng}>
          Save PNG
        </Button>
      </ToolHeader>
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: { xs: "column", md: "row" } }}>
        <Box sx={{ width: { xs: "100%", md: 340 }, flexShrink: 0, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: "divider", overflow: "auto", maxHeight: { xs: "45%", md: "none" } }}>
          <Box sx={{ p: 1.5 }}>
            <Autocomplete
              size="small"
              options={images}
              value={null}
              blurOnSelect
              onChange={(_, n) => n && setLayers([...layerIds.filter((l) => l !== n.id), n.id])}
              getOptionLabel={(n) => n.path}
              renderInput={(p) => <TextField {...p} label="Add image layer" />}
            />
            <Typography variant="caption" color="text.secondary">Top of the list is drawn last (on top). You can also use "Add to merge" on any image.</Typography>
          </Box>
          {layers.length === 0 && <Alert severity="info" sx={{ m: 1.5 }}>Add two or more images to combine them.</Alert>}
          {[...layers].reverse().map((n) => {
            const i = layerIds.indexOf(n.id);
            const s = settings[n.id] ?? DEFAULT;
            return (
              <Box key={n.id} sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: "divider" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Checkbox size="small" checked={s.visible} onChange={(e) => update(n.id, { visible: e.target.checked })} slotProps={{ input: { "aria-label": `Show ${n.name}` } }} />
                  <Thumbnail node={n} size={36} />
                  <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }} title={n.path}>{n.name}</Typography>
                  <Tooltip title="Move up"><span><IconButton size="small" disabled={i === layerIds.length - 1} onClick={() => move(i, 1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title="Move down"><span><IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                  <Tooltip title="Remove"><IconButton size="small" onClick={() => setLayers(layerIds.filter((l) => l !== n.id))}><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
                </Stack>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", pl: 5 }}>
                  <Typography variant="caption" sx={{ width: 52 }}>Opacity</Typography>
                  <Slider size="small" value={s.opacity} min={0} max={100} onChange={(_, v) => update(n.id, { opacity: v as number })} aria-label="Opacity" />
                </Stack>
                <Stack direction="row" spacing={1} sx={{ pl: 5, mt: 0.5 }}>
                  <TextField size="small" type="number" label="X" value={s.x} onChange={(e) => update(n.id, { x: Math.max(0, Number(e.target.value) || 0) })} sx={{ width: 90 }} />
                  <TextField size="small" type="number" label="Y" value={s.y} onChange={(e) => update(n.id, { y: Math.max(0, Number(e.target.value) || 0) })} sx={{ width: 90 }} />
                </Stack>
              </Box>
            );
          })}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", p: 2, background: CHECKER, display: "flex", alignItems: "flex-start", justifyContent: "center" }}>
          <canvas ref={canvasRef} style={{ maxWidth: "100%", height: "auto" }} aria-label="Merged image preview" />
        </Box>
      </Box>
    </Box>
  );
}
