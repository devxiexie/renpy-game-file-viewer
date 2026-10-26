import { Box, IconButton, Tab, Tabs, Tooltip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import { useEffect, useState } from "react";
import { useApp, type MainTab, type ToolId } from "../state/store";
import { AnalyzerHelp } from "./analyzer/AnalyzerHelp";
import { AnalyzerTool } from "./analyzer/AnalyzerTool";
import { CompareTool } from "./tools/CompareTool";
import { CompressTool } from "./tools/CompressTool";
import { MergeTool } from "./tools/MergeTool";
import { TranslateTool } from "./tools/TranslateTool";
import { Viewer } from "./viewers/Viewer";

const TOOL_LABEL: Record<ToolId, string> = {
  analyzer: "Ren'Py Analyzer",
  compare: "Compare files",
  translate: "Translation",
  compress: "Compress RPA",
  merge: "Merge images",
};

const TOOLS: Record<ToolId, () => React.ReactElement> = {
  analyzer: () => <AnalyzerTool />,
  compare: () => <CompareTool />,
  translate: () => <TranslateTool />,
  compress: () => <CompressTool />,
  merge: () => <MergeTool />,
};

function useTabLabel(tab: MainTab): string {
  const tree = useApp((s) => s.tree);
  useApp((s) => s.revision);
  if (tab.kind === "tool") return TOOL_LABEL[tab.tool];
  if (tab.kind === "help") return "Help: Ren'Py Analyzer";
  return tab.nodeId ? (tree.get(tab.nodeId)?.name ?? "File") : "New tab";
}

function TabLabel({ tab }: { tab: MainTab }) {
  const label = useTabLabel(tab);
  const closeTab = useApp((s) => s.closeTab);
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, maxWidth: 220 }}>
      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</Box>
      <Box
        component="span"
        role="button"
        aria-label={`Close ${label}`}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          closeTab(tab.key);
        }}
        sx={{ display: "inline-flex", borderRadius: 1, p: 0.25, "&:hover": { bgcolor: "action.hover" } }}
      >
        <CloseIcon sx={{ fontSize: 14 }} />
      </Box>
    </Box>
  );
}

/** Tab bar + panels for the main area: file tabs, tool tabs (kept mounted) and help. */
export function MainTabs() {
  const tabs = useApp((s) => s.tabs);
  const activeKey = useApp((s) => s.activeKey);
  const activateTab = useApp((s) => s.activateTab);
  const newTab = useApp((s) => s.newTab);
  // Tool tabs stay mounted once opened so their state survives switching tabs.
  const [mounted, setMounted] = useState<string[]>([]);
  useEffect(() => {
    const active = tabs.find((t) => t.key === activeKey);
    if (active && active.kind !== "file" && !mounted.includes(active.key)) setMounted((m) => [...m, active.key]);
    const keys = new Set(tabs.map((t) => t.key));
    if (mounted.some((k) => !keys.has(k))) setMounted((m) => m.filter((k) => keys.has(k)));
  }, [tabs, activeKey, mounted]);

  const active = tabs.find((t) => t.key === activeKey) ?? null;
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {tabs.length > 0 && (
        <Box sx={{ display: "flex", alignItems: "center", borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
          <Tabs
            value={active?.key ?? false}
            onChange={(_, k: string) => activateTab(k)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ minHeight: 38, flex: 1, minWidth: 0, "& .MuiTab-root": { minHeight: 38, py: 0, px: 1.5, textTransform: "none", fontSize: 13 } }}
            aria-label="Open tabs"
          >
            {tabs.map((t) => (
              <Tab key={t.key} value={t.key} label={<TabLabel tab={t} />} />
            ))}
          </Tabs>
          <Tooltip title="New tab">
            <IconButton size="small" onClick={newTab} aria-label="New tab" sx={{ mx: 0.5 }}>
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        {(!active || active.kind === "file") && <Viewer key={active?.key ?? "none"} nodeId={active ? active.nodeId : undefined} />}
        {active?.kind === "help" && <AnalyzerHelp />}
        {tabs
          .filter((t): t is Extract<MainTab, { kind: "tool" }> => t.kind === "tool" && mounted.includes(t.key))
          .map((t) => (
            <Box key={t.key} sx={{ display: t.key === activeKey ? "flex" : "none", flex: 1, minHeight: 0, flexDirection: "column" }}>
              {TOOLS[t.tool]()}
            </Box>
          ))}
      </Box>
    </Box>
  );
}
