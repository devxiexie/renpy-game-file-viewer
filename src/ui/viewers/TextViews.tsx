import { Alert, Box, Button, CircularProgress, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useEffect, useState } from "react";
import { decodeUtf8 } from "../../core/binary/text";
import { kindOf } from "../../core/files/types";
import { readSource } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";
import { downloadBlob } from "../../features/export/export";
import { useApp } from "../../state/store";
import { engine } from "../../workers/client";
import type { DecompiledScript } from "../../workers/engine";
import { CodeView } from "./LazyCodeView";

const MAX_TEXT = 20 * 1024 * 1024;

function useReveal(nodeId: string) {
  const reveal = useApp((s) => s.reveal);
  return reveal?.fileId === nodeId ? reveal : null;
}

export function TextFileView({ node }: { node: TreeNode }) {
  const [text, setText] = useState<string | null>(null);
  const reveal = useReveal(node.id);
  useEffect(() => {
    readSource(node.source!, 0, MAX_TEXT).then((b) => setText(decodeUtf8(b).replace(/^﻿/, "")));
  }, [node.source]);
  if (text === null) return <CircularProgress sx={{ m: 3 }} />;
  return <CodeView text={text} language={kindOf(node.name) === "script" ? "renpy" : "plain"} revealLine={reveal?.line} revealColumn={reveal?.column} revealLength={reveal?.length} />;
}

export function RpycView({ node }: { node: TreeNode }) {
  const [result, setResult] = useState<DecompiledScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reveal = useReveal(node.id);
  useEffect(() => {
    engine()
      .decompile(node.source!)
      .then(setResult)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [node.source]);

  if (error) return <Alert severity="error" sx={{ m: 2 }}>Unable to decompile this compiled script: {error}</Alert>;
  if (!result) {
    return (
      <Box sx={{ p: 3, display: "flex", gap: 2, alignItems: "center" }}>
        <CircularProgress size={20} /> <Typography color="text.secondary">Decompiling…</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 2, borderBottom: 1, borderColor: "divider", flexWrap: "wrap" }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          Decompiled from {node.name} · line numbers match the original script
        </Typography>
        <Button size="small" startIcon={<DownloadIcon />} onClick={() => downloadBlob(new Blob([result.source], { type: "text/plain" }), node.name.replace(/c$/, ""))}>
          Save .rpy
        </Button>
      </Box>
      {result.warnings.length > 0 && (
        <Alert severity="warning" sx={{ borderRadius: 0 }}>
          {result.warnings.join(" · ")}
        </Alert>
      )}
      <CodeView text={result.source} language="renpy" revealLine={reveal?.line} revealColumn={reveal?.column} revealLength={reveal?.length} />
    </Box>
  );
}
