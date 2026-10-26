import { Alert, Box, Button, ButtonGroup, Chip, Collapse, Paper, Stack, Typography } from "@mui/material";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FlagOutlinedIcon from "@mui/icons-material/FlagOutlined";
import ListAltIcon from "@mui/icons-material/ListAlt";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlined";
import { useMemo, useState } from "react";
import { choiceGuide, findEndings, routeTree, type Ending, type EndingTone, type GuideMenu } from "../../features/analyzer/guide";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer } from "./context";
import { RouteRequirements, RouteSteps } from "./RouteView";
import { Pager, SearchField, SelectField, StatCard, StatRow, Toolbar, usePaged } from "./ui";

type ToneFilter = "all" | EndingTone | "unknown";
type View = "endings" | "guide";

const TONE: Record<EndingTone, { label: string; color: "success" | "error" | "secondary" | "info" | "default" }> = {
  good: { label: "Good ending", color: "success" },
  bad: { label: "Bad ending", color: "error" },
  true: { label: "True ending", color: "secondary" },
  secret: { label: "Secret ending", color: "info" },
  normal: { label: "Normal ending", color: "default" },
};

const HOW: Record<Ending["how"], string> = {
  return: "Returns to the main menu",
  restart: "Restarts the game",
  "end-of-script": "Script ends here",
};

export function WalkthroughSection() {
  const { index } = useAnalyzer();
  const [view, setView] = useState<View>("endings");
  const tree = useMemo(() => routeTree(index), [index]);
  const endings = useMemo(() => findEndings(index, tree), [index, tree]);
  const guide = useMemo(() => (view === "guide" ? choiceGuide(index, endings, tree) : []), [index, endings, tree, view]);
  const reachable = endings.filter((e) => e.route).length;

  return (
    <Box>
      <StatRow>
        <StatCard value={endings.length} label="Endings found" sub={`${reachable} reachable from the start`} />
        <StatCard value={endings.filter((e) => e.tone === "good" || e.tone === "true").length} label="Good / true endings" />
        <StatCard value={endings.filter((e) => e.tone === "bad").length} label="Bad endings" />
        <StatCard value={index.menus.filter((m) => m.important).length} label="Meaningful decisions" sub={`${index.menus.length.toLocaleString()} menus in total`} />
      </StatRow>
      <Toolbar>
        <ButtonGroup size="small" aria-label="Walkthrough view">
          <Button variant={view === "endings" ? "contained" : "outlined"} startIcon={<EmojiEventsOutlinedIcon />} onClick={() => setView("endings")}>Ending guide</Button>
          <Button variant={view === "guide" ? "contained" : "outlined"} startIcon={<ListAltIcon />} onClick={() => setView("guide")}>Choice walkthrough</Button>
        </ButtonGroup>
      </Toolbar>
      {view === "endings" ? <Endings endings={endings} /> : <ChoiceGuide guide={guide} endings={endings} />}
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 2 }}>
        Routes follow static jumps, calls and fall-through, picking the path with the fewest decisions. Python code, screens and jumps computed at runtime aren't
        simulated, so treat requirements as a guide.
      </Typography>
    </Box>
  );
}

function Endings({ endings }: { endings: Ending[] }) {
  const [query, setQuery] = useState("");
  const [tone, setTone] = useState<ToneFilter>("all");
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return endings.filter(
      (e) =>
        (tone === "all" || (tone === "unknown" ? e.tone === null : e.tone === tone)) &&
        (!q || e.label.name.toLowerCase().includes(q) || (e.label.last?.what ?? "").toLowerCase().includes(q)),
    );
  }, [endings, query, tone]);
  const paged = usePaged(items, 12);
  if (!endings.length) {
    return (
      <Alert severity="info">
        No endings found. Endings are labels that return to the main menu, restart the game or end the script; this game may end through screens or Python instead.
      </Alert>
    );
  }
  return (
    <>
      <Toolbar summary={`${items.length} of ${endings.length} endings`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search endings" />
        <SelectField
          label="Type"
          value={tone}
          onChange={setTone}
          options={[["all", "All endings"], ["good", "Good"], ["true", "True"], ["bad", "Bad"], ["secret", "Secret"], ["normal", "Normal"], ["unknown", "Untagged"]]}
        />
      </Toolbar>
      <Stack spacing={1.5}>
        {paged.slice.map((e) => (
          <EndingCard key={e.label.name} ending={e} />
        ))}
      </Stack>
      <Pager paged={paged as never} total={items.length} noun="endings" sizes={[12, 24, 48]} />
    </>
  );
}

function EndingCard({ ending }: { ending: Ending }) {
  const { go, index } = useAnalyzer();
  const [open, setOpen] = useState(false);
  const names = useMemo(() => new Map(index.characters.map((c) => [c.id, c.name ?? c.id])), [index]);
  const { label, route } = ending;
  const tone = ending.tone ? TONE[ending.tone] : null;
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", borderLeft: 3, borderLeftColor: tone ? tone.color === "default" ? "text.disabled" : `${tone.color}.main` : "divider" }}>
      <Stack direction="row" sx={{ p: 1.75, gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <FlagOutlinedIcon color="action" />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 800, fontFamily: MONO }}>{label.name}</Typography>
            {tone && <Chip size="small" color={tone.color} label={tone.label} sx={{ height: 20 }} />}
            <Chip size="small" variant="outlined" label={HOW[ending.how]} sx={{ height: 20 }} />
            {label.replay && <Chip size="small" variant="outlined" label="Replay scene" sx={{ height: 20 }} />}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {route ? (route.decisions === 0 ? "No decisions needed" : `${route.decisions} decision${route.decisions === 1 ? "" : "s"} from the start`) : "Not reachable from the start through static jumps"}
            {" · "}
            {label.dialogue} lines · <SourceLink loc={label.loc} />
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" startIcon={<PlayCircleOutlineIcon />} onClick={() => go("story", { label: label.name })}>Play</Button>
          <Button size="small" endIcon={<ExpandMoreIcon sx={{ transform: open ? "rotate(180deg)" : undefined }} />} onClick={() => setOpen(!open)} aria-expanded={open}>
            How to get it
          </Button>
        </Stack>
      </Stack>
      {label.last && (
        <Typography variant="body2" sx={{ px: 2, pb: 1.5, fontStyle: "italic", color: "text.secondary" }}>
          “{label.last.who && <b>{names.get(label.last.who) ?? label.last.who}: </b>}
          {label.last.what.replace(/\{[^{}]*\}/g, "")}”
        </Typography>
      )}
      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, pb: 2, pt: 0.5, borderTop: 1, borderColor: "divider" }}>
          {route ? (
            <>
              <RouteSteps route={route} target={label.name} />
              <RouteRequirements route={route} />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
              No static route leads here. It may be entered from a screen, a replay, a jump computed at runtime, or it may be cut content.
            </Typography>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}

function ChoiceGuide({ guide, endings }: { guide: GuideMenu[]; endings: Ending[] }) {
  const [query, setQuery] = useState("");
  const [content, setContent] = useState<"meaningful" | "all" | "endings">("meaningful");
  const tones = useMemo(() => new Map(endings.map((e) => [e.label.name, e.tone])), [endings]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guide.filter((g) => {
      if (content === "meaningful" && !g.menu.important) return false;
      if (content === "endings" && !g.options.some((o) => o.endings.length)) return false;
      return !q || [g.menu.label, g.menu.caption?.what, ...g.options.flatMap((o) => [o.item.text, ...o.item.writes])].some((s) => s?.toLowerCase().includes(q));
    });
  }, [guide, query, content]);
  const paged = usePaged(items, 20);
  return (
    <>
      <Toolbar summary={`${items.length} of ${guide.length} decisions, in story order`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search choices" />
        <SelectField label="Show" value={content} onChange={setContent} options={[["meaningful", "Meaningful decisions"], ["endings", "Decide an ending"], ["all", "All decisions"]]} />
      </Toolbar>
      {items.length === 0 && <Typography color="text.secondary">No decisions match.</Typography>}
      <Stack spacing={1.25}>
        {paged.slice.map((g) => (
          <GuideCard key={g.menu.id} g={g} tones={tones} />
        ))}
      </Stack>
      <Pager paged={paged as never} total={items.length} noun="decisions" sizes={[20, 50, 100]} />
    </>
  );
}

function GuideCard({ g, tones }: { g: GuideMenu; tones: Map<string, EndingTone | null> }) {
  const { go } = useAnalyzer();
  const { menu } = g;
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap", mb: 1 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {menu.caption?.what ? `“${menu.caption.what.replace(/\{[^{}]*\}/g, "")}”` : "Decision"}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {menu.label ? <>in <LabelLink name={menu.label} /> · </> : null}
          {g.depth === null ? "not reachable statically" : g.depth === 0 ? "on the main path" : `after ${g.depth} earlier decision${g.depth === 1 ? "" : "s"}`} · <SourceLink loc={menu.loc} />
        </Typography>
        {menu.label && (
          <Button size="small" sx={{ ml: "auto" }} startIcon={<PlayCircleOutlineIcon />} onClick={() => go("story", { label: menu.label!, line: menu.loc.line })}>
            Play
          </Button>
        )}
      </Stack>
      <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& td": { py: 0.6, pr: 1.5, verticalAlign: "top", borderTop: 1, borderColor: "divider" } }}>
        <tbody>
          {g.options.map((o, i) => (
            <tr key={i}>
              <Box component="td" sx={{ width: { sm: "38%" } }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{i + 1}. {o.item.text}</Typography>
                {o.item.condition && <Typography variant="caption" sx={{ fontFamily: MONO, color: "warning.main" }}>only if {o.item.condition}</Typography>}
              </Box>
              <td>
                <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
                  {o.endings.map((e) => (
                    <Chip
                      key={e}
                      size="small"
                      icon={<FlagOutlinedIcon />}
                      color={(tones.get(e) && TONE[tones.get(e)!].color) || "primary"}
                      label={`Only way to ${e}`}
                      onClick={() => go("story", { label: e })}
                    />
                  ))}
                  {o.item.writes.map((w) => (
                    <Chip key={w} size="small" variant="outlined" label={w} onClick={() => go("variables", { variable: w })} sx={{ fontFamily: MONO }} />
                  ))}
                  <Typography variant="caption" color="text.secondary">
                    {o.item.uniqueLines > 0 ? `~${o.item.uniqueLines} exclusive lines` : "no exclusive dialogue"}
                    {o.item.rejoin && <> · rejoins at <LabelLink name={o.item.rejoin} /></>}
                  </Typography>
                </Stack>
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
    </Paper>
  );
}
