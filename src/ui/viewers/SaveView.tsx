import {
  Alert, Box, Button, Chip, CircularProgress, FormControlLabel, IconButton, InputAdornment, Stack, Switch, TextField, Typography,
} from "@mui/material";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DownloadIcon from "@mui/icons-material/Download";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FilterListIcon from "@mui/icons-material/FilterList";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { useEffect, useMemo, useState } from "react";
import { readSource } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";
import { downloadBlob } from "../../features/export/export";
import type { ScalarValue } from "../../formats/pickle/patch";
import { PyFloat, PyGlobal, PyObject, isTuple, pyClassOf } from "../../formats/pickle/types";
import type { Span, SpanTracker } from "../../formats/pickle/unpickler";
import { loadSave, writeSave, type LoadedSave } from "../../formats/renpysave/save";
import { MONO } from "../theme";
import { useObjectUrl } from "./useObjectUrl";

type Edits = Map<Span, ScalarValue>;

const MAX_CHILDREN = 500;

export function SaveView({ node }: { node: TreeNode }) {
  const [save, setSave] = useState<LoadedSave | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Edits>(new Map());
  const [filter, setFilter] = useState("");
  const [showInternal, setShowInternal] = useState(false);

  useEffect(() => {
    readSource(node.source!)
      .then((b) => setSave(loadSave(b)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [node.source]);

  const rows = useMemo(() => {
    if (!save) return [];
    const q = filter.trim().toLowerCase();
    return [...save.root]
      .map(([name, value]) => ({ name, label: name.replace(/^store\./, ""), value }))
      .filter((r) => showInternal || !(r.label.startsWith("_") || /^(config|renpy|gui|build|style|persistent)\./.test(r.label)))
      .filter((r) => !q || r.label.toLowerCase().includes(q) || (isScalar(r.value) && String(display(r.value)).toLowerCase().includes(q)))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [save, filter, showInternal]);

  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  if (!save) return <CircularProgress sx={{ m: 3 }} />;

  const setEdit = (span: Span, value: ScalarValue | undefined) => {
    const next = new Map(edits);
    if (value === undefined) next.delete(span);
    else next.set(span, value);
    setEdits(next);
  };

  const download = () => {
    const out = writeSave(save, [...edits].map(([span, value]) => ({ span, value })));
    downloadBlob(new Blob([out as Uint8Array<ArrayBuffer>]), node.name);
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <SaveHeader save={save} />
      {save.signed && edits.size > 0 && (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          This save is signed. After editing, Ren'Py 8 will ask once to confirm loading it, as it does for saves from another computer.
        </Alert>
      )}
      <Box sx={{ px: 2, py: 1, display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap", borderBottom: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          placeholder="Filter variables"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          sx={{ flex: "1 1 200px" }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><FilterListIcon fontSize="small" /></InputAdornment> } }}
        />
        <FormControlLabel control={<Switch size="small" checked={showInternal} onChange={(e) => setShowInternal(e.target.checked)} />} label={<Typography variant="body2">Internal</Typography>} />
        <Typography variant="body2" color="text.secondary">
          {rows.length} variables{edits.size ? ` · ${edits.size} edited` : ""}
        </Typography>
        <Button size="small" startIcon={<RestartAltIcon />} disabled={!edits.size} onClick={() => setEdits(new Map())}>
          Reset
        </Button>
        <Button size="small" variant="contained" startIcon={<DownloadIcon />} disabled={!edits.size} onClick={download}>
          Download edited {save.kind === "persistent" ? "persistent" : "save"}
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", py: 0.5 }}>
        {rows.map((r) => (
          <VarRow key={r.name} label={r.label} value={r.value} container={save.rootContainer} keyInParent={r.name} depth={0} tracker={save.tracker} edits={edits} setEdit={setEdit} />
        ))}
      </Box>
    </Box>
  );
}

function SaveHeader({ save }: { save: LoadedSave }) {
  // Memoized: a new source object each render would re-trigger the object-URL effect forever.
  const shot = useMemo(() => (save.screenshot ? ({ type: "bytes", bytes: save.screenshot } as const) : undefined), [save.screenshot]);
  const { url } = useObjectUrl(shot, "image/png");
  const m = save.meta;
  if (save.kind === "persistent") {
    return (
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Persistent data</Typography>
        <Typography variant="body2" color="text.secondary">Values kept across playthroughs: unlocked endings, gallery, seen dialogue.</Typography>
      </Box>
    );
  }
  return (
    <Stack direction="row" spacing={2} sx={{ p: 2, borderBottom: 1, borderColor: "divider", alignItems: "center" }}>
      {url && <Box component="img" src={url} alt="Save screenshot" sx={{ height: 72, borderRadius: 1, border: 1, borderColor: "divider" }} />}
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }} noWrap>
          {m.saveName || "Untitled save"}
        </Typography>
        <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", mt: 0.5 }}>
          {m.created && <Chip size="small" label={m.created.toLocaleString()} />}
          {m.runtimeSeconds !== undefined && <Chip size="small" label={`Played ${formatDuration(m.runtimeSeconds)}`} />}
          {m.gameVersion && <Chip size="small" label={`Game ${m.gameVersion}`} />}
          {m.renpyVersion && <Chip size="small" variant="outlined" label={`Ren'Py ${m.renpyVersion}`} />}
        </Stack>
      </Box>
    </Stack>
  );
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(s % 60)}s`;
}

function isScalar(v: unknown): boolean {
  return v === null || ["string", "number", "bigint", "boolean"].includes(typeof v) || v instanceof PyFloat;
}

function display(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (v instanceof PyFloat) return String(v.value);
  return String(v);
}

function typeLabel(v: unknown): string {
  if (v === null || v === undefined) return "None";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "bigint") return "int";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  if (typeof v === "string") return "str";
  if (v instanceof Uint8Array) return "bytes";
  if (v instanceof PyGlobal) return "class";
  const cls = pyClassOf(v);
  if (cls) return cls.split(".").pop()!;
  if (isTuple(v)) return "tuple";
  if (Array.isArray(v)) return "list";
  if (v instanceof Map) return "dict";
  if (v instanceof Set) return "set";
  return typeof v;
}

function childrenOf(v: unknown): [string, unknown, unknown][] {
  // [label, value, key-in-container]
  if (Array.isArray(v)) return v.slice(0, MAX_CHILDREN).map((x, i) => [`[${i}]`, x, i]);
  if (v instanceof Map) return [...v].slice(0, MAX_CHILDREN).map(([k, x]) => [typeof k === "string" ? k : display(k), x, k]);
  if (v instanceof Set) return [...v].slice(0, MAX_CHILDREN).map((x, i) => [`{${i}}`, x, null]);
  if (v instanceof PyObject) {
    const out: [string, unknown, unknown][] = Object.entries(v.attrs).map(([k, x]) => [k, x, k]);
    v.items?.forEach((x, i) => out.push([`[${i}]`, x, null]));
    return out.slice(0, MAX_CHILDREN);
  }
  return [];
}

interface VarRowProps {
  label: string;
  value: unknown;
  container: unknown;
  keyInParent: unknown;
  depth: number;
  tracker: SpanTracker;
  edits: Edits;
  setEdit(span: Span, v: ScalarValue | undefined): void;
}

function VarRow({ label, value, container, keyInParent, depth, tracker, edits, setEdit }: VarRowProps) {
  const [open, setOpen] = useState(false);
  const span = tracker.get(container, keyInParent);
  const kids = isScalar(value) ? [] : childrenOf(value);
  const size = Array.isArray(value) || value instanceof Map || value instanceof Set ? (value instanceof Map || value instanceof Set ? value.size : value.length) : null;
  return (
    <>
      <Box sx={{ display: "flex", flexWrap: { xs: "wrap", sm: "nowrap" }, alignItems: "center", columnGap: 1, pl: `${8 + depth * 18}px`, pr: 2, py: { xs: 0.5, sm: 0 }, minHeight: 36, "&:hover": { bgcolor: "action.hover" } }}>
        <Box sx={{ width: 24, flexShrink: 0 }}>
          {kids.length > 0 && (
            <IconButton size="small" onClick={() => setOpen(!open)} aria-label={open ? "Collapse" : "Expand"}>
              {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          )}
        </Box>
        <Typography variant="body2" sx={{ fontFamily: MONO, fontSize: 13, minWidth: 0, flex: { xs: "1 1 0", sm: "0 1 260px" } }} noWrap title={label}>
          {label}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ width: 90, flexShrink: 0 }} noWrap>
          {typeLabel(value)}
          {size !== null ? ` (${size})` : ""}
        </Typography>
        <Box sx={{ flex: { xs: "1 1 100%", sm: 1 }, minWidth: 0, pl: { xs: 4, sm: 0 } }}>
          {isScalar(value) ? (
            <ScalarEditor label={label} value={value} span={span} edits={edits} setEdit={setEdit} />
          ) : (
            <Typography variant="body2" color="text.secondary" noWrap sx={{ fontFamily: MONO, fontSize: 12 }}>
              {preview(value)}
            </Typography>
          )}
        </Box>
      </Box>
      {open &&
        kids.map(([l, v, k], i) => (
          <VarRow key={i} label={l} value={v} container={value} keyInParent={k} depth={depth + 1} tracker={tracker} edits={edits} setEdit={setEdit} />
        ))}
    </>
  );
}

function preview(v: unknown): string {
  const kids = childrenOf(v).slice(0, 6);
  const body = kids.map(([l, x]) => (isScalar(x) ? (Array.isArray(v) ? display(x) : `${l}: ${display(x)}`) : Array.isArray(v) ? typeLabel(x) : `${l}: ${typeLabel(x)}`)).join(", ");
  return body ? `${body}${childrenOf(v).length > 6 ? ", …" : ""}` : "";
}

function ScalarEditor({ label, value, span, edits, setEdit }: { label: string; value: unknown; span: Span | undefined; edits: Edits; setEdit(span: Span, v: ScalarValue | undefined): void }) {
  const edited = span ? edits.get(span) : undefined;
  const current = edited !== undefined ? edited : value;
  const [text, setText] = useState(display(current));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setText(display(current)), [current]);

  if (!span || span.type === "none" || span.type === "bytes") {
    return (
      <Typography variant="body2" sx={{ fontFamily: MONO, fontSize: 13 }} color={span ? "text.primary" : "text.secondary"} title={span ? undefined : "Shared or computed value; not editable"}>
        {display(value)}
      </Typography>
    );
  }
  if (span.type === "bool") {
    return <Switch size="small" checked={current === true} onChange={(e) => setEdit(span, e.target.checked === value ? undefined : e.target.checked)} slotProps={{ input: { "aria-label": `Value of ${label}` } }} />;
  }
  const commit = () => {
    let parsed: ScalarValue;
    if (span.type === "int") {
      if (!/^-?\d+$/.test(text.trim())) return setInvalid(true);
      const big = BigInt(text.trim());
      parsed = big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big;
    } else if (span.type === "float") {
      const n = Number(text.trim());
      if (!text.trim() || !Number.isFinite(n)) return setInvalid(true);
      parsed = n;
    } else {
      parsed = text;
    }
    setInvalid(false);
    setEdit(span, parsed === value || (typeof parsed === "bigint" && parsed === value) ? undefined : parsed);
  };
  return (
    <TextField
      size="small"
      fullWidth
      variant="standard"
      value={text}
      error={invalid}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 13 }, inputMode: span.type === "str" || span.type === "py2str" ? "text" : "decimal", "aria-label": `Value of ${label}` } }}
      sx={edited !== undefined ? { "& input": { color: "primary.main", fontWeight: 600 } } : undefined}
    />
  );
}

