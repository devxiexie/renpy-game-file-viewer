import { Box, Button, Chip, Paper, Stack, Typography } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { useState } from "react";
import { OpenUrlDialog } from "./OpenUrlDialog";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useOpenActions } from "./useOpenActions";

const FORMATS = [".rpa / .zip archives", ".rpyc scripts", ".rpy", ".save & persistent", "images", "audio", "video", "fonts"];

export function Welcome() {
  const { openFolder, openFilesDialog } = useOpenActions();
  const [urlOpen, setUrlOpen] = useState(false);
  return (
    <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 2 }}>
      <Paper variant="outlined" sx={{ maxWidth: 640, width: "100%", p: { xs: 3, sm: 5 }, textAlign: "center", borderStyle: "dashed", borderWidth: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: -0.5 }} gutterBottom>
          Open a Ren'Py game
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Drop a game folder or individual files anywhere on this page. Archives are browsed in place, compiled scripts are decompiled, and media previews right here.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 3, justifyContent: "center" }}>
          <Button size="large" variant="contained" startIcon={<FolderOpenIcon />} onClick={openFolder}>
            Open game folder
          </Button>
          <Button size="large" variant="outlined" startIcon={<InsertDriveFileOutlinedIcon />} onClick={openFilesDialog}>
            Open files
          </Button>
          <Button size="large" startIcon={<LinkIcon />} onClick={() => setUrlOpen(true)}>
            From URL
          </Button>
        </Stack>
        <OpenUrlDialog open={urlOpen} onClose={() => setUrlOpen(false)} />
        <Stack direction="row" sx={{ mb: 3, flexWrap: "wrap", justifyContent: "center", gap: 0.75 }}>
          {FORMATS.map((f) => (
            <Chip key={f} label={f} size="small" variant="outlined" />
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
          <LockOutlinedIcon fontSize="inherit" /> Everything runs in your browser. Files are never uploaded.
        </Typography>
      </Paper>
    </Box>
  );
}
