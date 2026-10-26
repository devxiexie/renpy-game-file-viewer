import { Box, Breadcrumbs, Button, Chip, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { formatBytes, kindOf, mimeOf } from "../../core/files/types";
import { sourceToBlob } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";
import { downloadBlob } from "../../features/export/export";
import { useApp, useSelectedNode } from "../../state/store";
import { BackToFiles } from "../BackToFiles";
import { ArchiveView } from "./ArchiveView";
import { FolderView } from "./FolderView";
import { FontView } from "./FontView";
import { HexView } from "./HexView";
import { ImageView } from "./ImageView";
import { MediaView } from "./MediaView";
import { SaveView } from "./SaveView";
import { RpycView, TextFileView } from "./TextViews";

export function Viewer({ nodeId }: { nodeId?: string | null }) {
  const selected = useSelectedNode();
  const tree = useApp((s) => s.tree);
  useApp((s) => s.revision);
  const node = nodeId === undefined ? selected : nodeId ? (tree.get(nodeId) ?? null) : null;
  if (!node) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 3, gap: 1 }}>
        <BackToFiles />
        <Typography color="text.secondary">Select a file to preview it.</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ViewerHeader node={node} />
      <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <ViewerBody key={node.id} node={node} />
      </Box>
    </Box>
  );
}

function ViewerHeader({ node }: { node: TreeNode }) {
  const tree = useApp((s) => s.tree);
  const select = useApp((s) => s.select);
  const crumbs: TreeNode[] = [];
  for (let n: TreeNode | undefined = node; n; n = n.parentId ? tree.get(n.parentId) : undefined) crumbs.unshift(n);
  const archive = node.archiveId ? tree.get(node.archiveId) : undefined;

  return (
    <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
      <BackToFiles />
      <Breadcrumbs maxItems={5} sx={{ flex: 1, minWidth: 0, fontSize: 13, "& ol": { flexWrap: "nowrap" }, "& li": { minWidth: 0 } }}>
        {crumbs.map((c, i) =>
          i === crumbs.length - 1 ? (
            <Typography key={c.id} variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {c.name}
            </Typography>
          ) : (
            <Typography key={c.id} variant="body2" color="text.secondary" noWrap sx={{ cursor: "pointer", "&:hover": { textDecoration: "underline" } }} onClick={() => select(c.id)}>
              {c.name}
            </Typography>
          ),
        )}
      </Breadcrumbs>
      {archive && <Chip size="small" variant="outlined" label={`in ${archive.name}`} />}
      <Typography variant="caption" color="text.secondary">
        {formatBytes(node.size)}
      </Typography>
      {node.kind === "file" && node.source && (
        <Button size="small" startIcon={<DownloadIcon />} onClick={async () => downloadBlob(await sourceToBlob(node.source!, mimeOf(node.name)), node.name)}>
          Download
        </Button>
      )}
    </Box>
  );
}

function ViewerBody({ node }: { node: TreeNode }) {
  if (node.kind === "dir") return <FolderView node={node} />;
  if (!node.source) return null;
  switch (kindOf(node.name)) {
    case "archive":
      return <ArchiveView node={node} />;
    case "image":
      return <ImageView node={node} />;
    case "audio":
    case "video":
      return <MediaView node={node} />;
    case "rpyc":
      return <RpycView node={node} />;
    case "script":
    case "text":
      return <TextFileView node={node} />;
    case "font":
      return <FontView node={node} />;
    case "save":
      return <SaveView node={node} />;
    default:
      return <HexView node={node} />;
  }
}
