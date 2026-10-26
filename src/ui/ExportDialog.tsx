import {
  Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, FormLabel, LinearProgress,
  Radio, RadioGroup, Stack, TextField, Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import { formatBytes } from "../core/files/types";
import type { TreeNode } from "../core/vfs/tree";
import { collectExportItems, downloadBlob, rpaFromItems, saveZip, withDecompiledScripts } from "../features/export/export";
import { useApp } from "../state/store";
import { engine } from "../workers/client";

type Scope = "selected" | "all";
type Format = "zip" | "rpa";

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tree = useApp((s) => s.tree);
  const revision = useApp((s) => s.revision);
  const checked = useApp((s) => s.checked);
  const expandArchive = useApp((s) => s.expandArchive);
  const [scope, setScope] = useState<Scope>(checked.size ? "selected" : "all");
  const [format, setFormat] = useState<Format>("zip");
  const [extractArchives, setExtractArchives] = useState(true);
  const [decompileScripts, setDecompileScripts] = useState(true);
  const [name, setName] = useState("export");
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targets = useMemo((): TreeNode[] => {
    const all = [...tree.files()];
    return scope === "all" ? all : all.filter((f) => checked.has(f.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, revision, checked, scope]);
  const totalSize = targets.reduce((s, n) => s + n.size, 0);
  const busy = status !== null;

  const run = async () => {
    setError(null);
    try {
      let nodes = targets;
      if (extractArchives) {
        const pending = nodes.filter((n) => n.archive && n.archive.status !== "ready");
        for (const [i, a] of pending.entries()) {
          setStatus(`Reading archive ${i + 1}/${pending.length}: ${a.name}`);
          await expandArchive(a.id);
        }
        // Members of archives in scope join the export.
        const extra = nodes.filter((n) => n.archive?.status === "ready").flatMap((a) => [...tree.files(a)].filter((m) => m.id !== a.id));
        nodes = [...nodes, ...extra];
      }
      let items = collectExportItems(tree, nodes, { extractArchives, decompileScripts });
      if (decompileScripts) items = await withDecompiledScripts(items, async (src) => (await engine().decompile(src)).source, setStatus);
      if (items.length === 0) throw new Error("Nothing to export.");
      setStatus(`Packing ${items.length} files…`);
      if (format === "zip") {
        await saveZip(items, `${name || "export"}.zip`, (d, t) => setProgress((100 * d) / t));
      } else {
        downloadBlob(await rpaFromItems(items), `${name || "archive"}.rpa`);
      }
      onClose();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Export files</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <div>
            <FormLabel>Files</FormLabel>
            <RadioGroup value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
              <FormControlLabel value="selected" disabled={checked.size === 0} control={<Radio size="small" />} label={`Selected files (${checked.size})`} />
              <FormControlLabel value="all" control={<Radio size="small" />} label="All opened files" />
            </RadioGroup>
            {checked.size === 0 && (
              <Typography variant="caption" color="text.secondary">
                Tick files or folders in the tree to export a selection.
              </Typography>
            )}
          </div>
          <div>
            <FormLabel>Format</FormLabel>
            <RadioGroup row value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              <FormControlLabel value="zip" control={<Radio size="small" />} label="ZIP" />
              <FormControlLabel value="rpa" control={<Radio size="small" />} label="Ren'Py archive (RPA-3.0)" />
            </RadioGroup>
          </div>
          <div>
            <FormControlLabel control={<Checkbox size="small" checked={extractArchives} onChange={(e) => setExtractArchives(e.target.checked)} />} label="Extract .rpa archives (export their contents)" />
            <FormControlLabel control={<Checkbox size="small" checked={decompileScripts} onChange={(e) => setDecompileScripts(e.target.checked)} />} label="Add decompiled .rpy next to .rpyc files" />
          </div>
          <TextField size="small" label="File name" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ input: { endAdornment: <Typography color="text.secondary">.{format}</Typography> } }} />
          <Typography variant="body2" color="text.secondary">
            {targets.length.toLocaleString()} files · {formatBytes(totalSize)} before extraction
          </Typography>
          {status && (
            <div>
              <Typography variant="caption" color="text.secondary">{status}</Typography>
              <LinearProgress variant={progress === null ? "indeterminate" : "determinate"} value={progress ?? 0} />
            </div>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={run} disabled={busy || targets.length === 0}>
          Export
        </Button>
      </DialogActions>
    </Dialog>
  );
}
