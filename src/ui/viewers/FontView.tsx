import { Alert, Box, CircularProgress, TextField, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { readSource } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";

let fontCounter = 0;

export function FontView({ node }: { node: TreeNode }) {
  const [family, setFamily] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState("The quick brown fox jumps over the lazy dog. 0123456789");

  useEffect(() => {
    let face: FontFace | null = null;
    const name = `preview-font-${++fontCounter}`;
    readSource(node.source!)
      .then((bytes) => {
        face = new FontFace(name, bytes.slice().buffer);
        return face.load();
      })
      .then((f) => {
        document.fonts.add(f);
        setFamily(name);
      })
      .catch((e) => setError(String(e)));
    return () => {
      if (face) document.fonts.delete(face);
    };
  }, [node.source]);

  if (error) return <Alert severity="error" sx={{ m: 2 }}>Could not load font: {error}</Alert>;
  if (!family) return <CircularProgress sx={{ m: 3 }} />;
  return (
    <Box sx={{ p: 3, overflow: "auto" }}>
      <TextField fullWidth size="small" label="Sample text" value={sample} onChange={(e) => setSample(e.target.value)} sx={{ mb: 3 }} />
      {[48, 32, 22, 16].map((size) => (
        <Typography key={size} sx={{ fontFamily: family, fontSize: size, mb: 2, overflowWrap: "anywhere" }}>
          {sample}
        </Typography>
      ))}
    </Box>
  );
}
