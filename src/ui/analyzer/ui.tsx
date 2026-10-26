import { Box, FormControl, InputAdornment, InputLabel, MenuItem, Pagination, Paper, Select, Stack, TextField, Typography } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useEffect, useMemo, useState, type ReactNode } from "react";

/** Big number card; clickable cards act as filters. */
export function StatCard({ value, label, sub, active, onClick }: { value: ReactNode; label: string; sub?: string; active?: boolean; onClick?: () => void }) {
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      role={onClick ? "button" : undefined}
      aria-pressed={onClick ? !!active : undefined}
      sx={{
        p: 1.75,
        flex: "1 1 160px",
        minWidth: 140,
        cursor: onClick ? "pointer" : undefined,
        borderColor: active ? "primary.main" : undefined,
        bgcolor: active ? "action.selected" : undefined,
        "&:hover": onClick ? { borderColor: "primary.main" } : undefined,
      }}
    >
      <Typography variant="h5" sx={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </Typography>
      <Typography variant="body2">{label}</Typography>
      {sub && <Typography variant="caption" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, mb: 2 }}>{children}</Stack>;
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }) {
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      sx={{ flex: "1 1 220px", maxWidth: 360 }}
      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }, htmlInput: { "aria-label": placeholder } }}
    />
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [NoInfer<T>, string])[]; onChange: (v: NoInfer<T>) => void }) {
  return (
    <FormControl size="small" sx={{ minWidth: 160 }}>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value} onChange={(e) => onChange(e.target.value as T)} inputProps={{ "aria-label": label }}>
        {options.map(([v, l]) => (
          <MenuItem key={v} value={v}>{l}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export function Toolbar({ children, summary }: { children: ReactNode; summary?: ReactNode }) {
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center", mb: 2 }}>
      {children}
      {summary && <Typography variant="body2" color="text.secondary" sx={{ ml: "auto" }}>{summary}</Typography>}
    </Stack>
  );
}

/** Client-side pagination; resets to page 1 when the list changes. */
export function usePaged<T>(items: T[], initialPerPage: number) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(initialPerPage);
  useEffect(() => setPage(1), [items, perPage]);
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const slice = useMemo(() => items.slice((page - 1) * perPage, page * perPage), [items, page, perPage]);
  return { page, setPage, perPage, setPerPage, pages, slice, from: items.length ? (page - 1) * perPage + 1 : 0, to: Math.min(items.length, page * perPage) };
}

export function Pager({ paged, total, noun, sizes }: { paged: ReturnType<typeof usePaged<unknown>>; total: number; noun: string; sizes: number[] }) {
  if (total === 0) return null;
  return (
    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "center", gap: 2, my: 2, flexWrap: "wrap" }}>
      <Pagination count={paged.pages} page={paged.page} onChange={(_, p) => paged.setPage(p)} shape="rounded" size="small" siblingCount={1} />
      <Select size="small" value={paged.perPage} onChange={(e) => paged.setPerPage(Number(e.target.value))} inputProps={{ "aria-label": "Per page" }}>
        {sizes.map((n) => (
          <MenuItem key={n} value={n}>{n} / page</MenuItem>
        ))}
      </Select>
      <Typography variant="caption" color="text.secondary">
        {paged.from}–{paged.to} of {total.toLocaleString()} {noun}
      </Typography>
    </Stack>
  );
}

export function Initials({ name, size = 96 }: { name: string; size?: number }) {
  const letters = name.replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <Box sx={{ width: size, height: size, borderRadius: 1.5, bgcolor: "action.hover", display: "flex", alignItems: "center", justifyContent: "center", fontSize: size / 3, fontWeight: 300, color: "text.secondary", flexShrink: 0 }}>
      {letters}
    </Box>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>{title}</Typography>
      {sub && <Typography color="text.secondary">{sub}</Typography>}
    </Box>
  );
}

/** Responsive card grid. */
export function CardGrid({ children, min = 300 }: { children: ReactNode; min?: number }) {
  return <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: `repeat(auto-fill, minmax(${min}px, 1fr))` }, gap: 1.5 }}>{children}</Box>;
}
