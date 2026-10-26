import { Box, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import CallSplitIcon from "@mui/icons-material/CallSplit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import RuleIcon from "@mui/icons-material/Rule";
import { useMemo } from "react";
import { routeDecisions, routeRequirements, viaText, type Route } from "../../features/analyzer/guide";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer } from "./context";

/** The decisions along a route: options to pick and conditions to pass, in order. */
export function RouteSteps({ route, target }: { route: Route; target: string }) {
  const steps = routeDecisions(route);
  return (
    <Box>
      <Typography variant="body2" sx={{ mb: 0.75 }}>
        From <LabelLink name={route.start} /> to <LabelLink name={target} />: {route.edges.length} jump{route.edges.length === 1 ? "" : "s"},{" "}
        {steps.length ? `${steps.length} decision${steps.length === 1 ? "" : "s"}` : "no decisions needed"}.
      </Typography>
      <Stack component="ol" spacing={0.75} sx={{ m: 0, pl: 0, listStyle: "none" }}>
        {steps.map((s, i) => (
          <Stack key={i} component="li" direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <Box sx={{ width: 22, height: 22, borderRadius: "50%", bgcolor: s.via.kind === "choice" ? "primary.main" : "warning.main", color: "#fff", fontSize: 11.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.25 }}>
              {i + 1}
            </Box>
            <Box sx={{ minWidth: 0 }}>
              {s.via.kind === "choice" ? (
                <Typography variant="body2">
                  <CallSplitIcon sx={{ fontSize: 15, verticalAlign: "text-bottom", mr: 0.5 }} />
                  Choose <b>“{s.via.text}”</b>
                  {s.via.condition && <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, color: "warning.main" }}> (only if {s.via.condition})</Box>}
                </Typography>
              ) : (
                <Typography variant="body2">
                  <RuleIcon sx={{ fontSize: 15, verticalAlign: "text-bottom", mr: 0.5 }} />
                  Needs <Box component="code" sx={{ fontFamily: MONO, fontSize: 12.5 }}>{viaText(s.via)}</Box>
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary">
                in <LabelLink name={s.label} /> · <SourceLink loc={s.edge.loc} />
              </Typography>
            </Box>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}

/** Variables the route's conditions test, with the choices that change them and a console command. */
export function RouteRequirements({ route }: { route: Route }) {
  const { index, go } = useAnalyzer();
  const reqs = useMemo(() => routeRequirements(index, route), [index, route]);
  if (!reqs.length) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2">Requirements</Typography>
      <Stack spacing={1} sx={{ mt: 0.5 }}>
        {reqs.map((r) => (
          <Box key={r.variable.name} sx={{ borderLeft: 2, borderColor: "warning.main", pl: 1 }}>
            <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Chip size="small" variant="outlined" label={r.variable.name} onClick={() => go("variables", { variable: r.variable.name })} sx={{ fontFamily: MONO }} />
              {r.conditions.map((c) => (
                <Typography key={c} variant="caption" sx={{ fontFamily: MONO }}>{c}</Typography>
              ))}
              {r.variable.command && (
                <Tooltip title="Copy console command (Shift+O in game)">
                  <Chip
                    size="small"
                    icon={<ContentCopyIcon />}
                    label={r.variable.command}
                    onClick={() => void navigator.clipboard?.writeText(r.variable.command!).catch(() => {})}
                    sx={{ fontFamily: MONO }}
                  />
                </Tooltip>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary" component="div">
              {r.changedBy.length === 0 ? (
                r.variable.initial ? `Starts as ${r.variable.initial}; no choice changes it directly.` : "No choice changes it directly (it may be set by Python)."
              ) : (
                <>
                  Changed by:{" "}
                  {r.changedBy.slice(0, 6).map((c, i) => (
                    <span key={i}>
                      {i > 0 && " · "}“{c.menu.items[c.item].text}”{c.menu.label && <> in <LabelLink name={c.menu.label} /></>}
                    </span>
                  ))}
                  {r.changedBy.length > 6 && ` · +${r.changedBy.length - 6} more`}
                </>
              )}
            </Typography>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={() => void navigator.clipboard?.writeText(text).catch(() => {})}>
        <ContentCopyIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}
