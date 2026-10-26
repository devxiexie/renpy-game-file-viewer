import {
  Alert, Box, Button, FormControlLabel, InputAdornment, LinearProgress, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import FileUploadOutlinedIcon from "@mui/icons-material/FileUploadOutlined";
import FilterListIcon from "@mui/icons-material/FilterList";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import TranslateIcon from "@mui/icons-material/Translate";
import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { encodeUtf8 } from "../../core/binary/text";
import { kindOf } from "../../core/files/types";
import { downloadBlob, zipToBlob } from "../../features/export/export";
import { generateTlFiles, isValidLanguageName, type Translations } from "../../features/translate/generate";
import { LANGUAGE_CODES, createMachineTranslator, machineTranslationSupported } from "../../features/translate/machine";
import type { TranslationProject } from "../../features/translate/model";
import { useApp } from "../../state/store";
import { engine } from "../../workers/client";
import { ToolHeader } from "./ToolHeader";

type Tab = "dialogue" | "strings";

interface Row {
  key: string;
  who: string | null;
  original: string;
  where: string;
}

function storageKey(game: string, lang: string) {
  return `rpv.tl.${game}.${lang}`;
}

function loadDraft(game: string, lang: string): Translations | null {
  try {
    const raw = localStorage.getItem(storageKey(game, lang));
    return raw ? (JSON.parse(raw) as Translations) : null;
  } catch {
    return null;
  }
}

function saveDraft(game: string, lang: string, t: Translations) {
  try {
    localStorage.setItem(storageKey(game, lang), JSON.stringify(t));
  } catch {
    /* quota or storage unavailable; the user can still save progress to a file */
  }
}

export function TranslateTool() {
  const tree = useApp((s) => s.tree);
  const expandArchive = useApp((s) => s.expandArchive);
  const game = tree.roots[0]?.name ?? "game";
  const [project, setProject] = useState<TranslationProject | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState("french");
  const [sourceCode, setSourceCode] = useState("en");
  const [targetCode, setTargetCode] = useState("fr");
  // Translations are tagged with the language they belong to, so switching languages
  // never saves one language's draft under another's name.
  const [state, setState] = useState<{ lang: string; t: Translations }>({ lang: "", t: { dialogue: {}, strings: {} } });
  const t = state.t;
  const setT = (u: Translations | ((prev: Translations) => Translations)) =>
    setState((s) => ({ ...s, t: typeof u === "function" ? u(s.t) : u }));
  const [tab, setTab] = useState<Tab>("dialogue");
  const [filter, setFilter] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [fillMissing, setFillMissing] = useState(true);
  const cancelRef = useRef(false);

  // Restore the draft for this game/language, falling back to translations shipped with the game.
  useEffect(() => {
    if (!project || !isValidLanguageName(language)) return;
    const draft = loadDraft(game, language);
    const shipped = project.existing[language];
    // Keep the current state if it already belongs to this language (e.g. just loaded from a file).
    setState((s) => (s.lang === language ? s : { lang: language, t: draft ?? { dialogue: { ...(shipped?.dialogue ?? {}) }, strings: { ...(shipped?.strings ?? {}) } } }));
  }, [project, language, game]);

  useEffect(() => {
    if (project && state.lang) saveDraft(game, state.lang, state.t);
  }, [state, project, game]);

  const scan = async () => {
    setError(null);
    try {
      const archives = [...tree.files()].filter((n) => n.archive && n.archive.status !== "ready");
      for (const [i, a] of archives.entries()) {
        setStatus(`Reading archive ${i + 1}/${archives.length}: ${a.name}`);
        await expandArchive(a.id);
      }
      const scripts = [...tree.files()].filter((n) => kindOf(n.name) === "rpyc").map((n) => ({ path: n.path, source: n.source! }));
      if (scripts.length === 0) throw new Error("No compiled scripts (.rpyc) found. Open the game folder or its archives first.");
      setStatus(`Extracting dialogue from ${scripts.length} scripts…`);
      setProject(await engine().extractTranslations(scripts));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
    }
  };

  const rows: Row[] = useMemo(() => {
    if (!project) return [];
    const q = filter.trim().toLowerCase();
    const list: Row[] =
      tab === "dialogue"
        ? project.dialogue.map((d) => ({ key: d.id, who: d.who, original: d.what, where: `${d.file}:${d.line}` }))
        : project.strings.map((s) => ({ key: s.text, who: null, original: s.text, where: `${s.file}:${s.line}` }));
    const map = tab === "dialogue" ? t.dialogue : t.strings;
    return list.filter(
      (r) =>
        (!onlyMissing || !map[r.key]) &&
        (!q || r.original.toLowerCase().includes(q) || (map[r.key] ?? "").toLowerCase().includes(q) || (r.who ?? "").toLowerCase().includes(q)),
    );
    // `t` is intentionally excluded so rows don't jump while typing; filter changes re-evaluate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, tab, filter, onlyMissing]);

  const done = project
    ? { d: project.dialogue.filter((d) => t.dialogue[d.id]).length, s: project.strings.filter((s) => t.strings[s.text]).length }
    : { d: 0, s: 0 };

  const setValue = (key: string, value: string) => {
    setT((prev) => {
      const map = { ...(tab === "dialogue" ? prev.dialogue : prev.strings) };
      if (value) map[key] = value;
      else delete map[key];
      return tab === "dialogue" ? { ...prev, dialogue: map } : { ...prev, strings: map };
    });
  };

  const machineTranslate = async () => {
    if (!project) return;
    setError(null);
    cancelRef.current = false;
    try {
      setStatus("Preparing the browser translator (it may download a language model)…");
      const translate = await createMachineTranslator(sourceCode, targetCode);
      const todo: { kind: Tab; key: string; text: string }[] = [
        ...project.dialogue.filter((d) => !t.dialogue[d.id] && d.what.trim()).map((d) => ({ kind: "dialogue" as const, key: d.id, text: d.what })),
        ...project.strings.filter((s) => !t.strings[s.text]).map((s) => ({ kind: "strings" as const, key: s.text, text: s.text })),
      ];
      let batch: Translations = { dialogue: {}, strings: {} };
      const flush = () => {
        const b = batch;
        batch = { dialogue: {}, strings: {} };
        setT((prev) => ({ dialogue: { ...prev.dialogue, ...b.dialogue }, strings: { ...prev.strings, ...b.strings } }));
      };
      for (let i = 0; i < todo.length && !cancelRef.current; i++) {
        const item = todo[i];
        batch[item.kind][item.key] = await translate(item.text);
        if (i % 20 === 19) {
          flush();
          setStatus(`Machine translating ${i + 1}/${todo.length}…`);
          setProgress((100 * (i + 1)) / todo.length);
        }
      }
      flush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      setProgress(null);
    }
  };

  const exportPatch = async () => {
    if (!project) return;
    try {
      const files = generateTlFiles(project, language, t, { fillMissing });
      const items = Object.entries(files).map(([path, text]) => ({ path, name: path.split("/").pop()!, source: { type: "bytes" as const, bytes: encodeUtf8(text) } }));
      downloadBlob(await zipToBlob(items), `${game}-${language}-translation.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveProgress = () => downloadBlob(new Blob([JSON.stringify({ game, language, ...t }, null, 1)], { type: "application/json" }), `${game}-${language}-progress.json`);
  const loadProgress = () => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text()) as Partial<Translations & { language: string }>;
        const lang = data.language && isValidLanguageName(data.language) ? data.language : language;
        setLanguage(lang);
        setState({ lang, t: { dialogue: data.dialogue ?? {}, strings: data.strings ?? {} } });
      } catch {
        setError("That file isn't a saved translation progress file.");
      }
    };
    input.click();
  };

  const langValid = isValidLanguageName(language);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ToolHeader title="Translation" subtitle="Translate dialogue and interface strings, then export a ready-to-install game/tl patch.">
        {project && (
          <>
            <Button size="small" startIcon={<FileUploadOutlinedIcon />} onClick={loadProgress}>Load progress</Button>
            <Button size="small" startIcon={<SaveOutlinedIcon />} onClick={saveProgress}>Save progress</Button>
            <Button size="small" variant="contained" startIcon={<DownloadIcon />} onClick={exportPatch} disabled={!langValid}>
              Download patch
            </Button>
          </>
        )}
      </ToolHeader>
      <Stack direction="row" sx={{ p: 2, gap: 1.5, flexWrap: "wrap", alignItems: "center", borderBottom: 1, borderColor: "divider" }}>
        <TextField
          size="small"
          label="Language folder"
          value={language}
          error={!langValid}
          helperText={langValid ? `game/tl/${language}/` : "Letters, digits and _ only"}
          onChange={(e) => {
            setLanguage(e.target.value);
            const code = LANGUAGE_CODES[e.target.value.toLowerCase()];
            if (code) setTargetCode(code);
          }}
          sx={{ width: 180 }}
        />
        <TextField size="small" label="From" value={sourceCode} onChange={(e) => setSourceCode(e.target.value)} sx={{ width: 80 }} helperText="code" />
        <TextField size="small" label="To" value={targetCode} onChange={(e) => setTargetCode(e.target.value)} sx={{ width: 80 }} helperText="code" />
        <FormControlLabel
          control={<Switch size="small" checked={fillMissing} onChange={(e) => setFillMissing(e.target.checked)} />}
          label={<Typography variant="body2">Keep original text for untranslated lines</Typography>}
        />
        {!project ? (
          <Button variant="contained" onClick={scan} disabled={!!status}>
            Scan scripts
          </Button>
        ) : (
          <Tooltip title={machineTranslationSupported() ? "Uses the translator built into your browser; nothing leaves your device." : "Not available in this browser (Chrome 138+ desktop)."}>
            <span>
              {status?.startsWith("Machine") ? (
                <Button color="warning" onClick={() => (cancelRef.current = true)}>Stop</Button>
              ) : (
                <Button startIcon={<TranslateIcon />} onClick={machineTranslate} disabled={!machineTranslationSupported() || !!status}>
                  Machine translate missing
                </Button>
              )}
            </span>
          </Tooltip>
        )}
      </Stack>
      {status && (
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">{status}</Typography>
          <LinearProgress variant={progress === null ? "indeterminate" : "determinate"} value={progress ?? 0} />
        </Box>
      )}
      {error && <Alert severity="error" sx={{ m: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {!project && !status && (
        <Typography color="text.secondary" sx={{ p: 3 }}>
          Scan reads every compiled script (.rpyc), including ones inside archives, and lists each line of dialogue with the same IDs Ren'Py's own "Generate Translations" uses.
          Existing translations in game/tl are picked up automatically.
        </Typography>
      )}
      {project && (
        <>
          {project.errors.length > 0 && <Alert severity="warning" sx={{ mx: 2, mt: 1 }}>{project.errors.length} scripts couldn't be read.</Alert>}
          {Object.keys(project.existing).length > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, pt: 1 }}>
              Translations shipped with the game: {Object.keys(project.existing).join(", ")}
            </Typography>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, flexWrap: "wrap", borderBottom: 1, borderColor: "divider" }}>
            <Tabs value={tab} onChange={(_, v: Tab) => setTab(v)} sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40 } }}>
              <Tab value="dialogue" label={`Dialogue ${done.d}/${project.dialogue.length}`} />
              <Tab value="strings" label={`Strings ${done.s}/${project.strings.length}`} />
            </Tabs>
            <TextField
              size="small"
              placeholder="Search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ flex: "1 1 180px" }}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><FilterListIcon fontSize="small" /></InputAdornment> } }}
            />
            <FormControlLabel control={<Switch size="small" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />} label={<Typography variant="body2">Untranslated only</Typography>} />
          </Box>
          <EntryTable rows={rows} values={tab === "dialogue" ? t.dialogue : t.strings} onChange={setValue} />
        </>
      )}
    </Box>
  );
}

function EntryTable({ rows, values, onChange }: { rows: Row[]; values: Record<string, string>; onChange(key: string, v: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => 64, overscan: 8, measureElement: (el) => el.getBoundingClientRect().height });
  return (
    <Box ref={ref} sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Box sx={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((item) => {
          const r = rows[item.index];
          return (
            <Box key={r.key} data-index={item.index} ref={v.measureElement} sx={{ position: "absolute", top: item.start, left: 0, right: 0 }}>
              <EntryRow row={r} value={values[r.key] ?? ""} onChange={onChange} />
            </Box>
          );
        })}
      </Box>
      {rows.length === 0 && <Typography color="text.secondary" sx={{ p: 3 }}>Nothing to show.</Typography>}
    </Box>
  );
}

const EntryRow = memo(function EntryRow({ row, value, onChange }: { row: Row; value: string; onChange(key: string, v: string): void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: { xs: 0.5, sm: 2 }, px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary">
          {row.who && <Box component="b" sx={{ color: "primary.main", mr: 1 }}>{row.who}</Box>}
          {row.where}
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {row.original}
        </Typography>
      </Box>
      <TextField
        size="small"
        multiline
        maxRows={6}
        placeholder="Translation"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onChange(row.key, text)}
        sx={{ flex: 1 }}
        slotProps={{ htmlInput: { "aria-label": `Translation of ${row.original.slice(0, 40)}` } }}
      />
    </Box>
  );
});
