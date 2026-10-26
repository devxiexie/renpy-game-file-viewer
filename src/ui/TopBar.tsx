import { AppBar, Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Toolbar, Tooltip, Typography } from "@mui/material";
import BuildOutlinedIcon from "@mui/icons-material/BuildOutlined";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
import CompressIcon from "@mui/icons-material/Compress";
import InsightsIcon from "@mui/icons-material/Insights";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import LinkIcon from "@mui/icons-material/Link";
import TranslateIcon from "@mui/icons-material/Translate";
import CloseIcon from "@mui/icons-material/Close";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import IosShareIcon from "@mui/icons-material/IosShare";
import { useState } from "react";
import { useApp, type ToolId } from "../state/store";
import { BarButton } from "./BarButton";
import { ExportDialog } from "./ExportDialog";
import { OpenUrlDialog } from "./OpenUrlDialog";
import { useOpenActions } from "./useOpenActions";

export function TopBar() {
  const hasFiles = useApp((s) => s.tree.roots.length > 0 && s.revision >= 0);
  const closeAll = useApp((s) => s.closeAll);
  const { openFolder, openFilesDialog } = useOpenActions();
  const [exportOpen, setExportOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [toolsAnchor, setToolsAnchor] = useState<HTMLElement | null>(null);
  const openTool = useApp((s) => s.openTool);
  const pick = (t: ToolId) => {
    setToolsAnchor(null);
    openTool(t);
  };

  return (
    <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      <Toolbar variant="dense" sx={{ gap: { xs: 0.25, sm: 1 }, flexWrap: "wrap" }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mr: "auto" }}>
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: -0.5 }}>
            RPV
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            Ren'Py Resources Viewer
          </Typography>
        </Box>
        <BarButton icon={<FolderOpenIcon />} label="Open folder" onClick={openFolder} />
        <BarButton icon={<InsertDriveFileOutlinedIcon />} label="Open files" onClick={openFilesDialog} />
        <BarButton icon={<LinkIcon />} label="Open URL" onClick={() => setUrlOpen(true)} />
        {hasFiles && (
          <>
            <BarButton icon={<BuildOutlinedIcon />} label="Tools" onClick={(e) => setToolsAnchor(e.currentTarget)} aria-haspopup="menu" />
            <Menu anchorEl={toolsAnchor} open={!!toolsAnchor} onClose={() => setToolsAnchor(null)}>
              <MenuItem onClick={() => pick("analyzer")}>
                <ListItemIcon><InsightsIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Ren'Py Analyzer" secondary="Story, characters, visuals, choices, variables" />
              </MenuItem>
              <MenuItem onClick={() => pick("compare")}>
                <ListItemIcon><CompareArrowsIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Compare files" secondary="Diff two builds of a game" />
              </MenuItem>
              <MenuItem onClick={() => pick("translate")}>
                <ListItemIcon><TranslateIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Translation" secondary="Translate and export a tl patch" />
              </MenuItem>
              <MenuItem onClick={() => pick("compress")}>
                <ListItemIcon><CompressIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Compress RPA" secondary="Re-encode images as WebP" />
              </MenuItem>
              <MenuItem onClick={() => pick("merge")}>
                <ListItemIcon><LayersOutlinedIcon fontSize="small" /></ListItemIcon>
                <ListItemText primary="Merge images" secondary="Stack sprite layers" />
              </MenuItem>
            </Menu>
            <BarButton icon={<IosShareIcon />} label="Export" variant="contained" onClick={() => setExportOpen(true)} />
            <Tooltip title="Close all files">
              <IconButton size="small" onClick={closeAll} aria-label="Close all files">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Toolbar>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <OpenUrlDialog open={urlOpen} onClose={() => setUrlOpen(false)} />
    </AppBar>
  );
}
