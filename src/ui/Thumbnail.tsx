import { Box } from "@mui/material";
import { useEffect, useState } from "react";
import type { TreeNode } from "../core/vfs/tree";
import { canThumbnail, thumbnailUrl } from "../features/thumbs/thumbs";
import { FileIcon } from "./fileIcons";

const CHECKER = "repeating-conic-gradient(rgba(128,128,128,.16) 0% 25%, transparent 0% 50%) 50% / 12px 12px";

/** Square thumbnail for a node: rendered preview for images/videos, a file-type icon otherwise. */
export function Thumbnail({ node, size, open }: { node: TreeNode; size: number; open?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!canThumbnail(node)) return;
    let alive = true;
    void thumbnailUrl(node).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [node]);
  return (
    <Box
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 1,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: url ? CHECKER : undefined,
        bgcolor: url ? undefined : "action.hover",
        "& svg": { fontSize: Math.max(18, size * 0.45) },
      }}
    >
      {url ? <img src={url} alt="" loading="lazy" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <FileIcon node={node} open={open} />}
    </Box>
  );
}
