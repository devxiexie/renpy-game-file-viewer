import { IconButton, Tooltip } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import { useApp } from "../state/store";

/** Shown on small screens, where the file list and the viewer are separate panes. */
export function BackToFiles() {
  const setPane = useApp((s) => s.setMobilePane);
  return (
    <Tooltip title="Back to files">
      <IconButton size="small" onClick={() => setPane("files")} aria-label="Back to files" sx={{ display: { md: "none" } }}>
        <ArrowBackIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
