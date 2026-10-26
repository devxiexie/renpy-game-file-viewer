import { Box, Paper, Stack, Typography } from "@mui/material";
import { useMemo } from "react";
import { formatBytes, kindOf, type FileKind } from "../../core/files/types";
import type { TreeNode } from "../../core/vfs/tree";
import { useApp } from "../../state/store";

const LABELS: Record<FileKind, string> = {
  image: "Images",
  audio: "Audio",
  video: "Video",
  script: "Scripts (.rpy)",
  rpyc: "Compiled scripts",
  archive: "Archives",
  font: "Fonts",
  save: "Saves",
  text: "Text & data",
  binary: "Other",
};

export function FolderView({ node }: { node: TreeNode }) {
  const tree = useApp((s) => s.tree);
  const revision = useApp((s) => s.revision);
  const stats = useMemo(() => {
    const byKind = new Map<FileKind, { count: number; size: number }>();
    let files = 0;
    for (const f of tree.files(node)) {
      files++;
      const k = kindOf(f.name);
      const s = byKind.get(k) ?? { count: 0, size: 0 };
      s.count++;
      s.size += f.size;
      byKind.set(k, s);
    }
    return { files, byKind: [...byKind].sort((a, b) => b[1].size - a[1].size) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, node, revision]);

  const unopened = [...tree.files(node)].filter((f) => f.archive && f.archive.status !== "ready").length;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, overflow: "auto" }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {node.name}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        {stats.files.toLocaleString()} files · {formatBytes(node.size)}
        {unopened > 0 && ` · ${unopened} archive${unopened === 1 ? "" : "s"} not expanded yet`}
      </Typography>
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5 }}>
        {stats.byKind.map(([kind, s]) => (
          <Paper key={kind} variant="outlined" sx={{ p: 1.5, minWidth: 150, flex: "1 1 150px" }}>
            <Typography variant="caption" color="text.secondary">
              {LABELS[kind]}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {s.count.toLocaleString()}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatBytes(s.size)}
            </Typography>
          </Paper>
        ))}
      </Stack>
    </Box>
  );
}
