import { Box, Tab, Tabs } from "@mui/material";
import { useApp, type SidePanel } from "../state/store";
import { FileTreeView } from "./FileTreeView";
import { SearchPanel } from "./SearchPanel";

export function Sidebar() {
  const panel = useApp((s) => s.panel);
  const setPanel = useApp((s) => s.setPanel);
  return (
    <Box
      component="aside"
      sx={{
        width: { xs: "100%", md: 360 },
        flexShrink: 0,
        borderRight: { md: 1 },
        borderColor: "divider",
        bgcolor: "background.paper",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Tabs value={panel} onChange={(_, v: SidePanel) => setPanel(v)} variant="fullWidth" sx={{ minHeight: 40, borderBottom: 1, borderColor: "divider", "& .MuiTab-root": { minHeight: 40 } }}>
        <Tab value="files" label="Files" />
        <Tab value="search" label="Search" />
      </Tabs>
      <Box sx={{ flex: 1, minHeight: 0, display: panel === "files" ? "flex" : "none", flexDirection: "column" }}>
        <FileTreeView />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: panel === "search" ? "flex" : "none", flexDirection: "column" }}>
        <SearchPanel />
      </Box>
    </Box>
  );
}
