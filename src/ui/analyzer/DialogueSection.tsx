import { Box, Button, Menu, MenuItem, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlined";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { dialogueLines, dialogueMatcher, screenplay, speakerId, type MatchOptions } from "../../features/analyzer/dialogue";
import { MONO } from "../theme";
import { ColorDot, LabelLink, SourceLink, useAnalyzer } from "./context";
import { Pager, SearchField, SelectField, StatCard, StatRow, Toolbar, usePaged } from "./ui";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Text with the matches of `re` wrapped in <mark>. */
function highlight(text: string, re: RegExp | null): ReactNode {
  if (!re) return text;
  const out: ReactNode[] = [];
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === "") {
      re.lastIndex++;
      continue;
    }
    out.push(text.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

export function DialogueSection() {
  const { index, selection, go } = useAnalyzer();
  const [query, setQuery] = useState(selection.search ?? "");
  const [opts, setOpts] = useState<MatchOptions>({ regex: false, caseSensitive: false, wholeWord: false });
  const [speaker, setSpeaker] = useState<string>(selection.character ?? "all");
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (selection.search !== undefined) setQuery(selection.search);
    if (selection.character !== undefined) setSpeaker(selection.character);
  }, [selection]);

  const lines = useMemo(() => dialogueLines(index), [index]);
  const chars = useMemo(() => new Map(index.characters.map((c) => [c.id, c])), [index]);
  const names = useMemo(() => new Map(index.characters.map((c) => [c.id, c.name ?? c.id])), [index]);

  const { re, error } = useMemo(() => {
    try {
      return { re: dialogueMatcher(query, opts), error: null };
    } catch (e) {
      return { re: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [query, opts]);
  const results = useMemo(() => {
    if (error) return [];
    return lines.filter((l) => {
      if (speaker !== "all" && speakerId(l.who) !== speaker) return false;
      if (!re) return true;
      re.lastIndex = 0;
      return re.test(l.plain);
    });
  }, [lines, re, error, speaker]);
  const paged = usePaged(results, 50);
  const speakers = useMemo(() => new Set(results.map((l) => speakerId(l.who))).size, [results]);
  const filtered = !!re || speaker !== "all";
  const title = index.game.name ?? "Script";

  const exportAs = (format: "md" | "txt", onlyResults: boolean) => {
    setExportAnchor(null);
    const text = screenplay(index, { format, title, names, only: onlyResults ? results : undefined });
    const base = title.replace(/[^\w-]+/g, "_").replace(/^_|_$/g, "") || "script";
    download(`${base}${onlyResults ? "-dialogue-search" : "-screenplay"}.${format}`, text, format === "md" ? "text/markdown" : "text/plain");
  };

  const speakerOptions = useMemo(
    () => [["all", "All speakers"] as const, ...index.characters.filter((c) => c.lines > 0).map((c) => [c.id, `${c.name ?? c.id} (${c.lines.toLocaleString()})`] as const)],
    [index],
  );

  return (
    <Box>
      <StatRow>
        <StatCard value={lines.length} label="Lines of dialogue" sub={`${index.totals.words.toLocaleString()} words`} />
        <StatCard value={results.length} label={filtered ? "Matching lines" : "Shown"} />
        <StatCard value={speakers} label="Speakers" />
        <StatCard value={new Set(results.map((r) => r.label)).size} label="Labels" />
      </StatRow>
      <Toolbar summary={error ? undefined : `${results.length.toLocaleString()} of ${lines.length.toLocaleString()} lines`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search dialogue" />
        <ToggleButtonGroup
          size="small"
          value={Object.entries(opts).filter(([, v]) => v).map(([k]) => k)}
          onChange={(_, v: string[]) => setOpts({ regex: v.includes("regex"), caseSensitive: v.includes("caseSensitive"), wholeWord: v.includes("wholeWord") })}
          aria-label="Search options"
        >
          <Tooltip title="Match case"><ToggleButton value="caseSensitive" aria-label="Match case" sx={{ fontFamily: MONO, px: 1.25 }}>Aa</ToggleButton></Tooltip>
          <Tooltip title="Whole word"><ToggleButton value="wholeWord" aria-label="Whole word" sx={{ fontFamily: MONO, px: 1.25, textDecoration: "underline" }}>ab</ToggleButton></Tooltip>
          <Tooltip title="Regular expression"><ToggleButton value="regex" aria-label="Regular expression" sx={{ fontFamily: MONO, px: 1.25 }}>.*</ToggleButton></Tooltip>
        </ToggleButtonGroup>
        <SelectField label="Speaker" value={speaker} onChange={setSpeaker} options={speakerOptions} />
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={(e) => setExportAnchor(e.currentTarget)}>Export screenplay</Button>
        <Menu anchorEl={exportAnchor} open={!!exportAnchor} onClose={() => setExportAnchor(null)}>
          <MenuItem onClick={() => exportAs("md", false)}>Whole script · Markdown</MenuItem>
          <MenuItem onClick={() => exportAs("txt", false)}>Whole script · Plain text</MenuItem>
          <MenuItem disabled={!filtered || !results.length} onClick={() => exportAs("md", true)}>Search results · Markdown</MenuItem>
          <MenuItem disabled={!filtered || !results.length} onClick={() => exportAs("txt", true)}>Search results · Plain text</MenuItem>
        </Menu>
      </Toolbar>
      {error && <Typography color="error" sx={{ mb: 2 }}>Invalid regular expression: {error}</Typography>}
      {!error && results.length === 0 && <Typography color="text.secondary">No dialogue matches.</Typography>}
      <Pager paged={paged as never} total={results.length} noun="lines" sizes={[50, 100, 250]} />
      <Paper variant="outlined" sx={{ overflow: "hidden" }}>
        {paged.slice.map((l, i) => {
          const id = speakerId(l.who);
          const c = chars.get(id);
          return (
            <Stack
              key={`${l.loc.fileId}:${l.loc.line}:${i}`}
              direction={{ xs: "column", sm: "row" }}
              sx={{ gap: { xs: 0.25, sm: 1.5 }, px: 1.75, py: 1, borderTop: i ? 1 : 0, borderColor: "divider", alignItems: { sm: "center" } }}
            >
              <Typography variant="body2" noWrap sx={{ width: { sm: 150 }, flexShrink: 0, fontWeight: 700 }} title={l.who ?? "narrator"}>
                <ColorDot color={c?.color ?? null} />
                {l.who ? (names.get(id) ?? id) : <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>Narrator</Box>}
              </Typography>
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, "& mark": { bgcolor: "warning.light", color: "inherit", borderRadius: 0.5, px: 0.25 } }}>{highlight(l.plain, re)}</Typography>
              <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexShrink: 0 }}>
                <Typography variant="caption" sx={{ fontFamily: MONO }}><LabelLink name={l.label} /></Typography>
                <SourceLink loc={l.loc} />
                <Button size="small" startIcon={<PlayCircleOutlineIcon />} onClick={() => go("story", { label: l.label, line: l.loc.line })} aria-label={`Play from line ${l.loc.line}`}>
                  Play
                </Button>
              </Stack>
            </Stack>
          );
        })}
      </Paper>
      <Pager paged={paged as never} total={results.length} noun="lines" sizes={[50, 100, 250]} />
    </Box>
  );
}
