import { Box, Button, Chip, Collapse, Paper, Stack, Typography } from "@mui/material";
import CallMergeIcon from "@mui/icons-material/CallMerge";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ForkRightIcon from "@mui/icons-material/ForkRight";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlined";
import TuneIcon from "@mui/icons-material/Tune";
import { useMemo, useState } from "react";
import type { ChoiceItem, MenuInfo } from "../../features/analyzer/model";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer } from "./context";
import { StageImage } from "./StageImage";
import { Pager, SearchField, SelectField, StatCard, StatRow, Toolbar, usePaged } from "./ui";

type Content = "meaningful" | "all" | "unique" | "state" | "conditional";
type Sort = "impact" | "order";

const hasUnique = (m: MenuInfo) => m.items.some((i) => i.uniqueLines > 0);
const hasState = (m: MenuInfo) => m.items.some((i) => i.writes.length > 0);
const hasCondition = (m: MenuInfo) => m.items.some((i) => i.condition);

const OUTCOME: Record<ChoiceItem["outcome"], string> = {
  rejoins: "Rejoins the main flow later",
  distinct: "Continues on a distinct branch",
  shared: "Continues in the shared story flow",
};

export function ChoicesSection() {
  const { index } = useAnalyzer();
  const [query, setQuery] = useState("");
  const [content, setContent] = useState<Content>("meaningful");
  const [sort, setSort] = useState<Sort>("impact");
  const counts = useMemo(
    () => ({ all: index.menus.length, meaningful: index.menus.filter((m) => m.important).length, unique: index.menus.filter(hasUnique).length, state: index.menus.filter(hasState).length }),
    [index],
  );
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = index.menus.filter((m) => {
      if (content === "meaningful" && !m.important) return false;
      if (content === "unique" && !hasUnique(m)) return false;
      if (content === "state" && !hasState(m)) return false;
      if (content === "conditional" && !hasCondition(m)) return false;
      if (!q) return true;
      return [m.label, m.name, m.caption?.what, ...m.items.flatMap((i) => [i.text, i.condition, ...i.targets, ...i.writes])].some((s) => s && s.toLowerCase().includes(q));
    });
    return sort === "impact" ? [...list].sort((a, b) => b.impact - a.impact) : list;
  }, [index, query, content, sort]);
  const paged = usePaged(items, 8);

  return (
    <Box>
      <StatRow>
        <StatCard value={counts.all} label="Decisions" active={content === "all"} onClick={() => setContent("all")} />
        <StatCard value={counts.meaningful} label="Meaningful" active={content === "meaningful"} onClick={() => setContent("meaningful")} />
        <StatCard value={counts.unique} label="Unique content" active={content === "unique"} onClick={() => setContent("unique")} />
        <StatCard value={counts.state} label="State-changing" active={content === "state"} onClick={() => setContent("state")} />
      </StatRow>
      <Toolbar summary={`${items.length.toLocaleString()} decisions · ${index.menus.length.toLocaleString()} in the game`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search choices" />
        <SelectField
          label="Content"
          value={content}
          onChange={setContent}
          options={[["meaningful", "Meaningful decisions"], ["all", "All decisions"], ["unique", "Unique content"], ["state", "State changes"], ["conditional", "Conditional options"]]}
        />
        <SelectField label="Sort" value={sort} onChange={setSort} options={[["impact", "Highest impact"], ["order", "Story order"]]} />
      </Toolbar>
      {content === "meaningful" && items.length === 0 && <Typography color="text.secondary">No meaningful decisions found. Try “All decisions” to see smaller or cosmetic choices.</Typography>}
      <Pager paged={paged as never} total={items.length} noun="decisions" sizes={[8, 16, 32]} />
      <Stack spacing={2}>
        {paged.slice.map((m) => (
          <DecisionCard key={m.id} menu={m} />
        ))}
      </Stack>
      <Pager paged={paged as never} total={items.length} noun="decisions" sizes={[8, 16, 32]} />
      <Typography variant="caption" color="text.secondary">
        Branch analysis follows static jumps and stops where routes rejoin. Python, runtime conditions and nested logic may change the real outcome.
      </Typography>
    </Box>
  );
}

function DecisionCard({ menu }: { menu: MenuInfo }) {
  const { go } = useAnalyzer();
  const [showUnique, setShowUnique] = useState(true);
  const major = menu.items.some((i) => i.major);
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Stack direction="row" sx={{ p: 1.75, gap: 1.5, alignItems: "center", flexWrap: "wrap", bgcolor: "action.hover" }}>
        {major ? <Chip size="small" color="warning" label="Major branch" /> : menu.important ? <Chip size="small" variant="outlined" label="Meaningful" /> : <Chip size="small" variant="outlined" label="Cosmetic" />}
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>
            Decision in {menu.label ? <Chip size="small" variant="outlined" label={menu.label} onClick={() => go("story", { label: menu.label! })} sx={{ fontFamily: MONO }} /> : "(top level)"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {menu.items.length} options{menu.name && ` · menu ${menu.name}`} · <SourceLink loc={menu.loc} />
          </Typography>
        </Box>
        <Box sx={{ ml: "auto", display: "flex", gap: 1 }}>
          {menu.label && (
            <Button size="small" variant="contained" startIcon={<PlayCircleOutlineIcon />} onClick={() => go("story", { label: menu.label! })}>
              Preview
            </Button>
          )}
          <Button size="small" variant={showUnique ? "outlined" : "text"} onClick={() => setShowUnique(!showUnique)}>
            Unique content
          </Button>
        </Box>
      </Stack>
      {menu.caption && (
        <Typography sx={{ px: 2, pt: 1.5, fontStyle: "italic" }}>
          {menu.caption.who && <b>{menu.caption.who}: </b>}
          {menu.caption.what}
        </Typography>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: `repeat(${Math.min(3, menu.items.length)}, minmax(0, 1fr))` }, gap: 1.5, p: 1.75 }}>
        {menu.items.map((it, i) => (
          <OptionCard key={i} n={i + 1} item={it} showUnique={showUnique} />
        ))}
      </Box>
    </Paper>
  );
}

function OptionCard({ n, item, showUnique }: { n: number; item: ChoiceItem; showUnique: boolean }) {
  const { go } = useAnalyzer();
  const [open, setOpen] = useState(false);
  return (
    <Paper variant="outlined" sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ p: 1.5, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", mb: 1 }}>
          <Box sx={{ width: 24, height: 24, borderRadius: "50%", bgcolor: "action.selected", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{n}</Box>
          <Typography sx={{ fontWeight: 700 }}>{item.text}</Typography>
        </Stack>
        {item.condition && (
          <Typography variant="caption" sx={{ display: "block", fontFamily: MONO, color: "warning.main", mb: 1 }}>Available if {item.condition}</Typography>
        )}
        {showUnique && (
          <>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Exclusive to this choice</Typography>
            <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5, mb: 1 }}>
              <Chip size="small" label={`~${item.uniqueLines} dialogue`} />
              {item.writes.length > 0 && <Chip size="small" icon={<TuneIcon />} label={`${item.writes.length} state change${item.writes.length > 1 ? "s" : ""}`} />}
              {item.visuals.length > 0 && <Chip size="small" label={`${item.visuals.length} visual${item.visuals.length > 1 ? "s" : ""}`} />}
            </Stack>
            {item.visuals.length > 0 && (
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0.75 }}>
                {item.visuals.slice(0, 2).map((v) => (
                  <Box key={v} onClick={() => go("visuals", { image: v })} title={`Open ${v} in Visuals`} sx={{ position: "relative", height: 90, borderRadius: 1, overflow: "hidden", bgcolor: "#111", cursor: "pointer" }}>
                    <StageImage name={v} fit={/^(bg|cg|black|white|scene|event)\b/i.test(v) ? "cover" : "contain"} />
                    <Typography variant="caption" noWrap sx={{ position: "absolute", left: 4, right: 4, bottom: 2, color: "#fff", textShadow: "0 1px 2px #000" }}>{v}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </>
        )}
      </Box>
      <Box sx={{ borderTop: 1, borderColor: "divider" }}>
        <Stack direction="row" sx={{ alignItems: "center", px: 1.5, py: 0.75, gap: 0.75 }}>
          {item.outcome === "distinct" ? <ForkRightIcon fontSize="small" /> : <CallMergeIcon fontSize="small" />}
          <Typography variant="body2" sx={{ flex: 1 }}>{OUTCOME[item.outcome]}</Typography>
          <Button size="small" endIcon={<ExpandMoreIcon sx={{ transform: open ? "rotate(180deg)" : undefined }} />} onClick={() => setOpen(!open)}>Details</Button>
        </Stack>
        <Collapse in={open}>
          <Box sx={{ px: 1.5, pb: 1.5 }}>
            {item.targets.length > 0 && (
              <Typography variant="body2">Goes to: {item.targets.map((t, i) => <span key={t}>{i > 0 && ", "}<LabelLink name={t} /></span>)}</Typography>
            )}
            {item.rejoin && <Typography variant="body2">Rejoins at <LabelLink name={item.rejoin} /></Typography>}
            {item.uniqueLabels.length > 0 && (
              <Typography variant="body2">Only on this branch: {item.uniqueLabels.map((t, i) => <span key={t}>{i > 0 && ", "}<LabelLink name={t} /></span>)}</Typography>
            )}
            {item.writes.length > 0 && (
              <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
                {item.writes.map((w) => <Chip key={w} size="small" variant="outlined" label={w} onClick={() => go("variables", { variable: w })} sx={{ fontFamily: MONO }} />)}
              </Stack>
            )}
            <Typography variant="caption" color="text.secondary">~{item.uniqueWords.toLocaleString()} exclusive words</Typography>
          </Box>
        </Collapse>
      </Box>
    </Paper>
  );
}
