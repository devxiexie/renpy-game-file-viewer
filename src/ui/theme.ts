import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
  colorSchemes: {
    light: { palette: { primary: { main: "#d9480f" }, background: { default: "#f6f6f4", paper: "#ffffff" } } },
    dark: { palette: { primary: { main: "#ff8a4c" }, background: { default: "#141414", paper: "#1d1d1d" } } },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});

export const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
