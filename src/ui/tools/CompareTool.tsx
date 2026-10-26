import {
  Alert, Box, Button, Chip, CircularProgress, FormControlLabel, LinearProgress, List, ListItemButton, Stack, Switch, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import { useVirtualizer } from "@tanstack/react-virtual";
import { structuredPatch } from "diff";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, kindOf, mimeOf } from "../../core/files/types";
import type { TreeNode } from "../../core/vfs/tree";
import { pairFiles, type CompareEntry, type CompareStatus } from "../../features/compare/compare";
import { useApp } from "../../state/store";
import { engine } from "../../workers/client";
import { MONO } from "../theme";
import { useOpenActions } from "../useOpenActions";
import { useObjectUrl } from "../viewers/useObjectUrl";
import { NodePicker } from "./NodePicker";
import { ToolHeader } from "./ToolHeader";

const STATUS_COLOR: Record<CompareStatus, "success" | "error" | "warning" | "default" | "info"> = {
  added: "success",
  removed: "error",
  changed: "warning",
  same: "default",
  pending: "info",
};

export function CompareTool() {
  const tree = useApp((s) => s.tree);
  const expandArchive = useApp((s) => s.expandArchive);
  const { openFolder } = useOpenActions();
  const roots = tree.roots.filter((r) => r.kind === "dir" || r.archive);
  const [a, setA] = useState<TreeNode | null>(roots[0] ?? null);
  const [b, setB] = useState<TreeNode | null>(roots[1] ?? null);
  const [flatten, setFlatten] = useState(true);
  const [entries, setEntries] = useState<CompareEntry[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [show, setShow] = useState<CompareStatus | "all">("changed");
  const [selected, setSelected] = useState<CompareEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!a || !b) return;
    setError(null);
    setSelected(null);
    try {
      // Archives must be listed before their members can be matched.
      const archives = [...tree.files(a), ...tree.files(b)].filter((n) => n.archive && n.archive.status !== "ready");
      for (const [i, n] of archives.entries()) {
        setStatus(`Reading archive ${i + 1}/${archives.length}: ${n.name}`);
        await expandArchive(n.id);
      }
      const paired = pairFiles(tree, a, b, { flattenArchives: flatten });
      setEntries(paired);
      const pending = paired.filter((e) => e.status === "pending");
      let done = 0;
      setStatus(`Comparing ${pending.length} same-size files…`);
      const queue = [...pending];
      const worker = async () => {
        for (let e = queue.shift(); e; e = queue.shift()) {
          e.status = (await engine().sourcesEqual(e.a!.source!, e.b!.source!)) ? "same" : "changed";
          done++;
          if (done % 25 === 0 || done === pending.length) {
            setProgress((100 * done) / pending.length);
            setEntries([...paired]);
          }
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      setEntries([...paired]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setProgress(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<CompareStatus, number> = { added: 0, removed: 0, changed: 0, same: 0, pending: 0 };
    for (const e of entries ?? []) c[e.status]++;
    return c;
  }, [entries]);
  const visible = useMemo(() => (entries ?? []).filter((e) => show === "all" || e.status === show), [entries, show]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ToolHeader title="Compare Files" subtitle="Find added, removed and changed files between two builds. Archives are compared by their contents." />
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ p: 2, alignItems: { md: "center" }, borderBottom: 1, borderColor: "divider" }}>
        <NodePicker label="Old build (A)" value={a} onChange={setA} />
        <NodePicker label="New build (B)" value={b} onChange={setB} />
        <FormControlLabel control={<Switch size="small" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />} label={<Typography variant="body2">Look inside archives</Typography>} />
        <Button variant="contained" startIcon={<CompareArrowsIcon />} onClick={run} disabled={!a || !b || a.id === b.id || !!status}>
          Compare
        </Button>
      </Stack>
      {roots.length < 2 && !entries && (
        <Alert severity="info" sx={{ m: 2 }} action={<Button color="inherit" size="small" onClick={openFolder}>Open folder</Button>}>
          Open the second build as another folder; each opened folder appears at the top level of the file tree.
        </Alert>
      )}
      {status && (
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">{status}</Typography>
          <LinearProgress variant={progress === null ? "indeterminate" : "determinate"} value={progress ?? 0} />
        </Box>
      )}
      {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}
      {entries && (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: { xs: "column", md: "row" } }}>
          <Box sx={{ width: { xs: "100%", md: 380 }, flex: { xs: "1 1 0", md: "0 0 auto" }, minHeight: { xs: 180, md: 0 }, borderRight: { md: 1 }, borderBottom: { xs: 1, md: 0 }, borderColor: "divider", display: "flex", flexDirection: "column" }}>
            <Stack direction="row" sx={{ gap: 0.5, p: 1, flexWrap: "wrap" }}>
              {(["changed", "added", "removed", "same"] as const).map((s) => (
                <Chip key={s} size="small" color={show === s ? STATUS_COLOR[s] : "default"} variant={show === s ? "filled" : "outlined"} label={`${s} ${counts[s]}`} onClick={() => setShow(s)} />
              ))}
              <Chip size="small" variant={show === "all" ? "filled" : "outlined"} label={`all ${entries.length}`} onClick={() => setShow("all")} />
            </Stack>
            <EntryList entries={visible} selected={selected} onSelect={setSelected} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            {selected ? <EntryDetail key={selected.path} entry={selected} /> : <Typography color="text.secondary" sx={{ p: 3 }}>Select a file to see what changed.</Typography>}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function EntryList({ entries, selected, onSelect }: { entries: CompareEntry[]; selected: CompareEntry | null; onSelect(e: CompareEntry): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: entries.length, getScrollElement: () => ref.current, estimateSize: () => 34, overscan: 15 });
  return (
    <Box ref={ref} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <List dense disablePadding sx={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((item) => {
          const e = entries[item.index];
          const delta = e.a && e.b ? e.b.size - e.a.size : 0;
          return (
            <ListItemButton key={e.path} selected={selected?.path === e.path} onClick={() => onSelect(e)} sx={{ position: "absolute", top: item.start, left: 0, right: 0, height: 34, gap: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: e.status === "same" ? "action.disabled" : `${STATUS_COLOR[e.status]}.main` }} />
              <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: 13 }} title={e.path}>
                {e.path}
              </Typography>
              {e.status === "changed" && delta !== 0 && (
                <Typography variant="caption" color={delta > 0 ? "success.main" : "error.main"} sx={{ flexShrink: 0 }}>
                  {delta > 0 ? "+" : "−"}
                  {formatBytes(Math.abs(delta))}
                </Typography>
              )}
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}

function EntryDetail({ entry }: { entry: CompareEntry }) {
  const select = useApp((s) => s.select);
  const node = entry.b ?? entry.a!;
  const kind = kindOf(node.name);
  const both = entry.a && entry.b;
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mr: "auto", minWidth: 0 }} noWrap>
          {entry.path}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {entry.a ? formatBytes(entry.a.size) : "—"} → {entry.b ? formatBytes(entry.b.size) : "—"}
        </Typography>
        {entry.a && <Button size="small" onClick={() => select(entry.a!.id)}>Open A</Button>}
        {entry.b && <Button size="small" onClick={() => select(entry.b!.id)}>Open B</Button>}
      </Box>
      {both && (kind === "script" || kind === "text" || kind === "rpyc") ? (
        <TextDiff a={entry.a!} b={entry.b!} />
      ) : both && kind === "image" ? (
        <ImageDiff a={entry.a!} b={entry.b!} />
      ) : (
        <Typography color="text.secondary" sx={{ p: 3 }}>
          {entry.status === "added" ? "Only in the new build." : entry.status === "removed" ? "Only in the old build." : entry.status === "same" ? "Identical." : "Binary file changed."}
        </Typography>
      )}
    </Box>
  );
}

function TextDiff({ a, b }: { a: TreeNode; b: TreeNode }) {
  const [patch, setPatch] = useState<ReturnType<typeof structuredPatch> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([engine().fileText(a.name, a.source!), engine().fileText(b.name, b.source!)])
      .then(([ta, tb]) => setPatch(structuredPatch("A", "B", ta, tb, "", "", { context: 3 })))
      .catch((e) => setError(String(e)));
  }, [a, b]);
  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!patch) return <CircularProgress sx={{ m: 3 }} />;
  if (patch.hunks.length === 0) return <Typography color="text.secondary" sx={{ p: 3 }}>No text differences (the files differ only in encoding or compiled form).</Typography>;
  const added = patch.hunks.reduce((n, h) => n + h.lines.filter((l) => l[0] === "+").length, 0);
  const removed = patch.hunks.reduce((n, h) => n + h.lines.filter((l) => l[0] === "-").length, 0);
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", fontFamily: MONO, fontSize: 12.5 }}>
      <Typography variant="caption" sx={{ display: "block", px: 2, py: 0.75, fontFamily: "inherit" }}>
        <Box component="span" sx={{ color: "success.main" }}>+{added}</Box> <Box component="span" sx={{ color: "error.main" }}>−{removed}</Box> lines
      </Typography>
      {patch.hunks.map((h, i) => {
        let oldLine = h.oldStart;
        let newLine = h.newStart;
        return (
          <Box key={i} sx={{ mb: 1 }}>
            <Box sx={{ px: 2, py: 0.25, bgcolor: "action.hover", color: "text.secondary" }}>
              @@ −{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@
            </Box>
            {h.lines.map((l, j) => {
              const t = l[0];
              const o = t === "+" ? "" : oldLine++;
              const n = t === "-" ? "" : newLine++;
              return (
                <Box key={j} sx={{ display: "flex", whiteSpace: "pre-wrap", wordBreak: "break-all", bgcolor: t === "+" ? "rgba(46,160,67,.15)" : t === "-" ? "rgba(248,81,73,.15)" : undefined }}>
                  <Box component="span" sx={{ width: 48, flexShrink: 0, textAlign: "right", pr: 1, color: "text.disabled", userSelect: "none" }}>{o}</Box>
                  <Box component="span" sx={{ width: 48, flexShrink: 0, textAlign: "right", pr: 1, color: "text.disabled", userSelect: "none" }}>{n}</Box>
                  <Box component="span" sx={{ width: 16, flexShrink: 0, color: t === "+" ? "success.main" : t === "-" ? "error.main" : "text.disabled" }}>{t === " " ? "" : t}</Box>
                  <Box component="span" sx={{ flex: 1 }}>{l.slice(1)}</Box>
                </Box>
              );
            })}
          </Box>
        );
      })}
    </Box>
  );
}

const CHECKER = "repeating-conic-gradient(rgba(128,128,128,.18) 0% 25%, transparent 0% 50%) 50% / 20px 20px";

function ImageDiff({ a, b }: { a: TreeNode; b: TreeNode }) {
  const ua = useObjectUrl(a.source, mimeOf(a.name)).url;
  const ub = useObjectUrl(b.source, mimeOf(b.name)).url;
  const [mode, setMode] = useState<"side" | "diff">("side");
  const [diffUrl, setDiffUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "diff" || !ua || !ub) return;
    let url: string | null = null;
    (async () => {
      const [ia, ib] = await Promise.all([fetch(ua).then((r) => r.blob()).then(createImageBitmap), fetch(ub).then((r) => r.blob()).then(createImageBitmap)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const ctx = (c: HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true })!;
      const ca = Object.assign(document.createElement("canvas"), { width: w, height: h });
      const cb = Object.assign(document.createElement("canvas"), { width: w, height: h });
      ctx(ca).drawImage(ia, 0, 0);
      ctx(cb).drawImage(ib, 0, 0);
      const da = ctx(ca).getImageData(0, 0, w, h);
      const db = ctx(cb).getImageData(0, 0, w, h);
      const out = ctx(ca).createImageData(w, h);
      let changed = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.abs(da.data[i] - db.data[i]) + Math.abs(da.data[i + 1] - db.data[i + 1]) + Math.abs(da.data[i + 2] - db.data[i + 2]) + Math.abs(da.data[i + 3] - db.data[i + 3]);
        const gray = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 12;
        if (d > 8) {
          changed++;
          out.data.set([255, 40, 80, 255], i);
        } else out.data.set([gray, gray, gray, 255], i);
      }
      ctx(ca).putImageData(out, 0, 0);
      setStats(`${ia.width}×${ia.height} → ${ib.width}×${ib.height} · ${((100 * changed) / (w * h)).toFixed(2)}% of pixels differ`);
      const blob = await new Promise<Blob | null>((r) => ca.toBlob(r));
      if (blob) setDiffUrl((url = URL.createObjectURL(blob)));
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [mode, ua, ub]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2, py: 0.75, display: "flex", gap: 2, alignItems: "center" }}>
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
          <ToggleButton value="side">Side by side</ToggleButton>
          <ToggleButton value="diff">Difference</ToggleButton>
        </ToggleButtonGroup>
        {mode === "diff" && stats && <Typography variant="caption" color="text.secondary">{stats}</Typography>}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", gap: 2, p: 2, background: CHECKER, flexDirection: { xs: "column", sm: "row" } }}>
        {mode === "side" ? (
          [ua, ub].map((u, i) => (
            <Box key={i} sx={{ flex: 1, minWidth: 0, textAlign: "center" }}>
              <Typography variant="caption" sx={{ display: "block", mb: 0.5, bgcolor: "background.paper", borderRadius: 1 }}>{i ? "B (new)" : "A (old)"}</Typography>
              {u && <img src={u} alt={i ? "New" : "Old"} style={{ maxWidth: "100%" }} />}
            </Box>
          ))
        ) : diffUrl ? (
          <img src={diffUrl} alt="Difference" style={{ maxWidth: "100%", margin: "auto" }} />
        ) : (
          <CircularProgress sx={{ m: "auto" }} />
        )}
      </Box>
    </Box>
  );
}
