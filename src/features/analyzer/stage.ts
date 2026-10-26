import type { AnalyzerIndex, ImageInfo, SceneEvent } from "./model";

export interface ImageCatalog {
  byName: Map<string, ImageInfo>;
  byTag: Map<string, ImageInfo[]>;
  /** Lowercased game-relative paths of image files that exist. */
  files: Map<string, string>;
}

export function imageCatalog(index: AnalyzerIndex, gamePaths: string[]): ImageCatalog {
  const byName = new Map(index.images.map((i) => [i.name, i]));
  const byTag = new Map<string, ImageInfo[]>();
  for (const i of index.images) (byTag.get(i.tag) ?? byTag.set(i.tag, []).get(i.tag)!).push(i);
  return { byName, byTag, files: new Map(gamePaths.map((p) => [p.toLowerCase(), p])) };
}

/** Find the image a `show tag attrs...` statement refers to. */
export function findImage(cat: ImageCatalog, name: string): ImageInfo | null {
  const exact = cat.byName.get(name);
  if (exact) return exact;
  const [tag, ...attrs] = name.split(" ");
  const candidates = cat.byTag.get(tag) ?? [];
  return (
    candidates.find((c) => c.kind === "layered") ??
    candidates.filter((c) => attrs.every((a) => c.attributes.includes(a))).sort((a, b) => a.attributes.length - b.attributes.length)[0] ??
    null
  );
}

function fileFor(cat: ImageCatalog, ref: string): string | null {
  const lower = ref.toLowerCase();
  return cat.files.get(lower) ?? cat.files.get(`images/${lower}`) ?? null;
}

/**
 * Game-relative files to draw, bottom to top, for an image name. Layered images combine
 * always-on layers, group defaults and the requested attributes (conditions are skipped).
 */
export function resolveLayers(cat: ImageCatalog, name: string, depth = 0): string[] {
  if (depth > 8) return [];
  const img = findImage(cat, name);
  if (!img) {
    const direct = fileFor(cat, name);
    return direct ? [direct] : [];
  }
  if (img.kind !== "layered" || !img.layers) {
    if (!img.file) return [];
    const f = fileFor(cat, img.file);
    if (f) return [f];
    return img.file !== name && !/[./]/.test(img.file) ? resolveLayers(cat, img.file, depth + 1) : [];
  }
  const requested = new Set(name.split(" ").slice(img.name.split(" ").length));
  const groupsOverridden = new Set(img.layers.filter((l) => l.attribute && requested.has(l.attribute) && l.group).map((l) => l.group));
  const out: string[] = [];
  for (const l of img.layers) {
    let on = false;
    if (l.condition) on = false;
    else if (!l.attribute) on = true;
    else if (requested.has(l.attribute)) on = true;
    else if (l.isDefault && !(l.group && groupsOverridden.has(l.group))) on = true;
    if (!on) continue;
    const d = l.displayable;
    out.push(...(/[./]/.test(d) ? [fileFor(cat, d)].filter((x): x is string => !!x) : resolveLayers(cat, d, depth + 1)));
  }
  return out;
}

/**
 * Combine a new `show` with the image already shown for that tag. Like Ren'Py, attributes
 * from the same layered-image group replace each other; others are kept.
 */
export function mergeShow(cat: ImageCatalog, previous: string | undefined, next: string): string {
  if (!previous) return next;
  const img = findImage(cat, next);
  const [tag, ...attrs] = next.split(" ");
  if (!img || img.kind !== "layered" || !img.layers || cat.byName.has(next) && img.name === next) return next;
  const prevAttrs = previous.split(" ").slice(1);
  const groupOf = new Map(img.layers.filter((l) => l.attribute).map((l) => [l.attribute!, l.group]));
  const replacedGroups = new Set(attrs.map((a) => groupOf.get(a)).filter(Boolean));
  const kept = prevAttrs.filter((a) => !attrs.includes(a) && !(groupOf.get(a) && replacedGroups.has(groupOf.get(a))));
  return [tag, ...kept, ...attrs].join(" ");
}

export interface StageSprite {
  tag: string;
  image: string;
  at: string[];
}

export interface StageState {
  background: string | null;
  sprites: StageSprite[];
  transition: string | null;
}

/** Visible images after applying `events[0..upTo]`. */
export function replay(cat: ImageCatalog, background: string | null, events: SceneEvent[], upTo: number): StageState {
  let bg = background;
  const sprites = new Map<string, StageSprite>();
  let transition: string | null = null;
  for (let i = 0; i <= upTo && i < events.length; i++) {
    const e = events[i];
    if (e.type === "scene") {
      bg = e.image;
      sprites.clear();
    } else if (e.type === "show") {
      const prev = sprites.get(e.tag);
      sprites.set(e.tag, { tag: e.tag, image: mergeShow(cat, prev?.image, e.image), at: e.at.length ? e.at : (prev?.at ?? []) });
    } else if (e.type === "hide") {
      sprites.delete(e.tag);
    } else if (e.type === "with") {
      transition = e.transition;
    } else if (e.type === "say" || e.type === "menu") {
      if (i < upTo) transition = null;
    }
  }
  return { background: bg, sprites: [...sprites.values()], transition };
}

/** Horizontal anchor (0..1) for common Ren'Py positions. */
export function xalignFor(at: string[]): number {
  for (const a of at) {
    if (/^(left|offscreenleft)$/.test(a)) return 0;
    if (/^(right|offscreenright)$/.test(a)) return 1;
    if (/^(center|truecenter|top)$/.test(a)) return 0.5;
    const m = /xalign\s*\(?\s*([\d.]+)|^(?:left|right)(\d)$/.exec(a);
    if (m && m[1]) return Math.max(0, Math.min(1, Number(m[1])));
  }
  return 0.5;
}
