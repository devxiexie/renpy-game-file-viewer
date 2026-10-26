import { Autocomplete, TextField } from "@mui/material";
import { useMemo } from "react";
import type { TreeNode } from "../../core/vfs/tree";
import { useApp } from "../../state/store";

/** Pick a folder or archive from the opened files. */
export function NodePicker({ label, value, onChange, filter }: { label: string; value: TreeNode | null; onChange(n: TreeNode | null): void; filter?: (n: TreeNode) => boolean }) {
  const tree = useApp((s) => s.tree);
  const revision = useApp((s) => s.revision);
  const options = useMemo(() => {
    const out: TreeNode[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) {
        if ((n.kind === "dir" || n.archive) && (!filter || filter(n))) out.push(n);
        if (n.children && n.kind === "dir") walk(n.children);
      }
    };
    walk(tree.roots);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, revision, filter]);
  return (
    <Autocomplete
      size="small"
      options={options}
      value={value}
      onChange={(_, v) => onChange(v)}
      getOptionLabel={(n) => n.path}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderInput={(params) => <TextField {...params} label={label} />}
      sx={{ flex: "1 1 240px", minWidth: 0 }}
    />
  );
}
