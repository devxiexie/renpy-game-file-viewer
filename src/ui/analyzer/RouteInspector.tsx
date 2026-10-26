import { Alert, Autocomplete, Box, Button, Chip, Paper, Stack, TextField, Typography } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useMemo, useState } from "react";
import type { EdgeKind } from "../../features/analyzer/model";
import { shortestRoute } from "../../features/analyzer/route";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer } from "./context";

const KINDS: [EdgeKind, string][] = [
  ["jump", "Jumps"],
  ["call", "Calls"],
  ["fallthrough", "Fall-through"],
];

export function RouteInspector({ onPlay }: { onPlay(label: string): void }) {
  const { index } = useAnalyzer();
  const names = useMemo(() => index.labels.map((l) => l.name), [index]);
  const defaultStart = index.labels.find((l) => l.name === "start")?.name ?? index.labels.find((l) => l.entry)?.name ?? names[0] ?? "";
  const [from, setFrom] = useState(defaultStart);
  const [to, setTo] = useState<string | null>(null);
  const [kinds, setKinds] = useState<Set<EdgeKind>>(new Set(["jump", "call", "fallthrough"]));
  const [conditional, setConditional] = useState(true);
  const route = useMemo(() => (to ? shortestRoute(index, from, to, { kinds, conditional }) : undefined), [index, from, to, kinds, conditional]);
  const toggle = (k: EdgeKind) => setKinds((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 800 }}>Route inspector</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Choose a destination to see the shortest static path to it.</Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 1.5 }}>
        <Autocomplete size="small" options={names} value={from} disableClearable onChange={(_, v) => setFrom(v)} renderInput={(p) => <TextField {...p} label="From" />} sx={{ flex: 1 }} />
        <Autocomplete size="small" options={names} value={to} onChange={(_, v) => setTo(v)} renderInput={(p) => <TextField {...p} label="Destination" />} sx={{ flex: 1 }} />
      </Stack>
      <Stack direction="row" sx={{ gap: 0.75, flexWrap: "wrap", mb: 2 }}>
        {KINDS.map(([k, l]) => (
          <Chip key={k} label={l} color={kinds.has(k) ? "primary" : "default"} variant={kinds.has(k) ? "filled" : "outlined"} onClick={() => toggle(k)} />
        ))}
        <Chip label="Conditional links" color={conditional ? "primary" : "default"} variant={conditional ? "filled" : "outlined"} onClick={() => setConditional(!conditional)} />
      </Stack>
      {to && route === null && (
        <Alert severity="warning">No static route found with these link types. Dynamic Python or expression-based jumps may still reach this label.</Alert>
      )}
      {to && route && route.length === 0 && <Alert severity="info">Source and destination are the same label.</Alert>}
      {route && route.length > 0 && (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>{route.length} step{route.length > 1 ? "s" : ""} on the shortest static route:</Typography>
          <Stack spacing={0.75}>
            {[from, ...route.map((e) => e.to)].map((label, i) => {
              const e = route[i - 1];
              return (
                <Box key={`${label}-${i}`}>
                  {e && (
                    <Typography variant="caption" color="text.secondary" sx={{ pl: 2, display: "block" }}>
                      ↓ {e.kind}{e.conditional ? " (inside a branch)" : ""} · <SourceLink loc={e.loc} />
                    </Typography>
                  )}
                  <Paper variant="outlined" sx={{ p: 1, display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography sx={{ fontFamily: MONO, fontWeight: 700 }}><LabelLink name={label} /></Typography>
                    <Button size="small" startIcon={<PlayArrowIcon />} onClick={() => onPlay(label)} sx={{ ml: "auto" }}>Explore</Button>
                  </Paper>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
    </Paper>
  );
}
