import { Alert, Box, Button, Chip, CircularProgress, List, ListItemButton, Paper, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import ReplayIcon from "@mui/icons-material/Replay";
import { useCallback, useEffect, useMemo, useState } from "react";
import { choose, decisionOptions, rewind, startPlayer, startPlayerAt, step, type PlayerEnv, type PlayerState } from "../../features/analyzer/player";
import type { LabelProgram, PStmt } from "../../features/analyzer/program";
import { xalignFor } from "../../features/analyzer/stage";
import { useApp } from "../../state/store";
import { engine } from "../../workers/client";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer } from "./context";
import { StageImage } from "./StageImage";

function stmtText(s: PStmt): string {
  switch (s.t) {
    case "python":
      return s.code.includes("\n") ? `python: ${s.code.split("\n")[0]} …` : `$ ${s.code}`;
    case "other":
      return s.text;
    case "call":
      return `call ${s.target}${s.dynamic ? " (expression)" : ""}`;
    case "jump":
      return `jump ${s.target}`;
    default:
      return s.t;
  }
}

/** Steps through a label like a reader would, stopping at every line and decision. */
export function LabelPlayer({ label, line, onClose }: { label: string; /** Start at this line instead of the top. */ line?: number; onClose(): void }) {
  const { index, catalog, go } = useAnalyzer();
  const tree = useApp((s) => s.tree);
  const [programs] = useState(() => new Map<string, LabelProgram>());
  const [state, setState] = useState<PlayerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const labels = useMemo(() => new Map(index.labels.map((l) => [l.name, l])), [index]);
  const names = useMemo(() => new Map(index.characters.map((c) => [c.id, { name: c.name ?? c.id, color: c.color }])), [index]);

  const env: PlayerEnv = useMemo(
    () => ({
      programs,
      catalog,
      fallthrough: (l) => index.edges.find((e) => e.from === l && e.kind === "fallthrough")?.to ?? null,
    }),
    [programs, catalog, index],
  );

  const load = useCallback(
    async (name: string): Promise<boolean> => {
      if (programs.has(name)) return true;
      const info = labels.get(name);
      const node = info ? tree.get(info.loc.fileId) : undefined;
      if (!info || !node?.source) return false;
      const prog = await engine().labelProgram(info.loc.fileId, node.source, name);
      if (prog) programs.set(name, prog);
      return !!prog;
    },
    [programs, labels, tree],
  );

  // Resolve labels the player is waiting for, then keep stepping.
  const settle = useCallback(
    async (s: PlayerState): Promise<PlayerState> => {
      let cur = s;
      for (let i = 0; i < 50 && cur.waitingFor; i++) {
        const ok = await load(cur.waitingFor);
        if (!ok) return { ...cur, ended: "end", current: null };
        cur = step(cur, env);
      }
      return cur;
    },
    [load, env],
  );

  const [from, setFrom] = useState(line);
  const restart = useCallback(async () => {
    setError(null);
    setState(null);
    try {
      if (!(await load(label))) throw new Error(`Couldn't load label ${label}.`);
      const bg = labels.get(label)?.background ?? null;
      setState(await settle(from !== undefined ? startPlayerAt(label, from, env, { background: bg }) : startPlayer(label, env, { background: bg })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [label, from, load, settle, env, labels]);

  useEffect(() => {
    void restart();
  }, [restart]);

  const next = useCallback(async () => {
    if (state && !state.decision && !state.ended) setState(await settle(step(state, env)));
  }, [state, settle, env]);
  const pick = async (i: number) => {
    if (state) {
      setCompare(false);
      setState(await settle(choose(state, i, env)));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === " " || e.key === "Enter" || e.key === "ArrowRight") && !(e.target as HTMLElement).closest("input,textarea,button")) {
        e.preventDefault();
        void next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);

  const cur = state?.current;
  const decision = state?.decision;
  const options = decision ? decisionOptions(decision) : [];
  const menuInfo = decision?.kind === "menu" ? index.menus.find((m) => m.label === decision.label && m.loc.line === decision.stmt.line) : undefined;
  const currentInfo = state ? labels.get(state.label) : undefined;
  const loc = (line: number) => (currentInfo ? { ...currentInfo.loc, line } : null);

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <Button startIcon={<ArrowBackIcon />} onClick={onClose}>Labels</Button>
        <Typography variant="h6" sx={{ fontFamily: MONO, fontWeight: 800 }}>{label}</Typography>
        {state && state.label !== label && <Chip size="small" label={<>now in <b>{state.label}</b></>} />}
        {from !== undefined && <Chip size="small" variant="outlined" label={`started at line ${from}`} onDelete={() => setFrom(undefined)} />}
        <Box sx={{ ml: "auto" }} />
        <Button size="small" startIcon={<ReplayIcon />} onClick={() => void restart()}>Restart</Button>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {!state && !error && <CircularProgress />}
      {state && (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 340px" }, gap: 2 }}>
          <Box>
            <Box sx={{ position: "relative", aspectRatio: "16 / 9", bgcolor: "#111", borderRadius: 1.5, overflow: "hidden" }}>
              {state.background && <StageImage name={state.background} fit="cover" />}
              {state.sprites.map((s) => (
                <Box key={s.tag} title={s.image} sx={{ position: "absolute", bottom: 0, height: "92%", width: "42%", left: `${xalignFor(s.at) * 58}%` }}>
                  <StageImage name={s.image} />
                </Box>
              ))}
              {decision ? (
                <Box sx={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, bgcolor: "rgba(0,0,0,.45)", p: 2 }}>
                  <Typography sx={{ color: "#fff", fontWeight: 700 }}>
                    {decision.kind === "menu" ? (decision.stmt.t === "menu" && decision.stmt.caption?.what) || "Choose an option" : "This depends on a condition — pick the branch to follow"}
                  </Typography>
                  {options.map((o, i) => (
                    <Button key={i} variant="contained" color={decision.kind === "menu" ? "primary" : "inherit"} onClick={() => void pick(i)} sx={{ minWidth: { xs: "90%", sm: 380 }, justifyContent: "flex-start", textAlign: "left" }}>
                      {o.text}
                      {decision.kind === "menu" && o.condition && <Box component="span" sx={{ ml: 1, opacity: 0.75, fontFamily: MONO, fontSize: 12 }}>if {o.condition}</Box>}
                    </Button>
                  ))}
                  {decision.kind === "menu" && (
                    <Button size="small" sx={{ color: "#fff" }} onClick={() => setCompare(!compare)}>
                      {compare ? "Hide" : "Compare branches"}
                    </Button>
                  )}
                </Box>
              ) : cur?.t === "say" ? (
                <Box onClick={() => void next()} sx={{ position: "absolute", left: "4%", right: "4%", bottom: "4%", bgcolor: "rgba(0,0,0,.75)", color: "#fff", borderRadius: 1.5, p: { xs: 1.25, sm: 2 }, cursor: "pointer" }}>
                  {cur.who && (
                    <Typography sx={{ fontWeight: 800, color: names.get(cur.who)?.color ?? "#ffcc88", fontSize: { xs: 13, sm: 16 } }}>{names.get(cur.who)?.name ?? cur.who}</Typography>
                  )}
                  <Typography sx={{ fontSize: { xs: 13, sm: 17 } }}>{cur.what}</Typography>
                </Box>
              ) : state.ended ? (
                <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", bgcolor: "rgba(0,0,0,.55)" }}>
                  <Typography sx={{ color: "#fff", fontWeight: 700 }}>
                    {state.ended === "return" ? "Route ends here (return)." : state.ended === "dynamic" ? "The game jumps to a label computed at runtime — static preview stops here." : "End of this route."}
                  </Typography>
                </Box>
              ) : null}
            </Box>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1, mt: 1, flexWrap: "wrap" }}>
              <Button variant="contained" endIcon={<NavigateNextIcon />} onClick={() => void next()} disabled={!!decision || !!state.ended}>
                Next line
              </Button>
              <Typography variant="caption" color="text.secondary">
                Space / Enter to advance · {state.steps} lines read
                {state.transition && ` · with ${state.transition}`}
              </Typography>
              {cur && <Box sx={{ ml: "auto" }}><SourceLink loc={loc(cur.line)} /></Box>}
            </Stack>
            {compare && menuInfo && (
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: `repeat(${Math.min(3, menuInfo.items.length)}, 1fr)` }, gap: 1, mt: 1.5 }}>
                {menuInfo.items.map((it, i) => (
                  <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="subtitle2">{i + 1}. {it.text}</Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      ~{it.uniqueLines} exclusive lines · {it.writes.length} state change{it.writes.length === 1 ? "" : "s"} · {it.visuals.length} visuals
                    </Typography>
                    <Typography variant="caption" component="div">
                      {it.outcome === "rejoins" ? <>Rejoins at <LabelLink name={it.rejoin!} /></> : it.outcome === "distinct" ? "Continues on a distinct branch" : "Continues in the shared story flow"}
                    </Typography>
                    <Button size="small" onClick={() => void pick(i)}>Take this branch</Button>
                  </Paper>
                ))}
              </Box>
            )}
            {state.passed.length > 0 && (
              <Paper variant="outlined" sx={{ p: 1.5, mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary">Also ran (not executed in the preview)</Typography>
                {state.passed.map((p, i) => (
                  <Typography key={i} variant="body2" sx={{ fontFamily: MONO, fontSize: 12.5 }} noWrap>{stmtText(p)}</Typography>
                ))}
              </Paper>
            )}
          </Box>
          <Stack spacing={1.5}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2">Choices made</Typography>
              {state.history.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No choices yet.</Typography>
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">Click a choice to rewind to that branch and choose again.</Typography>
                  <List dense disablePadding>
                    {state.history.map((h, i) => (
                      <ListItemButton key={i} onClick={() => setState(rewind(state, i))} sx={{ borderRadius: 1 }}>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{h.chosen}</Typography>
                          <Typography variant="caption" color="text.secondary">{h.kind === "menu" ? "Menu" : "Condition"} in {h.label}:{h.line}</Typography>
                        </Box>
                      </ListItemButton>
                    ))}
                  </List>
                </>
              )}
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2">Visible images</Typography>
              {state.background && <Chip size="small" label={`bg: ${state.background}`} onClick={() => go("visuals", { image: state.background! })} sx={{ m: 0.25 }} />}
              {state.sprites.map((s) => (
                <Chip key={s.tag} size="small" variant="outlined" label={`${s.image}${s.at.length ? ` at ${s.at.join(", ")}` : ""}`} onClick={() => go("visuals", { image: s.image })} sx={{ m: 0.25 }} />
              ))}
              {!state.background && state.sprites.length === 0 && <Typography variant="body2" color="text.secondary">Nothing on screen.</Typography>}
            </Paper>
            {currentInfo && (
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2">Current label</Typography>
                <Typography variant="body2" sx={{ fontFamily: MONO }}>{currentInfo.name}</Typography>
                <Typography variant="caption" color="text.secondary" component="div">
                  {currentInfo.dialogue} lines · {currentInfo.menus} menus · <SourceLink loc={currentInfo.loc} />
                </Typography>
                <Typography variant="caption" component="div" sx={{ mt: 0.5 }}>
                  Leads to:{" "}
                  {[...new Set(index.edges.filter((e) => e.from === currentInfo.name && !e.dynamic).map((e) => e.to))].map((t, i) => (
                    <span key={t}>{i > 0 && ", "}<LabelLink name={t} /></span>
                  ))}
                </Typography>
              </Paper>
            )}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
