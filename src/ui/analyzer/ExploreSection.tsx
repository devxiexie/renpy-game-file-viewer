import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import { useMemo, type ReactNode } from "react";
import { resolveLayers } from "../../features/analyzer/stage";
import { useAnalyzer, type AnalyzerTab } from "./context";
import { Portrait, StageImage } from "./StageImage";
import { SectionTitle } from "./ui";

function ExploreCard({ icon, title, text, count, tab, children }: { icon: ReactNode; title: string; text: string; count: string; tab: AnalyzerTab; children: ReactNode }) {
  const { go } = useAnalyzer();
  return (
    <Paper
      variant="outlined"
      onClick={() => go(tab)}
      sx={{ position: "relative", overflow: "hidden", minHeight: { xs: 240, md: 280 }, p: 2.5, cursor: "pointer", display: "flex", flexDirection: "column", "&:hover": { borderColor: "primary.main" }, "&:hover .explore-art": { transform: "scale(1.02)" } }}
    >
      <Box className="explore-art" sx={{ position: "absolute", inset: 0, left: { xs: "35%", sm: "45%" }, transition: "transform 200ms ease", pointerEvents: "none" }}>
        {children}
      </Box>
      <Box sx={{ position: "relative", maxWidth: { xs: "70%", sm: "55%" } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
          {icon}
          <Typography variant="h5" sx={{ fontWeight: 800 }}>{title}</Typography>
        </Stack>
        <Typography color="text.secondary" sx={{ mb: 1 }}>{text}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{count}</Typography>
      </Box>
      <Button endIcon={<ArrowForwardIcon />} sx={{ position: "relative", mt: "auto", alignSelf: "flex-start", px: 0 }}>
        Open {title}
      </Button>
    </Paper>
  );
}

/** Tilted art tiles for the Visuals card. */
function Collage({ names }: { names: string[] }) {
  const spots = [
    { right: "4%", top: "8%", w: "62%", h: "78%", r: 2 },
    { right: "40%", top: "18%", w: "48%", h: "60%", r: -4 },
    { right: "2%", top: "52%", w: "40%", h: "42%", r: 5 },
  ];
  return (
    <>
      {names.slice(0, 3).reverse().map((n, i) => {
        const s = spots[names.length - 1 - i] ?? spots[0];
        return (
          <Box key={n} sx={{ position: "absolute", right: s.right, top: s.top, width: s.w, height: s.h, transform: `rotate(${s.r}deg)`, borderRadius: 1.5, overflow: "hidden", boxShadow: 6, bgcolor: "#111" }}>
            <StageImage name={n} fit="cover" />
          </Box>
        );
      })}
    </>
  );
}

export function ExploreSection() {
  const { index, catalog } = useAnalyzer();
  const art = useMemo(() => {
    const drawable = index.images.filter((i) => i.kind !== "solid" && resolveLayers(catalog, i.name).length > 0);
    const big = drawable.filter((i) => i.tag === "bg" || i.tag === "cg" || /cg|event|scene/i.test(i.name));
    return [...(big.length >= 3 ? big : drawable)].sort((a, b) => b.uses - a.uses).slice(0, 3).map((i) => i.name);
  }, [index, catalog]);
  const cast = index.characters.filter((c) => c.lines > 0 && c.id !== "narrator").slice(0, 7);
  const story = [...index.labels].filter((l) => l.dialogue > 0).sort((a, b) => b.score - a.score).slice(0, 3);
  const decisions = [...index.menus].sort((a, b) => b.impact - a.impact).slice(0, 2);
  const chipSpots = [
    ["8%", "10%"], ["45%", "6%"], ["22%", "34%"], ["58%", "40%"], ["12%", "62%"], ["48%", "70%"], ["30%", "86%"],
  ];

  return (
    <Box>
      <SectionTitle title="Explore the game" sub="Pick what you want to inspect. Each card opens the full section." />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}>
        <ExploreCard icon={<PhotoLibraryOutlinedIcon />} title="Visuals" text="Browse CGs, sprites, backgrounds, layered images, composites and videos." count={`${index.images.length.toLocaleString()} found`} tab="visuals">
          <Collage names={art} />
        </ExploreCard>
        <ExploreCard icon={<GroupsOutlinedIcon />} title="Characters" text="Meet the cast, inspect portraits and jump into their scenes." count={`${index.characters.filter((c) => c.lines > 0).length} characters`} tab="characters">
          {cast.map((c, i) => (
            <Paper key={c.id} elevation={3} sx={{ position: "absolute", left: chipSpots[i][0], top: chipSpots[i][1], display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0.5, transform: `rotate(${((i % 3) - 1) * 2}deg)` }}>
              {c.portrait && (
                <Box sx={{ position: "relative", width: 28, height: 28, borderRadius: "50%", overflow: "hidden", bgcolor: "action.hover" }}>
                  <Portrait name={c.portrait} />
                </Box>
              )}
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{c.name ?? c.id}</Typography>
            </Paper>
          ))}
        </ExploreCard>
        <ExploreCard icon={<MenuBookOutlinedIcon />} title="Story" text="Jump into substantial labels and explore the game scene by scene." count={`${index.labels.filter((l) => l.dialogue > 0).length} story sections`} tab="story">
          <Stack spacing={1} sx={{ position: "absolute", right: 12, top: 16, width: "88%" }}>
            {story.map((l) => (
              <Paper key={l.name} elevation={3} sx={{ position: "relative", height: 70, overflow: "hidden" }}>
                {l.background && <Box sx={{ position: "absolute", inset: 0, opacity: 0.55 }}><StageImage name={l.background} fit="cover" placeholder={false} /></Box>}
                <Box sx={{ position: "relative", p: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800, fontFamily: "monospace" }}>{l.name}</Typography>
                  <Typography variant="caption">{l.dialogue} lines · {l.menus} menus</Typography>
                </Box>
              </Paper>
            ))}
          </Stack>
        </ExploreCard>
        <ExploreCard icon={<CallSplitIcon />} title="Choices" text="Find decisions and inspect branching routes without playing through everything." count={`${index.menus.length} decisions`} tab="choices">
          <Stack spacing={1} sx={{ position: "absolute", right: 12, top: 16, width: "88%" }}>
            {decisions.map((m) => (
              <Paper key={m.id} elevation={3} sx={{ p: 1 }}>
                <Typography variant="caption" color="text.secondary">Decision in {m.label}</Typography>
                {m.items.slice(0, 3).map((it, i) => (
                  <Typography key={i} variant="body2" noWrap sx={{ fontWeight: 600 }}>{i + 1}. {it.text}</Typography>
                ))}
              </Paper>
            ))}
          </Stack>
        </ExploreCard>
      </Box>
    </Box>
  );
}
