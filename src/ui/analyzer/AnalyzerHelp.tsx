import { Box, Link, Paper, Stack, Typography } from "@mui/material";
import { useApp } from "../../state/store";

const SECTIONS: [string, string][] = [
  ["Explore", "A quick way into the game: the art, the cast, the biggest story sections and the decisions that matter. Each card opens the matching section."],
  ["Visuals", "Loose image files and Ren'Py image definitions together: layered images with their groups and attributes, composites, animations and Movie-backed videos. Open usages to jump to the scene/show statement."],
  ["Overview", "Project size, dialogue, visuals and structure, plus how much of the project the Analyzer could read and what static analysis may miss."],
  ["Characters", "Who talks, how much, where they appear, which portraits belong to them and who they share scenes with."],
  ["Story / Labels", "Every label with its dialogue, choices, characters, visuals and where it leads. Explore plays a label scene by scene; the route inspector shows how to reach any label from the start; the flowchart shows the whole structure."],
  ["Choices", "Decisions ranked by impact: content exclusive to each option, state changes, availability conditions and where the branches rejoin."],
  ["Variables", "Game state: what each variable is for, where it changes, every place it's compared (operator, value and what the test decides), and a Ren'Py console command to set a useful value."],
];

/** In-app help tab for the Ren'Py Analyzer. */
export function AnalyzerHelp() {
  const openTool = useApp((s) => s.openTool);
  return (
    <Box sx={{ flex: 1, overflow: "auto", p: { xs: 2, sm: 4 } }}>
      <Box sx={{ maxWidth: 860, mx: "auto" }}>
        <Typography variant="h4" sx={{ fontWeight: 800, mb: 1 }}>Ren'Py Analyzer</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Open a game and the Analyzer builds searchable indexes from its compiled scripts and assets: labels, menus, conditions, jumps and calls, dialogue, characters,
          variables, images, layered images, composites, Movie and basic ATL data. Everything runs in your browser; nothing is uploaded. Every section is complete, with
          search, filters and sorting — there are no preview limits.{" "}
          <Link component="button" onClick={() => openTool("analyzer")}>Open the Analyzer</Link>
        </Typography>
        <Stack spacing={1.5}>
          {SECTIONS.map(([title, text]) => (
            <Paper key={title} variant="outlined" sx={{ p: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{title}</Typography>
              <Typography color="text.secondary">{text}</Typography>
            </Paper>
          ))}
        </Stack>
        <Typography variant="h6" sx={{ fontWeight: 700, mt: 4 }}>What static analysis can miss</Typography>
        <Typography color="text.secondary">
          The Analyzer reads the scripts without running the game or its Python. Menus, images, variables and jumps created at runtime can be missing or approximate. Custom
          displayables, unusual ATL and runtime-only conditions are only partly represented. Scene previews follow a representative path; transitions and Python side effects
          aren't reproduced. The original files are always one click away in the file browser.
        </Typography>
      </Box>
    </Box>
  );
}
