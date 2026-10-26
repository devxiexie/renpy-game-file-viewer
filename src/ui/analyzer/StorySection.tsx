import { Box, Button, ButtonGroup, Chip, Paper, Stack, Typography } from "@mui/material";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AltRouteIcon from "@mui/icons-material/AltRoute";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import ViewModuleOutlinedIcon from "@mui/icons-material/ViewModuleOutlined";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { LabelInfo } from "../../features/analyzer/model";
import { MONO } from "../theme";
import { SourceLink, useAnalyzer } from "./context";
import { FlowView } from "./FlowView";
import { LabelPlayer } from "./LabelPlayer";
import { RouteInspector } from "./RouteInspector";
import { CardGrid, Pager, SearchField, SelectField, Toolbar, usePaged } from "./ui";

type Content = "all" | "dialogue" | "choices" | "visuals" | "unreachable";
type Sort = "interesting" | "order" | "dialogue" | "choices";
type Mode = "cards" | "route" | "flow";

function Stat({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", "& svg": { fontSize: 15, color: "text.secondary" } }}>
      {icon}
      <Typography variant="caption"><b>{value.toLocaleString()}</b> {label}</Typography>
    </Stack>
  );
}

export function StorySection() {
  const { index, selection, go } = useAnalyzer();
  const [mode, setMode] = useState<Mode>(selection.story ?? "cards");
  const [playing, setPlaying] = useState<string | null>(selection.label ?? null);
  const [startLine, setStartLine] = useState<number | undefined>(selection.line);
  const [query, setQuery] = useState(selection.search ?? "");
  const [content, setContent] = useState<Content>("all");
  const [sort, setSort] = useState<Sort>("interesting");
  useEffect(() => {
    setPlaying(selection.label ?? null);
    setStartLine(selection.line);
    if (selection.story) setMode(selection.story);
    if (selection.search !== undefined) setQuery(selection.search);
  }, [selection]);

  const charactersByLabel = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of index.characters) for (const l of Object.keys(c.labels)) (m.get(l) ?? m.set(l, []).get(l)!).push(c.id);
    return m;
  }, [index]);
  const menuTargets = useMemo(() => new Set(index.menus.flatMap((m) => m.items.flatMap((i) => i.targets))), [index]);
  const colors = useMemo(() => new Map(index.characters.map((c) => [c.id, c.color])), [index]);
  const names = useMemo(() => new Map(index.characters.map((c) => [c.id, c.name ?? c.id])), [index]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = index.labels.filter((l) => {
      if (content === "dialogue" && l.dialogue === 0) return false;
      if (content === "choices" && l.menus === 0) return false;
      if (content === "visuals" && l.visuals === 0) return false;
      if (content === "unreachable" && l.reachable) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.loc.file.toLowerCase().includes(q) ||
        l.preview.some((p) => p.what.toLowerCase().includes(q)) ||
        (charactersByLabel.get(l.name) ?? []).some((c) => c.toLowerCase() === q || (names.get(c) ?? "").toLowerCase() === q)
      );
    });
    if (sort === "order") return list;
    const key: Record<Exclude<Sort, "order">, (l: LabelInfo) => number> = { interesting: (l) => l.score, dialogue: (l) => l.dialogue, choices: (l) => l.menus };
    return [...list].sort((a, b) => key[sort](b) - key[sort](a));
  }, [index, query, content, sort, charactersByLabel, names]);
  const paged = usePaged(items, 24);

  if (playing) return <LabelPlayer key={`${playing}:${startLine ?? ""}`} label={playing} line={startLine} onClose={() => (setPlaying(null), setStartLine(undefined))} />;

  return (
    <Box>
      <Toolbar summary={mode === "cards" ? `${items.length.toLocaleString()} of ${index.labels.length.toLocaleString()} labels` : undefined}>
        <ButtonGroup size="small" aria-label="Story view">
          <Button variant={mode === "cards" ? "contained" : "outlined"} startIcon={<ViewModuleOutlinedIcon />} onClick={() => setMode("cards")}>Labels</Button>
          <Button variant={mode === "route" ? "contained" : "outlined"} startIcon={<AltRouteIcon />} onClick={() => setMode("route")}>Route inspector</Button>
          <Button variant={mode === "flow" ? "contained" : "outlined"} startIcon={<AccountTreeOutlinedIcon />} onClick={() => setMode("flow")}>Flowchart</Button>
        </ButtonGroup>
        {mode === "cards" && (
          <>
            <SearchField value={query} onChange={setQuery} placeholder="Search story" />
            <SelectField label="Content" value={content} onChange={setContent} options={[["all", "All labels"], ["dialogue", "With dialogue"], ["choices", "With choices"], ["visuals", "With visuals"], ["unreachable", "Unreachable"]]} />
            <SelectField label="Sort" value={sort} onChange={setSort} options={[["interesting", "Most interesting"], ["order", "Story order"], ["dialogue", "Most dialogue"], ["choices", "Most choices"]]} />
          </>
        )}
      </Toolbar>

      {mode === "route" && <RouteInspector onPlay={setPlaying} />}
      {mode === "flow" && (
        <Paper variant="outlined" sx={{ height: { xs: 520, md: 680 }, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <FlowView onOpenLabel={setPlaying} />
        </Paper>
      )}
      {mode === "cards" && (
        <>
          <Pager paged={paged as never} total={items.length} noun="labels" sizes={[24, 48, 96]} />
          <CardGrid min={340}>
            {paged.slice.map((l) => {
              const out = index.edges.filter((e) => e.from === l.name);
              const chips = [...new Map(out.map((e) => [`${e.kind}:${e.to}`, e])).values()];
              return (
                <Paper key={l.name} variant="outlined" sx={{ p: 1.75, borderLeft: 3, borderLeftColor: "primary.main", display: "flex", flexDirection: "column", gap: 1 }}>
                  <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
                        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 800, fontFamily: MONO, fontSize: 15 }}>{l.name}</Typography>
                        {l.entry && <Chip size="small" color="primary" label="Entry point" sx={{ height: 20 }} />}
                        {menuTargets.has(l.name) && <Chip size="small" variant="outlined" label="Menu entry" sx={{ height: 20 }} />}
                        {!l.reachable && <Chip size="small" color="warning" variant="outlined" label="Unreachable" sx={{ height: 20 }} />}
                      </Stack>
                      <SourceLink loc={l.loc} />
                    </Box>
                    <Button size="small" endIcon={<ChevronRightIcon />} onClick={() => setPlaying(l.name)} aria-label={`Explore ${l.name}`}>Explore</Button>
                  </Stack>
                  {l.preview.length > 0 && (
                    <Box sx={{ borderLeft: 2, borderColor: "divider", pl: 1 }}>
                      {l.preview.map((p, i) => (
                        <Typography key={i} variant="body2" noWrap>
                          {p.who && <Box component="b" sx={{ color: colors.get(p.who) ?? "primary.main", mr: 0.5 }}>{names.get(p.who) ?? p.who}:</Box>}
                          {p.what}
                        </Typography>
                      ))}
                    </Box>
                  )}
                  <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap" }}>
                    <Stat icon={<ChatBubbleOutlineIcon />} value={l.dialogue} label="dialogue" />
                    <Stat icon={<CallSplitIcon />} value={l.menus} label="choices" />
                    <Stat icon={<GroupsOutlinedIcon />} value={(charactersByLabel.get(l.name) ?? []).length} label="characters" />
                    <Stat icon={<ImageOutlinedIcon />} value={l.visuals} label="visuals" />
                  </Stack>
                  {chips.length > 0 && (
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                      {chips.slice(0, 3).map((e) => (
                        <Chip
                          key={`${e.kind}:${e.to}`}
                          size="small"
                          variant="outlined"
                          label={e.dynamic ? `${e.kind} expression` : e.kind === "call" ? `call ${e.to}` : e.kind === "fallthrough" ? `↓ ${e.to}` : `→ ${e.to}`}
                          onClick={e.dynamic ? undefined : () => go("story", { label: e.to })}
                          sx={{ maxWidth: 240, fontFamily: MONO, fontSize: 11.5 }}
                        />
                      ))}
                      {chips.length > 3 && <Chip size="small" label={`+${chips.length - 3}`} />}
                    </Stack>
                  )}
                </Paper>
              );
            })}
          </CardGrid>
          <Pager paged={paged as never} total={items.length} noun="labels" sizes={[24, 48, 96]} />
        </>
      )}
    </Box>
  );
}
