import { Box, CssBaseline, LinearProgress, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { useApp } from "../state/store";
import { DropZone } from "./DropZone";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { theme } from "./theme";
import { MainTabs } from "./MainTabs";
import { Welcome } from "./Welcome";

export function App() {
  const hasFiles = useApp((s) => s.tree.roots.length > 0 && s.revision >= 0);
  const loading = useApp((s) => s.loading);
  const pane = useApp((s) => s.mobilePane);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <DropZone>
        <Box sx={{ height: "100dvh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
          <TopBar />
          {loading && (
            <Box>
              <LinearProgress />
              <Typography variant="caption" sx={{ px: 2, color: "text.secondary" }}>
                {loading}
              </Typography>
            </Box>
          )}
          {hasFiles ? (
            <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: { xs: "column", md: "row" } }}>
              <Box sx={{ display: { xs: pane === "files" ? "flex" : "none", md: "flex" }, flex: { xs: 1, md: "none" }, minHeight: 0 }}>
                <Sidebar />
              </Box>
              <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: { xs: pane === "main" ? "flex" : "none", md: "flex" }, flexDirection: "column" }}>
                <MainTabs />
              </Box>
            </Box>
          ) : (
            <Welcome />
          )}
        </Box>
      </DropZone>
    </ThemeProvider>
  );
}
