import { python } from "@codemirror/lang-python";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { Box } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";
import { MONO } from "../theme";
import { FindBar, findExtension } from "./FindBar";

export interface CodeViewProps {
  text: string;
  language: "renpy" | "plain";
  /** 1-based line to scroll to and highlight. */
  revealLine?: number;
  revealColumn?: number;
  revealLength?: number;
}

const baseTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": { fontFamily: MONO, lineHeight: 1.55 },
});

export function CodeView({ text, language, revealLine, revealColumn = 0, revealLength = 0 }: CodeViewProps) {
  // The EditorView is created asynchronously by the wrapper; keep it in state so the
  // reveal effect re-runs once it exists.
  const [view, setView] = useState<EditorView | null>(null);
  const { mode, systemMode } = useColorScheme();
  const dark = (mode === "system" ? systemMode : mode) === "dark";
  const extensions = useMemo(() => [baseTheme, EditorView.lineWrapping, findExtension, ...(language === "renpy" ? [python()] : [])], [language]);

  useEffect(() => {
    if (!view || !revealLine) return;
    const line = view.state.doc.line(Math.min(Math.max(1, revealLine), view.state.doc.lines));
    const from = Math.min(line.from + revealColumn, line.to);
    const to = Math.min(from + revealLength, line.to);
    view.dispatch({ selection: EditorSelection.single(from, to), effects: EditorView.scrollIntoView(from, { y: "center" }) });
    view.focus();
  }, [view, revealLine, revealColumn, revealLength, text]);

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <FindBar view={view} text={text} />
      <CodeMirror
        onCreateEditor={setView}
        value={text}
        height="100%"
        style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
        theme={dark ? "dark" : "light"}
        readOnly
        editable={false}
        extensions={extensions}
        basicSetup={{ foldGutter: true, highlightActiveLine: false, searchKeymap: false }}
      />
    </Box>
  );
}
