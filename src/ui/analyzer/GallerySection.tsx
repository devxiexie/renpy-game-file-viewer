import { Alert, Box, Button, ButtonGroup, Chip, Collapse, Paper, Stack, Typography } from "@mui/material";
import CollectionsOutlinedIcon from "@mui/icons-material/CollectionsOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import { useMemo, useState } from "react";
import { routeFromTree, routeTree, type RouteTree } from "../../features/analyzer/guide";
import type { GalleryButton, ImageUse, VariableInfo } from "../../features/analyzer/model";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer } from "./context";
import { RouteRequirements, RouteSteps } from "./RouteView";
import { StageImage } from "./StageImage";
import { CardGrid, Pager, SearchField, StatCard, StatRow, Toolbar, usePaged } from "./ui";

type View = "cgs" | "gallery" | "flags";

const CG_RE = /^(cg|cgs|ev|evt|event|h|scene|special|gallery|extra)\b|(^|[\s_])(cg|ev|event)\d*([\s_]|$)/i;

interface ShownImage {
  name: string;
  uses: ImageUse[];
  labels: string[];
  /** Use reachable with the fewest decisions. */
  first: ImageUse | null;
  firstDepth: number | null;
  buttons: GalleryButton[];
}

function shownImages(uses: ImageUse[], buttons: GalleryButton[], tree: RouteTree, all: boolean): ShownImage[] {
  const by = new Map<string, ImageUse[]>();
  for (const u of uses) {
    if (u.statement === "hide" || !u.label) continue;
    if (!(all ? u.statement === "scene" && !/^(bg|black|white|solid)\b/i.test(u.image) : CG_RE.test(u.image))) continue;
    (by.get(u.image) ?? by.set(u.image, []).get(u.image)!).push(u);
  }
  return [...by].map(([name, list]) => {
    let first: ImageUse | null = null;
    let firstDepth: number | null = null;
    for (const u of list) {
      const d = tree.dist.get(u.label!);
      if (d !== undefined && (firstDepth === null || d < firstDepth)) (first = u), (firstDepth = d);
    }
    return {
      name,
      uses: list,
      labels: [...new Set(list.map((u) => u.label!))],
      first: first ?? list[0],
      firstDepth,
      buttons: buttons.filter((b) => b.images.some((im) => im.includes(name)) || b.unlockImages.includes(name)),
    };
  });
}

export function GallerySection() {
  const { index } = useAnalyzer();
  const gallery = index.gallery ?? { buttons: [], replays: [], persistentInScreens: {} };
  const tree = useMemo(() => routeTree(index), [index]);
  const cgs = useMemo(() => shownImages(index.imageUses, gallery.buttons, tree, false), [index, gallery, tree]);
  const scenes = useMemo(() => shownImages(index.imageUses, gallery.buttons, tree, true), [index, gallery, tree]);
  const flags = useMemo(() => index.variables.filter((v) => v.name.startsWith("persistent.")), [index]);
  const [view, setView] = useState<View>(gallery.buttons.length || gallery.replays.length ? "gallery" : "cgs");
  const [all, setAll] = useState(cgs.length === 0);

  return (
    <Box>
      <StatRow>
        <StatCard value={cgs.length} label="CG / event images" active={view === "cgs"} onClick={() => setView("cgs")} />
        <StatCard value={gallery.buttons.length} label="Gallery entries" sub="from Gallery() in the code" active={view === "gallery"} onClick={() => setView("gallery")} />
        <StatCard value={gallery.replays.length} label="Replay scenes" active={view === "gallery"} onClick={() => setView("gallery")} />
        <StatCard value={flags.length} label="Unlock flags" sub="persistent variables" active={view === "flags"} onClick={() => setView("flags")} />
      </StatRow>
      <Toolbar>
        <ButtonGroup size="small" aria-label="Gallery view">
          <Button variant={view === "cgs" ? "contained" : "outlined"} startIcon={<CollectionsOutlinedIcon />} onClick={() => setView("cgs")}>CG unlock guide</Button>
          <Button variant={view === "gallery" ? "contained" : "outlined"} startIcon={<ReplayIcon />} onClick={() => setView("gallery")}>Gallery & replays</Button>
          <Button variant={view === "flags" ? "contained" : "outlined"} startIcon={<LockOpenOutlinedIcon />} onClick={() => setView("flags")}>Unlock flags</Button>
        </ButtonGroup>
      </Toolbar>
      {view === "cgs" && <CgGuide items={all ? scenes : cgs} all={all} setAll={setAll} tree={tree} hasCgs={cgs.length > 0} />}
      {view === "gallery" && <GalleryView tree={tree} />}
      {view === "flags" && <Flags flags={flags} screens={gallery.persistentInScreens} />}
    </Box>
  );
}

function CgGuide({ items, all, setAll, tree, hasCgs }: { items: ShownImage[]; all: boolean; setAll(v: boolean): void; tree: RouteTree; hasCgs: boolean }) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => !q || i.name.toLowerCase().includes(q) || i.labels.some((l) => l.toLowerCase().includes(q)))
      .sort((a, b) => (a.firstDepth ?? Infinity) - (b.firstDepth ?? Infinity) || a.name.localeCompare(b.name));
  }, [items, query]);
  const paged = usePaged(list, 24);
  return (
    <>
      <Toolbar summary={`${list.length} image${list.length === 1 ? "" : "s"}`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search images or labels" />
        <ButtonGroup size="small">
          <Button variant={!all ? "contained" : "outlined"} onClick={() => setAll(false)} disabled={!hasCgs}>CG / event images</Button>
          <Button variant={all ? "contained" : "outlined"} onClick={() => setAll(true)}>All scene images</Button>
        </ButtonGroup>
      </Toolbar>
      {!hasCgs && !all && <Alert severity="info" sx={{ mb: 2 }}>No images named like CGs (cg…, event…) were found. “All scene images” lists every full-screen image shown with <code>scene</code>.</Alert>}
      {list.length === 0 && <Typography color="text.secondary">Nothing to show.</Typography>}
      <CardGrid min={300}>
        {paged.slice.map((i) => (
          <CgCard key={i.name} item={i} tree={tree} />
        ))}
      </CardGrid>
      <Pager paged={paged as never} total={list.length} noun="images" sizes={[24, 48, 96]} />
    </>
  );
}

function CgCard({ item, tree }: { item: ShownImage; tree: RouteTree }) {
  const { go } = useAnalyzer();
  const [open, setOpen] = useState(false);
  const route = useMemo(() => (open && item.first?.label ? routeFromTree(tree, item.first.label) : null), [open, item, tree]);
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <Box onClick={() => go("visuals", { image: item.name })} title={`Open ${item.name} in Visuals`} sx={{ position: "relative", aspectRatio: "16 / 9", bgcolor: "#111", cursor: "pointer" }}>
        <StageImage name={item.name} fit="cover" />
      </Box>
      <Box sx={{ p: 1.25, flex: 1 }}>
        <Typography sx={{ fontWeight: 700, fontFamily: MONO, fontSize: 14 }} noWrap title={item.name}>{item.name}</Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          Shown in {item.labels.slice(0, 3).map((l, i) => <span key={l}>{i > 0 && ", "}<LabelLink name={l} /></span>)}
          {item.labels.length > 3 && ` +${item.labels.length - 3}`}
        </Typography>
        <Typography variant="caption" component="div">
          {item.firstDepth === null ? "Not reachable from the start statically" : item.firstDepth === 0 ? "Seen on the main path, no decisions needed" : `First seen after ${item.firstDepth} decision${item.firstDepth === 1 ? "" : "s"}`}
        </Typography>
        {item.buttons.length > 0 && (
          <Stack direction="row" sx={{ gap: 0.5, mt: 0.5, flexWrap: "wrap" }}>
            {item.buttons.map((b) => <Chip key={b.name} size="small" variant="outlined" icon={<CollectionsOutlinedIcon />} label={`Gallery: ${b.name}`} />)}
          </Stack>
        )}
      </Box>
      <Stack direction="row" sx={{ px: 1, pb: 1, gap: 1 }}>
        {item.first?.label && (
          <Button size="small" startIcon={<PlayCircleOutlineIcon />} onClick={() => go("story", { label: item.first!.label!, line: item.first!.loc.line })}>Play scene</Button>
        )}
        <Button size="small" sx={{ ml: "auto" }} disabled={item.firstDepth === null} endIcon={<ExpandMoreIcon sx={{ transform: open ? "rotate(180deg)" : undefined }} />} onClick={() => setOpen(!open)}>
          How to unlock
        </Button>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1.5, pb: 1.5, borderTop: 1, borderColor: "divider", pt: 1 }}>
          {route && item.first?.label && (
            <>
              <RouteSteps route={route} target={item.first.label} />
              <RouteRequirements route={route} />
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
                Then the image is shown at <SourceLink loc={item.first.loc} />.
              </Typography>
            </>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

function GalleryView({ tree }: { tree: RouteTree }) {
  const { index, go } = useAnalyzer();
  const gallery = index.gallery ?? { buttons: [], replays: [], persistentInScreens: {} };
  const writers = (code: string) => {
    const vars = index.variables.filter((v) => new RegExp(`(?<![\\w.])${v.name.replace(/\./g, "\\.")}(?!\\w)`).test(code));
    return vars.flatMap((v) => v.refs.filter((r) => r.kind === "write" && r.label).map((r) => ({ v, r })));
  };
  if (!gallery.buttons.length && !gallery.replays.length) {
    return (
      <Alert severity="info">
        This game doesn't define a Ren'Py <code>Gallery()</code> or <code>Replay()</code> scenes. Use the CG unlock guide to see where every event image appears, and Unlock flags for
        custom gallery systems built on persistent variables.
      </Alert>
    );
  }
  return (
    <Stack spacing={3}>
      {gallery.buttons.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>Gallery entries</Typography>
          <CardGrid min={300}>
            {gallery.buttons.map((b, i) => {
              const thumb = b.thumbnail ?? b.images[0]?.[0] ?? null;
              const conds = b.conditions.flatMap((c) => writers(c));
              const seenAt = b.unlockImages.flatMap((img) => index.imageUses.filter((u) => u.image === img && u.statement !== "hide" && u.label));
              return (
                <Paper key={`${b.gallery}:${b.name}:${i}`} variant="outlined" sx={{ overflow: "hidden" }}>
                  <Box sx={{ position: "relative", aspectRatio: "16 / 9", bgcolor: "#111" }}>{thumb && <StageImage name={thumb} fit="cover" />}</Box>
                  <Box sx={{ p: 1.25 }}>
                    <Typography sx={{ fontWeight: 800 }}>{b.name}</Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {b.gallery}.button · {b.images.length} image{b.images.length === 1 ? "" : "s"} · <SourceLink loc={b.loc} />
                    </Typography>
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", my: 0.75 }}>
                      {b.images.map((im, j) => <Chip key={j} size="small" variant="outlined" label={im.join(" + ")} onClick={() => go("visuals", { image: im[0] })} />)}
                    </Stack>
                    <Typography variant="subtitle2">Unlocks when</Typography>
                    {b.conditions.length === 0 && b.unlockImages.length === 0 && <Typography variant="caption" color="text.secondary">Always unlocked.</Typography>}
                    {b.conditions.map((c) => (
                      <Typography key={c} variant="caption" component="div"><code>{c}</code> is true</Typography>
                    ))}
                    {conds.length > 0 && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        Set in {[...new Set(conds.map((x) => x.r.label!))].map((l, k) => <span key={l}>{k > 0 && ", "}<LabelLink name={l} /></span>)}
                      </Typography>
                    )}
                    {b.unlockImages.length > 0 && (
                      <Typography variant="caption" component="div">
                        The player has seen {b.unlockImages.map((im) => <code key={im}>{im} </code>)}
                        {seenAt.length > 0 && <> — shown in {[...new Set(seenAt.map((u) => u.label!))].map((l, k) => <span key={l}>{k > 0 && ", "}<LabelLink name={l} /></span>)}</>}
                      </Typography>
                    )}
                  </Box>
                </Paper>
              );
            })}
          </CardGrid>
        </Box>
      )}
      {gallery.replays.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>Replay scenes</Typography>
          <Stack spacing={1}>
            {gallery.replays.map((r) => {
              const route = routeFromTree(tree, r.label);
              const l = index.labels.find((x) => x.name === r.label);
              return (
                <Paper key={r.label} variant="outlined" sx={{ p: 1.25, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                  <ReplayIcon color="action" />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontFamily: MONO, fontWeight: 700 }}><LabelLink name={r.label} /></Typography>
                    <Typography variant="caption" color="text.secondary">
                      {r.screen ? `Replay button in screen ${r.screen}` : "Started from Python"} · <SourceLink loc={r.loc} />
                      {l && ` · ${l.dialogue} lines`}
                      {route ? ` · reached in the story after ${route.decisions} decision${route.decisions === 1 ? "" : "s"}` : " · not reached by the story statically"}
                    </Typography>
                  </Box>
                  {l && <Button size="small" startIcon={<PlayCircleOutlineIcon />} onClick={() => go("story", { label: r.label })}>Play</Button>}
                </Paper>
              );
            })}
          </Stack>
        </Box>
      )}
    </Stack>
  );
}

function Flags({ flags, screens }: { flags: VariableInfo[]; screens: Record<string, string[]> }) {
  const { go } = useAnalyzer();
  const [query, setQuery] = useState("");
  const list = useMemo(() => flags.filter((f) => !query || f.name.toLowerCase().includes(query.toLowerCase())), [flags, query]);
  const paged = usePaged(list, 30);
  if (!flags.length) return <Alert severity="info">No persistent variables found. Persistent flags survive between playthroughs and usually unlock galleries, endings and extras.</Alert>;
  return (
    <>
      <Toolbar summary={`${list.length} persistent variables`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search flags" />
      </Toolbar>
      <Stack spacing={1}>
        {paged.slice.map((f) => {
          const sets = f.refs.filter((r) => r.kind === "write");
          const checks = f.refs.filter((r) => r.kind === "condition" || r.kind === "read");
          return (
            <Paper key={f.name} variant="outlined" sx={{ p: 1.25 }}>
              <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                <Chip size="small" label={f.name} onClick={() => go("variables", { variable: f.name })} sx={{ fontFamily: MONO, fontWeight: 700 }} />
                {f.initial && <Typography variant="caption" color="text.secondary">default {f.initial}</Typography>}
                {f.command && <Typography variant="caption" sx={{ fontFamily: MONO, ml: "auto" }}>console: {f.command}</Typography>}
              </Stack>
              <FlagRefs title="Set in" refs={sets} />
              <FlagRefs title="Checked in" refs={checks} />
              {screens[f.name] && (
                <Typography variant="caption" component="div">Used by screen{screens[f.name].length > 1 ? "s" : ""}: {screens[f.name].map((s) => <code key={s}>{s} </code>)}</Typography>
              )}
            </Paper>
          );
        })}
      </Stack>
      <Pager paged={paged as never} total={list.length} noun="flags" sizes={[30, 60, 120]} />
    </>
  );
}

function FlagRefs({ title, refs }: { title: string; refs: VariableInfo["refs"] }) {
  if (!refs.length) return null;
  return (
    <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
      <b>{title}:</b>{" "}
      {refs.slice(0, 8).map((r, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {r.label ? <LabelLink name={r.label} /> : "init"} (<SourceLink loc={r.loc} />) <Box component="code" sx={{ fontFamily: MONO, color: "text.secondary" }}>{r.code}</Box>
        </span>
      ))}
      {refs.length > 8 && ` · +${refs.length - 8} more`}
    </Typography>
  );
}
