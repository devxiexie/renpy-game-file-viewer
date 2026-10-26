import { Box, Chip, IconButton, List, ListItemButton, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImageInfo } from "../../features/analyzer/model";
import { MONO } from "../theme";
import { LabelLink, SourceLink, matches, useAnalyzer } from "./context";
import { SearchField } from "./ui";
import { StageImage } from "./StageImage";

type Sort = "interesting" | "uses" | "name";

/** Big art, layered/composite/movie images and heavily used images first. */
function interest(i: ImageInfo): number {
  const bonus = i.kind === "layered" ? 30 : i.kind === "composite" || i.kind === "movie" ? 20 : i.kind === "atl" ? 10 : 0;
  const art = /^(bg|cg|event|scene)$/i.test(i.tag) || /cg|event/i.test(i.name) ? 15 : 0;
  return i.uses * 3 + bonus + art;
}
const CHECKER = "repeating-conic-gradient(rgba(128,128,128,.16) 0% 25%, transparent 0% 50%) 50% / 14px 14px";

export function VisualsView() {
  const { index, selection } = useAnalyzer();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("interesting");
  const [kind, setKind] = useState<string>("all");
  const images = useMemo(() => {
    const list = index.images.filter((i) => (kind === "all" || (kind === "unused" ? i.uses === 0 : i.kind === kind)) && matches(query, i.name, i.code, i.file));
    if (sort === "uses") return [...list].sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
    if (sort === "interesting") return [...list].sort((a, b) => interest(b) - interest(a) || a.name.localeCompare(b.name));
    return list;
  }, [index, query, sort, kind]);
  const [current, setCurrent] = useState<ImageInfo | null>(null);
  useEffect(() => {
    const pre = selection.image ? index.images.find((i) => i.name === selection.image) : undefined;
    if (pre) setCurrent(pre);
  }, [selection.image, index]);

  const kinds = useMemo(() => {
    const c = new Map<string, number>();
    for (const i of index.images) c.set(i.kind, (c.get(i.kind) ?? 0) + 1);
    return [...c];
  }, [index]);

  const ref = useRef<HTMLDivElement>(null);
  const COLS = 3;
  const rows = Math.ceil(images.length / COLS);
  const v = useVirtualizer({ count: rows, getScrollElement: () => ref.current, estimateSize: () => 132, overscan: 4 });

  return (
    <Paper variant="outlined" sx={{ height: { xs: "85dvh", md: "calc(100dvh - 190px)" }, minHeight: 480, overflow: "hidden", display: "flex", flexDirection: { xs: "column", md: "row" } }}>
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Stack direction="row" sx={{ gap: 0.75, p: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Chip size="small" label={`all ${index.images.length}`} variant={kind === "all" ? "filled" : "outlined"} onClick={() => setKind("all")} />
          {kinds.map(([k, n]) => (
            <Chip key={k} size="small" label={`${k} ${n}`} variant={kind === k ? "filled" : "outlined"} onClick={() => setKind(k)} />
          ))}
          <Chip size="small" label={`unused ${index.images.filter((i) => i.uses === 0).length}`} variant={kind === "unused" ? "filled" : "outlined"} onClick={() => setKind("unused")} />
          <SearchField value={query} onChange={setQuery} placeholder="Search visuals" />
          <ToggleButtonGroup size="small" exclusive value={sort} onChange={(_, s) => s && setSort(s)} sx={{ ml: "auto" }}>
            <ToggleButton value="interesting">Most interesting</ToggleButton>
            <ToggleButton value="uses">Most used</ToggleButton>
            <ToggleButton value="name">Name</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Box ref={ref} sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 1 }}>
          <Box sx={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((r) => (
              <Box key={r.index} sx={{ position: "absolute", top: r.start, left: 0, right: 0, display: "grid", gridTemplateColumns: `repeat(${COLS}, 1fr)`, gap: 1, pb: 1 }}>
                {images.slice(r.index * COLS, r.index * COLS + COLS).map((img) => (
                  <Paper
                    key={img.name}
                    variant="outlined"
                    onClick={() => setCurrent(img)}
                    sx={{ cursor: "pointer", overflow: "hidden", borderColor: current === img ? "primary.main" : undefined }}
                  >
                    <Box sx={{ position: "relative", height: 84, background: CHECKER }}>
                      <StageImage name={img.name} />
                    </Box>
                    <Box sx={{ px: 1, py: 0.5 }}>
                      <Typography variant="body2" noWrap sx={{ fontFamily: MONO, fontSize: 12 }}>{img.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{img.kind} · {img.uses} use{img.uses === 1 ? "" : "s"}</Typography>
                    </Box>
                  </Paper>
                ))}
              </Box>
            ))}
          </Box>
          {images.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>No images match.</Typography>}
        </Box>
      </Box>
      {current && (
        <ImageDetail
          image={current}
          onPrev={images.indexOf(current) > 0 ? () => setCurrent(images[images.indexOf(current) - 1]) : undefined}
          onNext={images.indexOf(current) >= 0 && images.indexOf(current) < images.length - 1 ? () => setCurrent(images[images.indexOf(current) + 1]) : undefined}
        />
      )}
    </Paper>
  );
}

function ImageDetail({ image, onPrev, onNext }: { image: ImageInfo; onPrev?: () => void; onNext?: () => void }) {
  const { index, go } = useAnalyzer();
  const [attrs, setAttrs] = useState<string[]>([]);
  useEffect(() => setAttrs([]), [image]);
  const uses = index.imageUses.filter((u) => u.statement !== "hide" && (u.image === image.name || u.image.split(" ")[0] === image.tag && image.kind === "layered" || (u.image.split(" ")[0] === image.tag && u.image.split(" ").slice(1).every((a) => image.attributes.includes(a)))));
  const previewName = [image.name, ...attrs].join(" ");
  const usedIn = [...new Set(uses.map((u) => u.label).filter((l): l is string => !!l))];
  const toggle = (a: string) => setAttrs((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));
  return (
    <Box sx={{ width: { xs: "100%", md: 360 }, flexShrink: 0, borderLeft: { md: 1 }, borderTop: { xs: 1, md: 0 }, borderColor: "divider", overflow: "auto", p: 2, maxHeight: { xs: "50%", md: "none" } }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontFamily: MONO, fontWeight: 700, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{image.name}</Typography>
        <IconButton size="small" disabled={!onPrev} onClick={onPrev} aria-label="Previous visual"><NavigateBeforeIcon /></IconButton>
        <IconButton size="small" disabled={!onNext} onClick={onNext} aria-label="Next visual"><NavigateNextIcon /></IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1 }}>
        {image.kind} · <SourceLink loc={image.loc} />
      </Typography>
      <Box sx={{ position: "relative", height: 220, background: CHECKER, borderRadius: 1, mb: 1.5 }}>
        <StageImage name={previewName} />
      </Box>
      {image.layers && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary">Attributes (click to preview)</Typography>
          <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
            {image.layers.filter((l) => l.attribute).map((l) => (
              <Chip
                key={`${l.group}-${l.attribute}`}
                size="small"
                label={`${l.group ? l.group + ": " : ""}${l.attribute}${l.isDefault ? " (default)" : ""}`}
                color={attrs.includes(l.attribute!) ? "primary" : "default"}
                onClick={() => toggle(l.attribute!)}
              />
            ))}
          </Stack>
        </Box>
      )}
      {image.code && (
        <Box component="pre" sx={{ fontFamily: MONO, fontSize: 12, bgcolor: "action.hover", p: 1, borderRadius: 1, whiteSpace: "pre-wrap", overflowWrap: "anywhere", m: 0, mb: 1.5 }}>
          {image.code}
        </Box>
      )}
      {image.file && <Typography variant="caption" component="div" sx={{ mb: 1.5 }}>File: {image.file}</Typography>}
      {usedIn.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="subtitle2">Used in labels</Typography>
          <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
            {usedIn.slice(0, 20).map((l) => <Chip key={l} size="small" label={l} onClick={() => go("story", { label: l })} sx={{ fontFamily: MONO }} />)}
          </Stack>
        </Box>
      )}
      <Typography variant="subtitle2">Used {uses.length} time{uses.length === 1 ? "" : "s"}</Typography>
      <List dense disablePadding>
        {uses.slice(0, 200).map((u, i) => (
          <ListItemButton key={i} disableRipple sx={{ gap: 1, cursor: "default" }}>
            <Typography variant="caption" sx={{ fontFamily: MONO }}>{u.statement} {u.image}</Typography>
            <Box sx={{ ml: "auto", display: "flex", gap: 1 }}>
              {u.label && <LabelLink name={u.label} />}
              <SourceLink loc={u.loc} />
            </Box>
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}
