import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import type { ReactNode } from "react";
import { useApp } from "../../state/store";
import { BackToFiles } from "../BackToFiles";

export function ToolHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: ReactNode }) {
  const closeTab = useApp((s) => s.closeTab);
  const activeKey = useApp((s) => s.activeKey);
  return (
    <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
      <BackToFiles />
      <Box sx={{ mr: "auto", minWidth: 0, flex: { xs: "1 1 0", sm: "0 1 auto" } }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            {subtitle}
          </Typography>
        )}
      </Box>
      {children}
      <Tooltip title="Close tool">
        <IconButton size="small" onClick={() => activeKey && closeTab(activeKey)} aria-label="Close tool">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
