import { Box } from "@mui/material";
import { useEffect, useState } from "react";
import { mimeOf } from "../../core/files/types";
import { sourceToBlob } from "../../core/vfs/source";
import { findImage, resolveLayers } from "../../features/analyzer/stage";
import { useAnalyzer } from "./context";

const urlCache = new Map<string, Promise<string | null>>();

/** Object URL for a game image file (cached for the session). */
export function useImageUrl(gamePath: string | null): string | null {
  const { fileNodes } = useAnalyzer();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!gamePath) return setUrl(null);
    const node = fileNodes.get(gamePath);
    if (!node?.source) return setUrl(null);
    let p = urlCache.get(node.id);
    if (!p) {
      p = sourceToBlob(node.source, mimeOf(node.name)).then((b) => URL.createObjectURL(b), () => null);
      urlCache.set(node.id, p);
    }
    let alive = true;
    void p.then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [gamePath, fileNodes]);
  return url;
}

function Layer({ path, fit, position }: { path: string; fit: "contain" | "cover"; position: string }) {
  const url = useImageUrl(path);
  if (!url) return null;
  return <Box component="img" src={url} alt="" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit, objectPosition: position }} />;
}

function MovieLayer({ path, fit }: { path: string; fit: "contain" | "cover" }) {
  const url = useImageUrl(path);
  if (!url) return null;
  return <Box component="video" src={url} muted loop autoPlay playsInline sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: fit }} />;
}

/** Composite((w, h), (x, y), d, ...): parts placed at their offsets in an SVG with the composite's own coordinates. */
function CompositeLayer({ width, height, parts }: { width: number; height: number; parts: { x: number; y: number; displayable: string }[] }) {
  return (
    <Box component="svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {parts.map((p, i) => (
        <PartImage key={i} name={p.displayable} x={p.x} y={p.y} />
      ))}
    </Box>
  );
}

function PartImage({ name, x, y }: { name: string; x: number; y: number }) {
  const { catalog } = useAnalyzer();
  return (
    <>
      {resolveLayers(catalog, name).map((f, i) => (
        <PartFile key={i} path={f} x={x} y={y} />
      ))}
    </>
  );
}

function PartFile({ path, x, y }: { path: string; x: number; y: number }) {
  const url = useImageUrl(path);
  // SVG 2: an <image> without width/height uses the file's own size.
  return url ? <image href={url} x={x} y={y} /> : null;
}

/** Draws an image by Ren'Py name: plain files, layered images, composites and movies. */
export function StageImage({
  name,
  fit = "contain",
  placeholder = true,
  position = "bottom",
}: {
  name: string;
  fit?: "contain" | "cover";
  placeholder?: boolean;
  /** CSS object-position; "top" keeps a sprite's face in view when cropping. */
  position?: string;
}) {
  const { catalog } = useAnalyzer();
  const info = findImage(catalog, name);
  if (info?.kind === "composite" && info.composite) return <CompositeLayer {...info.composite} />;
  if (info?.kind === "movie" && info.movie) {
    const path = catalog.files.get(info.movie.toLowerCase()) ?? catalog.files.get(`movies/${info.movie.toLowerCase()}`) ?? catalog.files.get(`images/${info.movie.toLowerCase()}`);
    if (path) return <MovieLayer path={path} fit={fit} />;
  }
  const layers = resolveLayers(catalog, name);
  if (layers.length === 0) {
    return placeholder ? (
      <Box sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "text.secondary", fontSize: 12, textAlign: "center", p: 1 }}>
        {name}
      </Box>
    ) : null;
  }
  return (
    <>
      {layers.map((p, i) => (
        <Layer key={`${p}-${i}`} path={p} fit={fit} position={position} />
      ))}
    </>
  );
}

/** A character's portrait: side images whole, other sprites cropped to the top (the face). */
export function Portrait({ name }: { name: string }) {
  const face = /^side\s/.test(name) || /(face|portrait|avatar|icon|head|bust|profile)/i.test(name);
  return <StageImage name={name} fit={face ? "contain" : "cover"} position={face ? "center" : "top"} />;
}
