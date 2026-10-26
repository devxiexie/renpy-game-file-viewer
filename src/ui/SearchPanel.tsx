import { Alert, Box, Button, Checkbox, FormControlLabel, LinearProgress, List, ListItemButton, ListSubheader, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useMemo, useState } from "react";
import { useApp } from "../state/store";
import { Comlink, engine } from "../workers/client";
import type { SearchHit, SearchResult } from "../workers/engine";
import { MONO } from "./theme";

export function SearchPanel() {
  const tree = useApp((s) => s.tree);
  const revealLine = useApp((s) => s.revealLine);
  const [query, setQuery] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [preferSource, setPreferSource] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!query) return;
    setError(null);
    setResult(null);
    if (regex) {
      try {
        new RegExp(query);
      } catch (e) {
        setError(`Invalid regular expression: ${(e as Error).message}`);
        return;
      }
    }
    const files = [...tree.files()].map((f) => ({ id: f.id, path: f.path, name: f.name, source: f.source! }));
    setProgress({ done: 0, total: files.length });
    try {
      const r = await engine().search(
        files,
        query,
        { regex, caseSensitive, wholeWord, preferSource, maxResults: 5000 },
        Comlink.proxy((done: number, total: number) => setProgress({ done, total })),
      );
      setResult(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress(null);
    }
  };

  const groups = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of result?.hits ?? []) (m.get(h.fileId) ?? m.set(h.fileId, []).get(h.fileId)!).push(h);
    return [...m];
  }, [result]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <Box component="form" onSubmit={(e) => (e.preventDefault(), void run())} sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField size="small" fullWidth placeholder="Search scripts and text files" value={query} onChange={(e) => setQuery(e.target.value)} slotProps={{ htmlInput: { style: { fontFamily: regex ? MONO : undefined } } }} />
          <Button type="submit" variant="contained" disabled={!query || !!progress} aria-label="Search">
            <SearchIcon fontSize="small" />
          </Button>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", "& .MuiFormControlLabel-label": { fontSize: 12 } }}>
          <FormControlLabel control={<Checkbox size="small" checked={regex} onChange={(e) => setRegex(e.target.checked)} />} label="Regex" />
          <FormControlLabel control={<Checkbox size="small" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />} label="Match case" />
          <FormControlLabel control={<Checkbox size="small" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />} label="Whole word" />
          <FormControlLabel control={<Checkbox size="small" checked={preferSource} onChange={(e) => setPreferSource(e.target.checked)} />} label="Skip .rpyc with .rpy" />
        </Box>
      </Box>
      {progress && <LinearProgress variant={progress.total ? "determinate" : "indeterminate"} value={progress.total ? (100 * progress.done) / progress.total : 0} />}
      {error && <Alert severity="error" sx={{ m: 1 }}>{error}</Alert>}
      {result && (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, py: 0.5 }}>
          {result.hits.length.toLocaleString()} match{result.hits.length === 1 ? "" : "es"} in {groups.length} file{groups.length === 1 ? "" : "s"} ({result.filesSearched} searched)
          {result.truncated && " · results truncated"}
          {result.errors.length > 0 && ` · ${result.errors.length} unreadable`}
        </Typography>
      )}
      <List dense disablePadding sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {groups.map(([fileId, hits]) => (
          <li key={fileId}>
            <ul style={{ padding: 0 }}>
              <ListSubheader sx={{ lineHeight: "28px", fontSize: 12, fontWeight: 700 }}>
                {hits[0].path} <Typography component="span" variant="caption" color="text.secondary">({hits.length})</Typography>
              </ListSubheader>
              {hits.slice(0, 200).map((h, i) => (
                <ListItemButton key={i} onClick={() => revealLine({ fileId: h.fileId, line: h.line, column: h.column, length: h.length })} sx={{ py: 0.25, alignItems: "baseline", gap: 1 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ minWidth: 36, textAlign: "right", fontFamily: MONO }}>
                    {h.line}
                  </Typography>
                  <Typography variant="body2" noWrap sx={{ fontFamily: MONO, fontSize: 12 }}>
                    {h.text.slice(0, h.column).trimStart()}
                    <Box component="mark" sx={{ bgcolor: "warning.light", color: "inherit", borderRadius: 0.5 }}>
                      {h.text.slice(h.column, h.column + h.length)}
                    </Box>
                    {h.text.slice(h.column + h.length)}
                  </Typography>
                </ListItemButton>
              ))}
            </ul>
          </li>
        ))}
      </List>
    </Box>
  );
}
