import { CircularProgress } from "@mui/material";
import { lazy, Suspense } from "react";
import type { CodeViewProps } from "./CodeView";

const CodeViewImpl = lazy(() => import("./CodeView").then((m) => ({ default: m.CodeView })));

/** CodeMirror is the largest dependency; load it on first use. */
export function CodeView(props: CodeViewProps) {
  return (
    <Suspense fallback={<CircularProgress sx={{ m: 3 }} />}>
      <CodeViewImpl {...props} />
    </Suspense>
  );
}
