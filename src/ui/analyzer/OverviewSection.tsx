import { Box, Chip, LinearProgress, Link, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { ColorDot, LabelLink, useAnalyzer } from "./context";
import { StatCard, StatRow } from "./ui";

function Panel({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{sub}</Typography>
      {children}
    </Paper>
  );
}

function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: "action.hover", border: 0 }}>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>{typeof value === "number" ? value.toLocaleString() : value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Paper>
  );
}

function Bars({ rows }: { rows: { key: string; label: ReactNode; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "minmax(80px, 180px) 1fr auto", gap: 0.75, alignItems: "center" }}>
      {rows.map((r) => (
        <Box key={r.key} sx={{ display: "contents" }}>
          <Typography variant="body2" noWrap>{r.label}</Typography>
          <Box sx={{ height: 8, borderRadius: 4, bgcolor: "action.hover" }}>
            <Box sx={{ height: "100%", width: `${(100 * r.value) / max}%`, bgcolor: "primary.main", borderRadius: 4 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.value.toLocaleString()}</Typography>
        </Box>
      ))}
    </Box>
  );
}

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);

export function OverviewSection() {
  const { index, go } = useAnalyzer();
  const d = index.diagnostics;
  const content = index.labels.filter((l) => l.dialogue > 0);
  const branching = content.filter((l) => l.menus > 0 || index.edges.some((e) => e.from === l.name && e.conditional)).length;
  const withVisuals = content.filter((l) => l.visuals > 0 || l.background).length;
  const avgDialogue = content.length ? Math.round(index.totals.dialogue / content.length) : 0;
  const pythonShare = pct(d.pythonInLabels, d.pythonInLabels + index.totals.dialogue);
  const endings = index.labels.filter((l) => l.reachable && l.ending === "return" && !index.edges.some((e) => e.kind === "call" && e.to === l.name)).length;

  const tags: string[] = [];
  if (pct(branching, content.length) >= 20) tags.push("Branch-heavy");
  else if (pct(branching, content.length) < 5) tags.push("Mostly linear");
  if (pct(withVisuals, content.length) >= 60) tags.push("Visual-heavy");
  if (index.totals.words > 150_000) tags.push("Very large script");
  else if (index.totals.words > 50_000) tags.push("Large script");
  else if (index.totals.words < 10_000) tags.push("Short script");
  if (pythonShare > 15) tags.push("Python-heavy");
  else if (pythonShare >= 3) tags.push("Some Python");
  if (endings >= 3) tags.push(`${endings} endings`);
  if (index.images.some((i) => i.kind === "layered")) tags.push("Layered images");
  if (index.images.some((i) => i.kind === "movie")) tags.push("Video");

  const parsed = d.parsedFiles;
  const total = d.parsedFiles + d.failedFiles;
  const entries = index.labels.filter((l) => l.entry);
  const missing = [...new Set(index.edges.filter((e) => !e.dynamic && !index.labels.some((l) => l.name === e.to)).map((e) => e.to))];

  return (
    <Box>
      <StatRow>
        <StatCard value={d.contentLabels} label="Content labels" onClick={() => go("story")} />
        <StatCard value={d.scenesWithVisuals} label="Scenes with visuals" />
        <StatCard value={index.totals.words} label="Words" />
        <StatCard value={d.screens} label="Screens" />
        <StatCard value={d.transforms} label="Transforms" />
      </StatRow>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2, mb: 2 }}>
        <Panel title="Project profile" sub="A structural snapshot of how the project is put together, based on the parsed story flow.">
          <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", mb: 2 }}>
            {tags.map((t) => <Chip key={t} size="small" variant="outlined" label={t} />)}
          </Stack>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 1 }}>
            <Metric value={`${pct(branching, content.length)}%`} label="Branching labels" />
            <Metric value={`${pct(withVisuals, content.length)}%`} label="Labels with visuals" />
            <Metric value={avgDialogue} label="Avg dialogue / label" />
            <Metric value={`${pythonShare}%`} label="Python in flow" />
          </Box>
        </Panel>
        <Panel title="Analyzer coverage" sub="Parsing coverage and static-analysis caveats that affect what the Analyzer can reconstruct.">
          <Chip size="small" color={d.failedFiles ? "warning" : "success"} variant="outlined" label={`${parsed} / ${total} parsed`} sx={{ mb: 1 }} />
          <LinearProgress variant="determinate" value={total ? (100 * parsed) / total : 100} sx={{ height: 6, borderRadius: 3, mb: 2 }} />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, mb: 1.5 }}>
            <Metric value={d.parsedFiles} label="Parsed files" />
            <Metric value={d.failedFiles} label="Failed files" />
            <Metric value={d.pythonBlocks} label="Python blocks" />
            <Metric value={d.dynamicRoutes} label="Dynamic routes" />
          </Box>
          <Typography variant="body2" color="text.secondary">
            {d.failedFiles ? `${d.failedFiles} script${d.failedFiles > 1 ? "s" : ""} couldn't be read, so some content may be missing. ` : "All scripts parsed. "}
            {d.dynamicRoutes
              ? `${d.dynamicRoutes} jump/call expression${d.dynamicRoutes > 1 ? "s" : ""} couldn't be resolved statically. `
              : "Static jump/call targets are all resolved. "}
            {d.unreachableLabels > 0 && `${d.unreachableLabels} label${d.unreachableLabels > 1 ? "s aren't" : " isn't"} reachable from an entry point. `}
            Runtime Python can still create behavior static analysis can't see.
          </Typography>
        </Panel>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}>
        <Panel title="Who talks the most" sub="Dialogue lines per character.">
          <Bars
            rows={index.characters.filter((c) => c.lines > 0).slice(0, 10).map((c) => ({
              key: c.id,
              label: (
                <>
                  <ColorDot color={c.color} />
                  <Link component="button" onClick={() => go("characters", { character: c.id })}>{c.name ?? c.id}</Link>
                </>
              ),
              value: c.lines,
            }))}
          />
        </Panel>
        <Panel title="Words per script" sub="Where the writing lives.">
          <Bars rows={index.files.filter((f) => f.words > 0).slice(0, 10).map((f) => ({ key: f.fileId, label: f.file.replace(/^game\//, ""), value: f.words }))} />
        </Panel>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Entry points: {entries.length ? entries.map((l, i) => <span key={l.name}>{i > 0 && ", "}<LabelLink name={l.name} /></span>) : "none found"}
        {missing.length > 0 && ` · undefined jump targets: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? ", …" : ""}`}
      </Typography>
    </Box>
  );
}
