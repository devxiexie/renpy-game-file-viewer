import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useEffect, useMemo, useState } from "react";
import { compareText, comparisons, groupComparisons, type Comparison } from "../../features/analyzer/compare";
import type { Gate, VarRef, VariableCategory, VariableInfo } from "../../features/analyzer/model";
import { MONO } from "../theme";
import { LabelLink, SourceLink, useAnalyzer, useOpenSource } from "./context";
import { CardGrid, Pager, SearchField, SelectField, StatCard, StatRow, Toolbar, usePaged } from "./ui";

type Show = "useful" | "cheats" | "grind" | "targets" | "flags" | "relationships" | "resources" | "all";
type Sort = "useful" | "checked" | "changed" | "name";

const CATEGORY_LABEL: Record<VariableCategory, string> = {
  currency: "Currency",
  relationship: "Relationship",
  resource: "Resource",
  progress: "Progress",
  flag: "Flag",
  other: "Other",
};

const count = (v: VariableInfo, k: string) => v.refs.filter((r) => r.kind === k).length;

export function VariablesSection() {
  const { index, selection } = useAnalyzer();
  const [query, setQuery] = useState("");
  // Small games may have nothing that counts as "useful"; start with everything then.
  const [show, setShow] = useState<Show>(() =>
    index.variables.some((v) => v.category !== "flag" && v.declared !== "define" && v.score > 0) ? "useful" : "all",
  );
  const [sort, setSort] = useState<Sort>("useful");
  useEffect(() => {
    if (selection.variable) {
      setQuery(selection.variable);
      setShow("all");
    }
  }, [selection.variable]);

  const summary = useMemo(
    () => ({
      cheats: index.variables.filter((v) => v.tags.includes("worth-changing")).length,
      grind: index.variables.filter((v) => v.tags.includes("grind")).length,
      targets: index.variables.filter((v) => v.tags.includes("clear-target")).length,
      flags: index.variables.filter((v) => v.category === "flag").length,
    }),
    [index],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = index.variables.filter((v) => {
      switch (show) {
        case "useful":
          if (v.category === "flag" || v.declared === "define" || v.score <= 0) return false;
          break;
        case "cheats":
          if (!v.tags.includes("worth-changing")) return false;
          break;
        case "grind":
          if (!v.tags.includes("grind")) return false;
          break;
        case "targets":
          if (!v.tags.includes("clear-target")) return false;
          break;
        case "flags":
          if (v.category !== "flag") return false;
          break;
        case "relationships":
          if (v.category !== "relationship") return false;
          break;
        case "resources":
          if (!["currency", "resource", "progress"].includes(v.category)) return false;
          break;
      }
      return !q || v.name.toLowerCase().includes(q) || (v.initial ?? "").toLowerCase().includes(q);
    });
    const key: Record<Sort, (v: VariableInfo) => number | string> = {
      useful: (v) => -v.score,
      checked: (v) => -count(v, "condition"),
      changed: (v) => -count(v, "write"),
      name: (v) => v.name.toLowerCase(),
    };
    return [...list].sort((a, b) => (key[sort](a) < key[sort](b) ? -1 : key[sort](a) > key[sort](b) ? 1 : 0));
  }, [index, query, show, sort]);
  const paged = usePaged(items, 12);

  return (
    <Box>
      <StatRow>
        <StatCard value={summary.cheats} label="Useful cheats" sub="Likely worth changing" active={show === "cheats"} onClick={() => setShow("cheats")} />
        <StatCard value={summary.grind} label="Potential grind" sub="High targets, small increments" active={show === "grind"} onClick={() => setShow("grind")} />
        <StatCard value={summary.targets} label="Clear targets" sub="Numeric requirements" active={show === "targets"} onClick={() => setShow("targets")} />
        <StatCard value={summary.flags} label="State flags" sub="Shown separately" active={show === "flags"} onClick={() => setShow("flags")} />
      </StatRow>
      <Toolbar summary={`${items.length.toLocaleString()} of ${index.variables.length.toLocaleString()} variables`}>
        <SearchField value={query} onChange={setQuery} placeholder="Search game state (money, affection…)" />
        <SelectField
          label="Show"
          value={show}
          onChange={setShow}
          options={[
            ["useful", "Most useful game state"],
            ["cheats", "Useful cheats"],
            ["grind", "Potential grind"],
            ["targets", "Clear targets"],
            ["relationships", "Relationships"],
            ["resources", "Resources & progress"],
            ["flags", "State flags"],
            ["all", "All variables"],
          ]}
        />
        <SelectField label="Sort" value={sort} onChange={setSort} options={[["useful", "Most useful"], ["checked", "Most checked"], ["changed", "Most changed"], ["name", "Name"]]} />
      </Toolbar>
      {items.length === 0 && <Typography color="text.secondary">Nothing found with these filters. Try “All variables” to inspect technical state too.</Typography>}
      <Pager paged={paged as never} total={items.length} noun="variables" sizes={[12, 24, 48]} />
      <CardGrid min={360}>
        {paged.slice.map((v) => (
          <VariableCard key={v.name} v={v} />
        ))}
      </CardGrid>
      <Pager paged={paged as never} total={items.length} noun="variables" sizes={[12, 24, 48]} />
    </Box>
  );
}

function VariableCard({ v }: { v: VariableInfo }) {
  const [copied, setCopied] = useState(false);
  const [all, setAll] = useState(false);
  const decl = v.refs.find((r) => r.kind === "declare");
  const writes = v.refs.filter((r) => r.kind === "write");
  const compared = useMemo(() => comparisons(v), [v]);
  const f = v.facts;
  const target = f.needsAtLeast ?? (f.booleans ? "True" : null);
  const copy = async () => {
    if (!v.command) return;
    try {
      await navigator.clipboard.writeText(v.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  const shown = all ? writes : writes.slice(0, 3);
  return (
    <Paper variant="outlined" sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25, borderColor: v.tags.includes("worth-changing") ? "primary.main" : undefined }}>
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1 }}>
        <Typography sx={{ fontFamily: MONO, fontWeight: 800, fontSize: 17, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{v.name}</Typography>
        <Stack sx={{ gap: 0.5, alignItems: "flex-end" }}>
          <Chip size="small" color="primary" label={CATEGORY_LABEL[v.category]} />
          {v.tags.includes("grind") && <Chip size="small" variant="outlined" color="warning" label="Potential grind" />}
        </Stack>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {v.declared ?? "assigned in scripts"}
        {decl && <> · <SourceLink loc={decl.loc} /></>}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">Default</Typography>
          <Typography sx={{ fontFamily: MONO, fontWeight: 700 }} noWrap title={v.initial ?? ""}>{v.initial ?? "—"}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Target</Typography>
          <Typography sx={{ fontFamily: MONO, fontWeight: 700, color: "primary.main" }}>{target ?? "—"}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Changed</Typography>
          <Typography sx={{ fontFamily: MONO, fontWeight: 700 }}>{writes.length}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary">Compared</Typography>
          <Typography sx={{ fontFamily: MONO, fontWeight: 700 }}>{compared.length}</Typography>
        </Box>
      </Box>
      {v.command && (
        <Paper variant="outlined" sx={{ p: 1.25, bgcolor: "action.hover" }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary">Ren'Py console command</Typography>
              <Typography sx={{ fontFamily: MONO, fontWeight: 700, overflowWrap: "anywhere" }}>{v.command}</Typography>
            </Box>
            <Button size="small" variant="contained" startIcon={<ContentCopyIcon />} onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
            {f.needsAtLeast !== null
              ? "Highest clear lower-bound requirement found. This doesn't guarantee the game expects you to skip intermediate events."
              : v.category === "flag"
                ? "Sets the flag the story checks for."
                : "A generous value based on how the game uses it."}{" "}
            Open the console with Shift+O (developer mode must be enabled).
          </Typography>
        </Paper>
      )}
      {(f.needsAtLeast !== null || f.checkedAtMost !== null || f.assignedMax !== null || f.increments > 0) && (
        <Box>
          <Typography variant="caption" color="text.secondary">Observed numeric state</Typography>
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
            {f.needsAtLeast !== null && <Chip size="small" variant="outlined" label={`needs ≥ ${f.needsAtLeast}`} />}
            {f.checkedAtMost !== null && <Chip size="small" variant="outlined" label={`checked ≤ ${f.checkedAtMost}`} />}
            {f.assignedMax !== null && <Chip size="small" variant="outlined" label={`assigned up to ${f.assignedMax}`} />}
            {f.increments > 0 && <Chip size="small" variant="outlined" label={`increased ${f.increments}×${f.maxIncrement ? ` (max +${f.maxIncrement})` : ""}`} />}
            {f.decrements > 0 && <Chip size="small" variant="outlined" label={`decreased ${f.decrements}×`} />}
          </Stack>
        </Box>
      )}
      <Box>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Typography variant="subtitle2">Where it changes</Typography>
          <Typography variant="caption" color="text.secondary">{writes.length}</Typography>
        </Stack>
        {writes.length === 0 && <Typography variant="body2" color="text.secondary">No direct assignments found.</Typography>}
        {shown.map((r, i) => (
          <Stack key={i} direction="row" sx={{ alignItems: "center", gap: 0.75, py: 0.25 }}>
            <RefLocation r={r} />
            <Typography variant="body2" noWrap sx={{ fontFamily: MONO, fontSize: 12.5, color: "text.secondary", minWidth: 0 }}>{r.code.replace(v.name, "").trim()}</Typography>
          </Stack>
        ))}
        {writes.length > 3 && (
          <Button size="small" onClick={() => setAll(!all)} sx={{ px: 0 }}>{all ? "Show less" : `+${writes.length - 3} more`}</Button>
        )}
      </Box>
      <ComparedSection name={v.name} list={compared} />
    </Paper>
  );
}

function RefLocation({ r }: { r: VarRef }) {
  const openSource = useOpenSource();
  return (
    <>
      <Typography variant="body2" noWrap sx={{ flex: "0 1 auto", minWidth: 0 }}>
        {r.label ? <LabelLink name={r.label} /> : r.screen ? `screen ${r.screen}` : "init"} · line {r.loc.line}
      </Typography>
      <Box component="button" onClick={() => openSource(r.loc)} aria-label="Open source" sx={{ border: 0, bgcolor: "transparent", p: 0, cursor: "pointer", color: "primary.main", display: "flex", flexShrink: 0 }}>
        <OpenInNewIcon sx={{ fontSize: 15 }} />
      </Box>
    </>
  );
}

function GateText({ gate, kind }: { gate?: Gate; kind: VarRef["kind"] }) {
  if (!gate) return <>{kind === "read" ? "in code" : "condition"}</>;
  switch (gate.kind) {
    case "choice":
      return <>shows choice “{gate.text}”</>;
    case "loop":
      return <>while loop</>;
    case "screen":
      return <>{gate.showif ? "showif" : "if"} in screen</>;
    case "branch":
      return gate.targets.length ? (
        <>
          {gate.elif ? "elif" : "if"} → {gate.targets.map((t, i) => <span key={t}>{i > 0 && ", "}<LabelLink name={t} /></span>)}
        </>
      ) : (
        <>{gate.elif ? "elif" : "if"} branch</>
      );
  }
}

const testLabel = (name: string, c: Pick<Comparison, "op" | "value"> & { subject: string | null }) => `${c.subject && c.subject !== name ? `${c.subject} ` : ""}${compareText(c)}`;

/** Every place the variable is tested, with the operator and value, grouped by test. */
function ComparedSection({ name, list }: { name: string; list: Comparison[] }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const groups = useMemo(() => groupComparisons(name, list), [name, list]);
  const rows = filter ? (groups.find((g) => g.key === filter)?.items ?? []) : list;
  const shown = all ? rows : rows.slice(0, 3);
  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: "space-between" }}>
        <Typography variant="subtitle2">Where it's compared</Typography>
        <Typography variant="caption" color="text.secondary">{list.length}</Typography>
      </Stack>
      {list.length === 0 && <Typography variant="body2" color="text.secondary">Never tested in a condition.</Typography>}
      {groups.length > 1 && (
        <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", my: 0.5 }} role="group" aria-label={`Tests of ${name}`}>
          {groups.map((g) => (
            <Chip
              key={g.key}
              size="small"
              color="secondary"
              variant={filter === g.key ? "filled" : "outlined"}
              label={`${testLabel(name, g)}${g.items.length > 1 ? ` ×${g.items.length}` : ""}`}
              onClick={() => setFilter(filter === g.key ? null : g.key)}
              sx={{ fontFamily: MONO, fontSize: 12 }}
            />
          ))}
        </Stack>
      )}
      {shown.map((c, i) => (
        <Box key={i} sx={{ py: 0.4, borderTop: i ? 1 : 0, borderColor: "divider" }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 0.75, minWidth: 0 }}>
            <Chip size="small" color="secondary" label={testLabel(name, c)} sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, maxWidth: "50%" }} />
            <RefLocation r={c.ref} />
          </Stack>
          <Typography variant="caption" color="text.secondary" component="div" noWrap>
            <GateText gate={c.ref.gate} kind={c.ref.kind} />
            {" · "}
            <Box component="span" title={c.ref.code} sx={{ fontFamily: MONO }}>{c.ref.code}</Box>
          </Typography>
        </Box>
      ))}
      {rows.length > 3 && (
        <Button size="small" onClick={() => setAll(!all)} sx={{ px: 0 }}>{all ? "Show less" : `+${rows.length - 3} more`}</Button>
      )}
    </Box>
  );
}
