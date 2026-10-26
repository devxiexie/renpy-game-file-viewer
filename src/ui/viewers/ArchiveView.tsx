import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import type { TreeNode } from "../../core/vfs/tree";
import { useApp } from "../../state/store";
import { FolderView } from "./FolderView";

export function ArchiveView({ node }: { node: TreeNode }) {
  const expandArchive = useApp((s) => s.expandArchive);
  useApp((s) => s.revision);
  const a = node.archive;
  if (a?.status === "ready") {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Alert severity="success" sx={{ m: 2, mb: 0 }}>
          {a.version} archive with {a.entryCount?.toLocaleString()} files. Browse them in the tree, or use Export to extract.
        </Alert>
        <FolderView node={node} />
      </Box>
    );
  }
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
        {node.name}
      </Typography>
      {a?.status === "error" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {a.error}
        </Alert>
      )}
      {a?.status === "loading" ? (
        <CircularProgress />
      ) : (
        <Button variant="contained" onClick={() => expandArchive(node.id, true)}>
          Open archive
        </Button>
      )}
    </Box>
  );
}
