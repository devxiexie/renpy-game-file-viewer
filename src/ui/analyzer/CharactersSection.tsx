import { Box, Chip, LinearProgress, Paper, Stack, Typography } from "@mui/material";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import NotesIcon from "@mui/icons-material/Notes";
import PortraitOutlinedIcon from "@mui/icons-material/PortraitOutlined";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CharacterInfo } from "../../features/analyzer/model";
import { MONO } from "../theme";
import { ColorDot, SourceLink, useAnalyzer } from "./context";
import { Portrait } from "./StageImage";
import { CardGrid, Initials, Pager, SearchField, SelectField, Toolbar, usePaged } from "./ui";

type Sort = "dialogue" | "words" | "sections" | "name";
type PortraitFilter = "all" | "with" | "without";

interface Stats {
  sections: number;
  choices: number;
  visuals: number;
  shares: [string, number][];
}

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", "& svg": { fontSize: 16, color: "text.secondary" } }}>
      {icon}
      <Typography variant="body2"><b>{value.toLocaleString()}</b> {label}</Typography>
    </Stack>
  );
}

export function CharactersSection() {
  const { index, selection, go } = useAnalyzer();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("dialogue");
  const [portrait, setPortrait] = useState<PortraitFilter>("all");
  useEffect(() => {
    if (selection.character) setQuery(index.characters.find((c) => c.id === selection.character)?.name ?? selection.character);
  }, [selection.character, index]);

  const stats = useMemo(() => {
    const labels = new Map(index.labels.map((l) => [l.name, l]));
    const byLabel = new Map<string, string[]>();
    for (const c of index.characters) for (const l of Object.keys(c.labels)) (byLabel.get(l) ?? byLabel.set(l, []).get(l)!).push(c.id);
    const out = new Map<string, Stats>();
    for (const c of index.characters) {
      const names = Object.keys(c.labels);
      const shared = new Map<string, number>();
      for (const l of names) for (const other of byLabel.get(l) ?? []) if (other !== c.id && other !== "narrator") shared.set(other, (shared.get(other) ?? 0) + 1);
      out.set(c.id, {
        sections: names.length,
        choices: names.reduce((n, l) => n + (labels.get(l)?.menus ?? 0), 0),
        visuals: names.reduce((n, l) => n + (labels.get(l)?.visuals ?? 0), 0),
        shares: [...shared].sort((a, b) => b[1] - a[1]),
      });
    }
    return out;
  }, [index]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = index.characters.filter(
      (c) =>
        (c.lines > 0 || c.defined) &&
        (!q || c.id.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q)) &&
        (portrait === "all" || (portrait === "with") === !!c.portrait),
    );
    const key: Record<Sort, (c: CharacterInfo) => number | string> = {
      dialogue: (c) => -c.lines,
      words: (c) => -c.words,
      sections: (c) => -(stats.get(c.id)?.sections ?? 0),
      name: (c) => (c.name ?? c.id).toLowerCase(),
    };
    return [...list].sort((a, b) => (key[sort](a) < key[sort](b) ? -1 : key[sort](a) > key[sort](b) ? 1 : 0));
  }, [index, query, sort, portrait, stats]);
  const paged = usePaged(items, 12);
  const links = items.reduce((n, c) => n + (stats.get(c.id)?.sections ?? 0), 0);
  const nameOf = (id: string) => index.characters.find((c) => c.id === id)?.name ?? id;

  return (
    <Box>
      <Toolbar summary={`${items.length} of ${index.characters.filter((c) => c.lines > 0 || c.defined).length} characters · ${links.toLocaleString()} story links`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search characters" />
        <SelectField label="Sort" value={sort} onChange={setSort} options={[["dialogue", "Most dialogue"], ["words", "Most words"], ["sections", "Most story sections"], ["name", "Name"]]} />
        <SelectField label="Portrait" value={portrait} onChange={setPortrait} options={[["all", "All characters"], ["with", "Portrait detected"], ["without", "No portrait"]]} />
      </Toolbar>
      <Pager paged={paged as never} total={items.length} noun="characters" sizes={[12, 24, 48]} />
      <CardGrid min={380}>
        {paged.slice.map((c) => {
          const s = stats.get(c.id)!;
          const story = Object.entries(c.labels).sort((a, b) => b[1] - a[1]);
          return (
            <Paper key={c.id} variant="outlined" sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Stack direction="row" spacing={2}>
                {c.portrait ? (
                  <Box sx={{ position: "relative", width: 110, height: 130, flexShrink: 0, borderRadius: 1.5, overflow: "hidden", bgcolor: "action.hover", cursor: "pointer" }} title={`Open ${c.portrait} in Visuals`} onClick={() => go("visuals", { image: c.portrait! })}>
                    <Portrait name={c.portrait} />
                  </Box>
                ) : (
                  <Initials name={c.name ?? c.id} size={110} />
                )}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="h6" noWrap sx={{ fontWeight: 800 }}><ColorDot color={c.color} />{c.name ?? c.id}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO }}>{c.id}{c.kind ? ` · ${c.kind}` : ""}{!c.defined && " · not a defined Character"}</Typography>
                    </Box>
                    {c.portrait && <Chip size="small" variant="outlined" icon={<PortraitOutlinedIcon />} label="Portrait" onClick={() => go("visuals", { image: c.portrait! })} />}
                    {c.lines > 0 && <Chip size="small" variant="outlined" label="Lines" onClick={() => go("dialogue", { character: c.id })} aria-label={`All lines of ${c.name ?? c.id}`} />}
                  </Stack>
                  <Stack direction="row" sx={{ justifyContent: "space-between", mt: 1 }}>
                    <Typography variant="caption">Dialogue share</Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>{(100 * c.share).toFixed(1)}%</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={Math.min(100, 100 * c.share)} sx={{ height: 5, borderRadius: 3, mb: 1 }} />
                  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.5 }}>
                    <Stat icon={<ChatBubbleOutlineIcon />} value={c.lines} label="dialogue" />
                    <Stat icon={<NotesIcon />} value={c.words} label="words" />
                    <Stat icon={<MenuBookOutlinedIcon />} value={s.sections} label="labels" />
                    <Stat icon={<CallSplitIcon />} value={s.choices} label="choices in scenes" />
                    <Stat icon={<ImageOutlinedIcon />} value={s.visuals} label="visuals in scenes" />
                    <Stat icon={<GroupsOutlinedIcon />} value={s.shares.length} label="connections" />
                  </Box>
                </Box>
              </Stack>
              {c.sample && (
                <Box sx={{ borderLeft: 3, borderColor: "primary.main", pl: 1.5, py: 0.5, bgcolor: "action.hover", borderRadius: 0.5 }}>
                  <Typography variant="body2" sx={{ fontStyle: "italic" }}>“{c.sample}”</Typography>
                </Box>
              )}
              {story.length > 0 && (
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>Story</Typography>
                  <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                    {story.slice(0, 3).map(([l, n]) => (
                      <Chip key={l} size="small" label={`${l} · ${n}`} onClick={() => go("story", { label: l })} sx={{ maxWidth: 220 }} />
                    ))}
                    {story.length > 3 && <Chip size="small" variant="outlined" label={`+${story.length - 3}`} onClick={() => go("story", { search: c.id })} />}
                  </Stack>
                </Box>
              )}
              {s.shares.length > 0 && (
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>Shares scenes with</Typography>
                  <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                    {s.shares.slice(0, 5).map(([id, n]) => (
                      <Chip key={id} size="small" variant="outlined" label={`${nameOf(id)} · ${n}`} onClick={() => setQuery(nameOf(id) ?? id)} />
                    ))}
                  </Stack>
                </Box>
              )}
              {c.loc && <Typography variant="caption" color="text.secondary">Defined at <SourceLink loc={c.loc} /></Typography>}
            </Paper>
          );
        })}
      </CardGrid>
      <Pager paged={paged as never} total={items.length} noun="characters" sizes={[12, 24, 48]} />
    </Box>
  );
}
