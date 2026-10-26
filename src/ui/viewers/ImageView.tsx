import { Alert, Box, Button, CircularProgress, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import { useApp } from "../../state/store";
import { useState } from "react";
import { mimeOf } from "../../core/files/types";
import type { TreeNode } from "../../core/vfs/tree";
import { useObjectUrl } from "./useObjectUrl";

const CHECKER = "repeating-conic-gradient(rgba(128,128,128,.18) 0% 25%, transparent 0% 50%) 50% / 20px 20px";

export function ImageView({ node }: { node: TreeNode }) {
  const { url, error } = useObjectUrl(node.source, mimeOf(node.name));
  const [mode, setMode] = useState<"fit" | "actual">("fit");
  const [dims, setDims] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  const addMergeLayer = useApp((s) => s.addMergeLayer);
  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 2, borderBottom: 1, borderColor: "divider" }}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
          <ToggleButton value="fit">Fit</ToggleButton>
          <ToggleButton value="actual">100%</ToggleButton>
        </ToggleButtonGroup>
        {dims && <Typography variant="caption" color="text.secondary">{dims}</Typography>}
        <Button size="small" startIcon={<LayersOutlinedIcon />} onClick={() => addMergeLayer(node.id)} sx={{ ml: "auto" }}>
          Add to merge
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", alignItems: mode === "fit" ? "center" : "flex-start", justifyContent: mode === "fit" ? "center" : "flex-start", p: 2, background: CHECKER }}>
        {!url && <CircularProgress />}
        {broken && <Alert severity="warning">This image format can't be displayed by the browser. Use Download to save it.</Alert>}
        {url && !broken && (
          <img
            src={url}
            alt={node.name}
            onLoad={(e) => setDims(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)}
            onError={() => setBroken(true)}
            style={mode === "fit" ? { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" } : { maxWidth: "none" }}
          />
        )}
      </Box>
    </Box>
  );
}
