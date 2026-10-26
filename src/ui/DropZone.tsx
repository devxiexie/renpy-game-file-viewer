import { Box, Typography } from "@mui/material";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { useRef, useState, type ReactNode } from "react";
import { filesFromDataTransfer } from "../core/vfs/collect";
import { useApp } from "../state/store";

/** Full-window drop target for game folders and files. */
export function DropZone({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const openFiles = useApp((s) => s.openFiles);
  const setLoading = useApp((s) => s.setLoading);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

  return (
    <Box
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setActive(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setActive(false);
      }}
      onDrop={async (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setActive(false);
        setLoading("Reading dropped files…");
        try {
          openFiles(await filesFromDataTransfer(e.dataTransfer));
        } finally {
          setLoading(null);
        }
      }}
      sx={{ position: "relative" }}
    >
      {children}
      {active && (
        <Box
          sx={{
            position: "fixed",
            inset: 12,
            zIndex: 2000,
            borderRadius: 3,
            border: "3px dashed",
            borderColor: "primary.main",
            bgcolor: "rgba(0,0,0,0.55)",
            color: "#fff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            pointerEvents: "none",
          }}
        >
          <FolderOpenIcon sx={{ fontSize: 64 }} />
          <Typography variant="h5">Drop to open</Typography>
          <Typography variant="body2">Files are read locally and never uploaded.</Typography>
        </Box>
      )}
    </Box>
  );
}
