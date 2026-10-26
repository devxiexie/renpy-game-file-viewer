import { Alert, Box, Button, Chip, FormControlLabel, IconButton, LinearProgress, Paper, Stack, Switch, Tab, Tabs, Typography } from "@mui/material";
import CachedIcon from "@mui/icons-material/Cached";
import CloseIcon from "@mui/icons-material/Close";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import PhotoLibraryOutlinedIcon from "@mui/icons-material/PhotoLibraryOutlined";
import ReplayIcon from "@mui/icons-material/Replay";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kindOf } from "../../core/files/types";
import type { TreeNode } from "../../core/vfs/tree";
import { deleteCached, fingerprint, loadCached, saveCached } from "../../features/analyzer/cache";
import type { AnalyzerIndex } from "../../features/analyzer/model";
import { imageCatalog } from "../../features/analyzer/stage";
import { exportPath } from "../../features/export/export";
import { autoAnalyzerEnabled, setAutoAnalyzer, useApp } from "../../state/store";
import { engine } from "../../workers/client";
import { BackToFiles } from "../BackToFiles";
import { AnalyzerProvider, type AnalyzerTab, type Selection } from "./context";
import { CharactersSection } from "./CharactersSection";
import { ChoicesSection } from "./ChoicesSection";
import { ExploreSection } from "./ExploreSection";
import { OverviewSection } from "./OverviewSection";
import { StageImage } from "./StageImage";
import { StorySection } from "./StorySection";
import { VariablesSection } from "./VariablesSection";
import { VisualsView } from "./VisualsView";
import { AudioSection } from "./AudioSection";
import { DialogueSection } from "./DialogueSection";
import { GallerySection } from "./GallerySection";
import { WalkthroughSection } from "./WalkthroughSection";

const TABS: { id: AnalyzerTab; label: string; icon?: React.ReactElement }[] = [
  { id: "explore", label: "Explore" },
  { id: "visuals", label: "Visuals", icon: <PhotoLibraryOutlinedIcon fontSize="small" /> },
  { id: "overview", label: "Overview" },
  { id: "characters", label: "Characters" },
  { id: "story", label: "Story / Labels" },
  { id: "choices", label: "Choices" },
  { id: "variables", label: "Variables" },
  { id: "walkthrough", label: "Walkthrough" },
  { id: "dialogue", label: "Dialogue" },
  { id: "audio", label: "Audio" },
  { id: "gallery", label: "Gallery" },
];

/** Path relative to the game directory ("images/bg.png"), as Ren'Py sees it. */
function gamePathOf(path: string): string {
  const i = path.lastIndexOf("/game/");
  if (i >= 0) return path.slice(i + 6);
  return path.startsWith("game/") ? path.slice(5) : path;
}

export function readingTime(words: number): string {
  const minutes = words / 230;
  if (minutes < 90) return `~${Math.max(1, Math.round(minutes))} min`;
  return `~${Math.round(minutes / 60)}h`;
}

function bannerDismissed(): boolean {
  try {
    return localStorage.getItem("rpv.analyzerBanner") === "0";
  } catch {
    return false;
  }
}

export function AnalyzerTool() {
  const tree = useApp((s) => s.tree);
  const expandArchive = useApp((s) => s.expandArchive);
  const scanRequest = useApp((s) => s.analyzerScanRequest);
  const openHelp = useApp((s) => s.openHelp);
  const [index, setIndex] = useState<AnalyzerIndex | null>(null);
  const [fileNodes, setFileNodes] = useState<Map<string, TreeNode>>(new Map());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cache, setCache] = useState<{ key: string; savedAt: number; fromCache: boolean } | null>(null);
  const [tab, setTab] = useState<AnalyzerTab>("explore");
  const [selection, setSelection] = useState<Selection>({});
  const [showBanner, setShowBanner] = useState(!bannerDismissed());
  const [auto, setAuto] = useState(autoAnalyzerEnabled());
  const running = useRef(false);

  const build = useCallback(
    async (force = false) => {
      if (running.current) return;
      running.current = true;
      setError(null);
      try {
        const archives = [...tree.files()].filter((n) => n.archive && n.archive.status !== "ready");
        for (const [i, a] of archives.entries()) {
          setStatus(`Reading archive ${i + 1}/${archives.length}: ${a.name}`);
          await expandArchive(a.id);
        }
        const all = [...tree.files()];
        const scripts = all.filter((n) => kindOf(n.name) === "rpyc").map((n) => ({ fileId: n.id, path: n.path, source: n.source! }));
        if (scripts.length === 0) throw new Error("No compiled Ren'Py scripts (.rpyc) found. Open the game folder or its archives.");
        const images = new Map<string, TreeNode>();
        for (const n of all) if (["image", "video", "audio"].includes(kindOf(n.name))) images.set(gamePathOf(exportPath(tree, n)), n);
        setFileNodes(images);
        const key = fingerprint([...all.filter((n) => kindOf(n.name) === "rpyc"), ...images.values()].map((n) => ({ path: n.path, size: n.size })));
        if (!force) {
          setStatus("Checking the local cache…");
          const hit = await loadCached(key);
          if (hit) {
            setIndex(hit.index);
            setCache({ key, savedAt: hit.savedAt, fromCache: true });
            return;
          }
        } else {
          await deleteCached(key);
        }
        setStatus(`Scanning ${scripts.length} Ren'Py scripts…`);
        const filesOf = (kind: string) => [...images].filter(([, n]) => kindOf(n.name) === kind).map(([gamePath, n]) => ({ fileId: n.id, gamePath }));
        const ix = await engine().buildAnalyzerIndex({ scripts, imageFiles: filesOf("image"), audioFiles: filesOf("audio") });
        setIndex(ix);
        const savedAt = Date.now();
        setCache({ key, savedAt, fromCache: false });
        void saveCached({ key, savedAt, index: ix });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        running.current = false;
        setStatus(null);
      }
    },
    [tree, expandArchive],
  );

  // Scan when opened, and again when a new game is opened while the tab exists.
  useEffect(() => {
    void build();
  }, [build, scanRequest]);

  const catalog = useMemo(() => (index ? imageCatalog(index, [...fileNodes.keys()]) : null), [index, fileNodes]);
  const go = useCallback((t: AnalyzerTab, sel?: Selection) => {
    setTab(t);
    setSelection(sel ?? {});
  }, []);
  const ctx = useMemo(() => (index && catalog ? { index, catalog, fileNodes, query: "", selection, go } : null), [index, catalog, fileNodes, selection, go]);

  const hero = useMemo(() => {
    if (!index) return null;
    const bg =
      index.images.find((i) => /main_menu|title|menu_bg/i.test(i.name) && i.kind !== "movie")?.name ??
      [...index.images].filter((i) => i.tag === "bg" || i.tag === "cg").sort((a, b) => b.uses - a.uses)[0]?.name ??
      null;
    return { bg, title: index.game.name ?? tree.roots[0]?.name ?? "Ren'Py game" };
  }, [index, tree]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
      <Box sx={{ maxWidth: 1400, mx: "auto", p: { xs: 1.5, sm: 2.5 } }}>
        <Paper variant="outlined" sx={{ position: "relative", overflow: "hidden", mb: 2, minHeight: 180 }}>
          {ctx && hero?.bg && (
            <AnalyzerProvider value={ctx}>
              <Box sx={{ position: "absolute", inset: 0, opacity: 0.22, filter: "blur(2px) saturate(1.1)" }}>
                <StageImage name={hero.bg} fit="cover" placeholder={false} />
              </Box>
            </AnalyzerProvider>
          )}
          <Box sx={{ position: "relative", p: { xs: 2, sm: 3 }, background: "linear-gradient(90deg, var(--mui-palette-background-paper) 35%, transparent)" }}>
            <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", mb: 1, alignItems: "center" }}>
              <BackToFiles />
              <Chip size="small" color="primary" label="Ren'Py Analyzer" />
              <Chip size="small" variant="outlined" icon={<HelpOutlineIcon />} label="Help" onClick={openHelp} />
              {index?.game.version && <Chip size="small" variant="outlined" label={`Version ${index.game.version}`} />}
            </Stack>
            <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: -1, fontSize: { xs: 30, sm: 44 } }}>
              {hero?.title ?? tree.roots[0]?.name ?? "Ren'Py Analyzer"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {tree.roots.map((r) => r.name).join(", ")}
            </Typography>
            {index && (
              <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap" }}>
                {[
                  [readingTime(index.totals.words), "Estimated reading"],
                  [index.totals.dialogue.toLocaleString(), "Dialogue"],
                  [index.characters.filter((c) => c.lines > 0).length.toLocaleString(), "Characters"],
                  [index.images.length.toLocaleString(), "Visuals"],
                ].map(([v, l]) => (
                  <Paper key={l} variant="outlined" sx={{ px: 1.75, py: 1, minWidth: 130, bgcolor: "background.paper" }}>
                    <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>{v}</Typography>
                    <Typography variant="caption" color="text.secondary">{l}</Typography>
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
        </Paper>

        {showBanner && (
          <Alert
            severity="info"
            icon={<InfoOutlinedIcon />}
            sx={{ mb: 2 }}
            action={
              <IconButton
                size="small"
                aria-label="Dismiss"
                onClick={() => {
                  setShowBanner(false);
                  try {
                    localStorage.setItem("rpv.analyzerBanner", "0");
                  } catch {
                    /* ignore */
                  }
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            }
          >
            <b>New here?</b> This Analyzer tab opened because a Ren'Py game was detected. It's an extra, structured view of the project — the original scripts, images and other
            files are still in the file browser (on the left, or below on phones). Click any file there to open it in its own tab.{" "}
            <Button size="small" onClick={openHelp} sx={{ p: 0, minWidth: 0, verticalAlign: "baseline" }}>Read the Analyzer guide</Button>
            <FormControlLabel
              sx={{ display: "flex", mt: 0.5 }}
              control={<Switch size="small" checked={auto} onChange={(e) => (setAuto(e.target.checked), setAutoAnalyzer(e.target.checked))} />}
              label={<Typography variant="body2">Open the Analyzer automatically for Ren'Py games</Typography>}
            />
          </Alert>
        )}

        <Paper variant="outlined" sx={{ mb: 1.5 }}>
          <Tabs value={tab} onChange={(_, v: AnalyzerTab) => go(v)} variant="scrollable" scrollButtons="auto" aria-label="Analyzer sections" sx={{ minHeight: 46, "& .MuiTab-root": { minHeight: 46, textTransform: "none", fontWeight: 600 } }}>
            {TABS.map((t) => (
              <Tab key={t.id} value={t.id} label={t.label} icon={t.icon} iconPosition="start" />
            ))}
          </Tabs>
        </Paper>

        <Stack direction="row" sx={{ justifyContent: "flex-end", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
          {cache && (
            <Chip
              size="small"
              variant="outlined"
              icon={<CachedIcon />}
              label={cache.fromCache ? `Loaded from local cache · saved ${new Date(cache.savedAt).toLocaleString()}` : "Saved to local cache"}
            />
          )}
          <Button size="small" startIcon={<ReplayIcon />} onClick={() => void build(true)} disabled={!!status}>
            Clear cache & rescan
          </Button>
        </Stack>

        {status && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">{status}</Typography>
            <LinearProgress />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={() => void build(true)}>Retry analysis</Button>}>
            {error}
          </Alert>
        )}

        {ctx && (
          <AnalyzerProvider value={ctx}>
            {tab === "explore" && <ExploreSection />}
            {tab === "visuals" && <VisualsView />}
            {tab === "overview" && <OverviewSection />}
            {tab === "characters" && <CharactersSection />}
            {tab === "story" && <StorySection />}
            {tab === "choices" && <ChoicesSection />}
            {tab === "variables" && <VariablesSection />}
            {tab === "walkthrough" && <WalkthroughSection />}
            {tab === "dialogue" && <DialogueSection />}
            {tab === "audio" && <AudioSection />}
            {tab === "gallery" && <GallerySection />}
          </AnalyzerProvider>
        )}
      </Box>
    </Box>
  );
}
