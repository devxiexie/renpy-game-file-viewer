import { Box, Button, CircularProgress, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { formatBytes } from "../../core/files/types";
import { readSource } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";
import { MONO } from "../theme";
import { CodeView } from "./LazyCodeView";

const LIMIT = 64 * 1024;

function hexDump(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const row = bytes.subarray(off, off + 16);
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${off.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join("\n");
}

export function HexView({ node }: { node: TreeNode }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [asText, setAsText] = useState(false);
  useEffect(() => {
    readSource(node.source!, 0, LIMIT).then(setBytes);
  }, [node.source]);
  if (!bytes) return <CircularProgress sx={{ m: 3 }} />;
  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 2, borderBottom: 1, borderColor: "divider" }}>
        <Button size="small" onClick={() => setAsText(!asText)}>
          {asText ? "Show hex" : "Show as text"}
        </Button>
        {node.size > LIMIT && (
          <Typography variant="caption" color="text.secondary">
            Showing the first {formatBytes(LIMIT)} of {formatBytes(node.size)}
          </Typography>
        )}
      </Box>
      {asText ? (
        <CodeView text={new TextDecoder().decode(bytes)} language="plain" />
      ) : (
        <Box component="pre" sx={{ m: 0, p: 2, flex: 1, overflow: "auto", fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5 }}>
          {hexDump(bytes)}
        </Box>
      )}
    </Box>
  );
}
