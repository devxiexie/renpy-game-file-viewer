import { SearchQuery } from "@codemirror/search";
import { EditorSelection, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { Box, IconButton, InputBase, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import SearchIcon from "@mui/icons-material/Search";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MONO } from "../theme";

/**
 * Find-in-file for the code viewer. The browser's Ctrl+F can't see lines CodeMirror hasn't
 * rendered, so this takes over Ctrl/Cmd+F while a file is open and searches the whole text,
 * with match case / whole word / regex, a match count and markers beside the scrollbar.
 */

interface Range {
  from: number;
  to: number;
}

const MAX_MATCHES = 50_000;

const setMatches = StateEffect.define<Range[]>();
const setCurrent = StateEffect.define<Range | null>();

const matchMark = Decoration.mark({ class: "cm-find-match" });
const currentMark = Decoration.mark({ class: "cm-find-current" });

const matchesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setMatches)) return Decoration.set(e.value.map((r) => matchMark.range(r.from, r.to)));
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

const currentField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) if (e.is(setCurrent)) return e.value ? Decoration.set([currentMark.range(e.value.from, e.value.to)]) : Decoration.none;
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const findExtension: Extension = [
  matchesField,
  currentField,
  // Keep revealed matches clear of the floating bar.
  EditorView.scrollMargins.of(() => ({ top: 48 })),
  EditorView.baseTheme({
    ".cm-find-match": { backgroundColor: "rgba(255, 196, 0, 0.35)", borderRadius: "2px" },
    ".cm-find-current": { backgroundColor: "rgba(255, 120, 0, 0.85)", color: "#000", borderRadius: "2px", boxShadow: "0 0 0 1px rgba(255, 120, 0, 0.9)" },
  }),
];

interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

// Remembered across files, like an editor's find widget.
let lastQuery = "";
let lastOptions: FindOptions = { caseSensitive: false, wholeWord: false, regex: false };

function findAll(view: EditorView, query: string, opts: FindOptions): { matches: Range[]; capped: boolean; valid: boolean } {
  const q = new SearchQuery({ search: query, caseSensitive: opts.caseSensitive, wholeWord: opts.wholeWord, regexp: opts.regex, literal: true });
  if (!q.valid) return { matches: [], capped: false, valid: false };
  const matches: Range[] = [];
  const cursor = q.getCursor(view.state);
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    if (r.value.to > r.value.from) matches.push({ from: r.value.from, to: r.value.to });
    if (matches.length >= MAX_MATCHES) return { matches, capped: true, valid: true };
  }
  return { matches, capped: false, valid: true };
}

const visible = (view: EditorView) => view.dom.getClientRects().length > 0;

export function FindBar({ view, text }: { view: EditorView | null; text: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(lastQuery);
  const [opts, setOpts] = useState<FindOptions>(lastOptions);
  const [result, setResult] = useState<{ matches: Range[]; capped: boolean; valid: boolean }>({ matches: [], capped: false, valid: true });
  const [current, setCurrentIndex] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  // Where the search starts from: the cursor when the bar opened, then the last visited match.
  const anchor = useRef(0);
  // The match the bar last selected, so reopening doesn't replace the query with it.
  const selected = useRef<Range | null>(null);

  const focusInput = () =>
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });

  const openBar = useCallback(() => {
    if (!view) return;
    const sel = view.state.selection.main;
    const picked = view.state.sliceDoc(sel.from, sel.to);
    const own = selected.current?.from === sel.from && selected.current.to === sel.to;
    if (picked && !own && !picked.includes("\n") && picked.length < 200) setQuery(opts.regex ? picked.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : picked);
    anchor.current = sel.from;
    setOpen(true);
    focusInput();
  }, [view, opts.regex]);

  const close = useCallback(() => {
    setOpen(false);
    view?.focus();
  }, [view]);

  // Ctrl/Cmd+F anywhere on the page opens this bar instead of the browser's.
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      if (!visible(view) || e.altKey) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && key === "f") {
        e.preventDefault();
        openBar();
      } else if (open && (e.key === "F3" || (mod && key === "g"))) {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      } else if (open && e.key === "Escape" && view.dom.contains(document.activeElement)) {
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Search the whole document as the query changes (debounced for big files).
  useEffect(() => {
    lastQuery = query;
    lastOptions = opts;
    if (!view) return;
    if (!open || !query) {
      setResult({ matches: [], capped: false, valid: true });
      setCurrentIndex(-1);
      view.dispatch({ effects: [setMatches.of([]), setCurrent.of(null)] });
      return;
    }
    const t = setTimeout(() => {
      const r = findAll(view, query, opts);
      setResult(r);
      view.dispatch({ effects: setMatches.of(r.matches) });
      const i = r.matches.findIndex((m) => m.from >= anchor.current);
      reveal(r.matches, r.matches.length ? (i < 0 ? 0 : i) : -1);
    }, text.length > 1_000_000 ? 250 : 60);
    return () => clearTimeout(t);
  }, [view, open, query, opts.caseSensitive, opts.wholeWord, opts.regex, text]);

  function reveal(matches: Range[], i: number) {
    setCurrentIndex(i);
    if (!view) return;
    const m = matches[i];
    selected.current = m ?? null;
    if (!m) return void view.dispatch({ effects: setCurrent.of(null) });
    view.dispatch({ selection: EditorSelection.single(m.from, m.to), effects: [setCurrent.of(m), EditorView.scrollIntoView(m.from, { y: "center" })] });
  }

  function step(dir: 1 | -1) {
    const n = result.matches.length;
    if (!n) return;
    const i = current < 0 ? 0 : (current + dir + n) % n;
    anchor.current = result.matches[i].from;
    reveal(result.matches, i);
  }

  // Match positions beside the scrollbar, one tick per distinct pixel row.
  const ticks = useMemo(() => {
    if (!view || !open || !result.matches.length) return [];
    const doc = view.state.doc;
    const seen = new Set<number>();
    for (const m of result.matches) seen.add(Math.round(((doc.lineAt(m.from).number - 1) / Math.max(1, doc.lines)) * 1000) / 10);
    return [...seen];
  }, [view, open, result]);

  const count = !query
    ? ""
    : !result.valid
      ? "Invalid regex"
      : result.matches.length
        ? `${current + 1} of ${result.matches.length.toLocaleString()}${result.capped ? "+" : ""}`
        : "No results";

  if (!open) {
    return (
      <Tooltip title="Find in file (Ctrl+F)">
        <IconButton
          aria-label="Find in file"
          size="small"
          onClick={openBar}
          sx={{ position: "absolute", top: 6, right: 20, zIndex: 5, bgcolor: "background.paper", boxShadow: 1, opacity: 0.85, "&:hover": { opacity: 1, bgcolor: "background.paper" } }}
        >
          <SearchIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    );
  }

  const optionSx = { fontFamily: MONO, fontSize: 12, px: 0.9, py: 0.25, lineHeight: 1.4 };
  return (
    <>
      <Box
        role="search"
        aria-label="Find in file"
        sx={{
          // Floats over the code on wide screens, takes its own row on phones.
          position: { xs: "static", sm: "absolute" },
          top: 6,
          right: 20,
          m: { xs: 0.75, sm: 0 },
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          pl: 1,
          pr: 0.5,
          py: 0.5,
          bgcolor: "background.paper",
          border: 1,
          borderColor: "divider",
          borderRadius: 1.5,
          boxShadow: 4,
          width: { sm: 470 },
        }}
      >
        <InputBase
          inputRef={input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in file"
          inputProps={{ "aria-label": "Find in file", spellCheck: false }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
          sx={{ flex: 1, minWidth: 60, fontFamily: MONO, fontSize: 13, ...(query && !result.valid ? { color: "error.main" } : {}) }}
        />
        <Typography variant="caption" color={query && (!result.valid || !result.matches.length) ? "error" : "text.secondary"} noWrap sx={{ minWidth: 56, textAlign: "right" }} aria-live="polite">
          {count}
        </Typography>
        <ToggleButtonGroup
          size="small"
          value={Object.entries(opts).filter(([, v]) => v).map(([k]) => k)}
          onChange={(_, v: string[]) => {
            setOpts({ regex: v.includes("regex"), caseSensitive: v.includes("caseSensitive"), wholeWord: v.includes("wholeWord") });
            input.current?.focus();
          }}
          aria-label="Find options"
        >
          <Tooltip title="Match case"><ToggleButton value="caseSensitive" aria-label="Match case" sx={optionSx}>Aa</ToggleButton></Tooltip>
          <Tooltip title="Whole word"><ToggleButton value="wholeWord" aria-label="Whole word" sx={{ ...optionSx, textDecoration: "underline" }}>ab</ToggleButton></Tooltip>
          <Tooltip title="Regular expression"><ToggleButton value="regex" aria-label="Regular expression" sx={optionSx}>.*</ToggleButton></Tooltip>
        </ToggleButtonGroup>
        <Tooltip title="Previous match (Shift+Enter)">
          <span>
            <IconButton size="small" aria-label="Previous match" disabled={!result.matches.length} onClick={() => step(-1)}>
              <KeyboardArrowUpIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Next match (Enter)">
          <span>
            <IconButton size="small" aria-label="Next match" disabled={!result.matches.length} onClick={() => step(1)}>
              <KeyboardArrowDownIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Close (Esc)">
          <IconButton size="small" aria-label="Close find" onClick={close}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      {ticks.length > 0 && (
        <Box aria-hidden sx={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 6, zIndex: 4, pointerEvents: "none" }}>
          {ticks.map((t) => (
            <Box key={t} sx={{ position: "absolute", top: `${t}%`, left: 0, right: 0, height: 2, bgcolor: "warning.main" }} />
          ))}
        </Box>
      )}
    </>
  );
}
