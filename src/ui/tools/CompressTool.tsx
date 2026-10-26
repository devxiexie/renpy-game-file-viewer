import { Alert, Box, Button, FormControlLabel, LinearProgress, Slider, Stack, Switch, Typography } from "@mui/material";
import CompressIcon from "@mui/icons-material/Compress";
import { useState } from "react";
import { extensionOf, formatBytes } from "../../core/files/types";
import { sourceToBlob } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";
import { downloadBlob } from "../../features/export/export";
import { writeRpa } from "../../formats/rpa/rpa";
import { useApp } from "../../state/store";
import { enginePool } from "../../workers/pool";
import { NodePicker } from "./NodePicker";
import { ToolHeader } from "./ToolHeader";

interface Report {
  name: string;
  files: number;
  converted: number;
  before: number;
  after: number;
}

export function CompressTool() {
  const tree = useApp((s) => s.tree);
  const expandArchive = useApp((s) => s.expandArchive);
  const [target, setTarget] = useState<TreeNode | null>(null);
  const [quality, setQuality] = useState(90);
  const [convertJpeg, setConvertJpeg] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!target) return;
    setError(null);
    setReport(null);
    try {
      if (target.archive && target.archive.status !== "ready") {
        setStatus("Reading archive…");
        await expandArchive(target.id);
      }
      const members = [...tree.files(target)].filter((n) => n.id !== target.id && !(n.archive && n.archiveId !== target.id && n.archive.status === "ready"));
      const base = target.path;
      const exts = convertJpeg ? ["png", "jpg", "jpeg"] : ["png"];
      const workers = enginePool();
      const out: { path: string; data: Blob }[] = new Array(members.length);
      let converted = 0;
      let before = 0;
      let done = 0;
      const queue = members.map((m, i) => ({ m, i }));
      const runWorker = async (w: (typeof workers)[number]) => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const { m, i } = job;
          const path = m.path.slice(base.length + 1);
          let data = await sourceToBlob(m.source!);
          before += data.size;
          if (exts.includes(extensionOf(m.name))) {
            const r = await w.recompressImage(m.source!, quality / 100);
            if (r) {
              data = r.blob;
              converted++;
            }
          }
          out[i] = { path, data };
          if (++done % 10 === 0 || done === members.length) {
            setStatus(`Re-encoding ${done}/${members.length}…`);
            setProgress((100 * done) / members.length);
          }
        }
      };
      setStatus(`Re-encoding ${members.length} files…`);
      await Promise.all(workers.map(runWorker));
      setStatus("Writing archive…");
      const rpa = await writeRpa(out);
      const name = target.archive ? target.name : `${target.name}.rpa`;
      downloadBlob(rpa, name);
      setReport({ name, files: members.length, converted, before, after: rpa.size });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setProgress(null);
    }
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
      <ToolHeader title="Compress RPA" subtitle="Rebuild an archive with PNG/JPEG images re-encoded as WebP. File names stay the same, so the game keeps working." />
      <Stack spacing={2} sx={{ p: 2, maxWidth: 720 }}>
        <NodePicker label="Archive or folder to pack" value={target} onChange={setTarget} />
        <Box>
          <Typography variant="body2" gutterBottom>WebP quality: {quality}</Typography>
          <Slider value={quality} min={50} max={100} step={1} onChange={(_, v) => setQuality(v as number)} aria-label="WebP quality" sx={{ maxWidth: 360 }} />
          <Typography variant="caption" color="text.secondary">90 is visually lossless for most game art. Images that wouldn't get smaller are kept as they are.</Typography>
        </Box>
        <FormControlLabel control={<Switch checked={convertJpeg} onChange={(e) => setConvertJpeg(e.target.checked)} />} label="Also re-encode JPEG images" />
        <Box>
          <Button variant="contained" startIcon={<CompressIcon />} onClick={run} disabled={!target || !!status}>
            Compress and download
          </Button>
        </Box>
        {status && (
          <Box>
            <Typography variant="caption" color="text.secondary">{status}</Typography>
            <LinearProgress variant={progress === null ? "indeterminate" : "determinate"} value={progress ?? 0} />
          </Box>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {report && (
          <Alert severity="success">
            {report.name}: {report.converted} of {report.files} files re-encoded. {formatBytes(report.before)} → {formatBytes(report.after)} (
            {report.before ? Math.round((100 * (report.before - report.after)) / report.before) : 0}% smaller). Replace the original archive in the game's folder with the downloaded one.
          </Alert>
        )}
        <Alert severity="info" variant="outlined">
          Keep a backup of the original archive. Ren'Py 7 and 8 load WebP images; very old Ren'Py 6 games may not.
        </Alert>
      </Stack>
    </Box>
  );
}
