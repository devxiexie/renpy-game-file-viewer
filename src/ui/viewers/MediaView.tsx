import { Alert, Box, CircularProgress } from "@mui/material";
import { useState } from "react";
import { kindOf, mimeOf } from "../../core/files/types";
import type { TreeNode } from "../../core/vfs/tree";
import { useObjectUrl } from "./useObjectUrl";

export function MediaView({ node }: { node: TreeNode }) {
  const { url, error } = useObjectUrl(node.source, mimeOf(node.name));
  const [failed, setFailed] = useState(false);
  const video = kindOf(node.name) === "video";
  if (error) return <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>;
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", p: 2, bgcolor: video ? "#000" : undefined }}>
      {!url && <CircularProgress />}
      {failed && <Alert severity="warning">Your browser can't play this file. Use Download to save it.</Alert>}
      {url && !failed &&
        (video ? (
          <video src={url} controls style={{ maxWidth: "100%", maxHeight: "100%" }} onError={() => setFailed(true)} />
        ) : (
          <audio src={url} controls style={{ width: "min(560px, 100%)" }} onError={() => setFailed(true)} />
        ))}
    </Box>
  );
}
