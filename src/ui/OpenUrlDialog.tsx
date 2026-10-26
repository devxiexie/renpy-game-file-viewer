import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { formatBytes } from "../core/files/types";
import { bytesSource, probeUrl } from "../core/vfs/source";
import { useApp } from "../state/store";

/** Largest file we download whole when the server doesn't support Range requests. */
const FULL_DOWNLOAD_LIMIT = 2 * 1024 * 1024 * 1024;

export function OpenUrlDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const addRemoteFile = useApp((s) => s.addRemoteFile);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      setError("Enter a full http(s) URL.");
      return;
    }
    try {
      setStatus("Checking the file…");
      const probe = await probeUrl(parsed.href);
      if (probe.rangeSupported) {
        addRemoteFile(`remote/${probe.name}`, { type: "url", url: parsed.href, size: probe.size });
        onClose();
        return;
      }
      if (probe.size > FULL_DOWNLOAD_LIMIT) throw new Error(`The server doesn't support partial downloads and the file is ${formatBytes(probe.size)}.`);
      setStatus(`Downloading ${probe.size ? formatBytes(probe.size) : ""} (the server doesn't support partial reads)…`);
      const res = await fetch(parsed.href);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (probe.size) setProgress((100 * received) / probe.size);
      }
      const bytes = new Uint8Array(received);
      let pos = 0;
      for (const c of chunks) bytes.set(c, (pos += c.length) - c.length);
      addRemoteFile(`remote/${probe.name}`, bytesSource(bytes));
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg === "Failed to fetch"
          ? "The server blocked the request. It has to allow cross-origin (CORS) requests from this site."
          : msg,
      );
    } finally {
      setStatus(null);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onClose={status ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Open from URL</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Open a remote .rpa, .zip or any single game file. Servers that support Range requests are read on demand, so large archives aren't downloaded whole.
        </Typography>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="File URL"
          placeholder="https://example.com/game/archive.rpa"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !status && void run()}
        />
        {status && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
              {status}
            </Typography>
            <LinearProgress variant={progress === null ? "indeterminate" : "determinate"} value={progress ?? 0} />
          </>
        )}
        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={!!status}>Cancel</Button>
        <Button variant="contained" onClick={run} disabled={!!status || !url.trim()}>
          Open
        </Button>
      </DialogActions>
    </Dialog>
  );
}
