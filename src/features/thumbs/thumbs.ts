import { kindOf, mimeOf } from "../../core/files/types";
import { sourceToBlob } from "../../core/vfs/source";
import type { TreeNode } from "../../core/vfs/tree";
import { engine } from "../../workers/client";

/** Thumbnails are rendered once at this size and scaled down by CSS. */
const THUMB_PX = 192;
const MAX_CONCURRENT = 4;
const MAX_CACHED = 2000;

const cache = new Map<string, Promise<string | null>>();
const queue: (() => void)[] = [];
let running = 0;

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < MAX_CONCURRENT) run();
    else queue.push(run);
  });
}

export function canThumbnail(node: TreeNode): boolean {
  const k = kindOf(node.name);
  return node.kind === "file" && !!node.source && (k === "image" || k === "video");
}

/** Object URL of a node's thumbnail, or null when it can't be rendered. Cached per node. */
export function thumbnailUrl(node: TreeNode): Promise<string | null> {
  const hit = cache.get(node.id);
  if (hit) return hit;
  const p = schedule(async () => {
    const blob = kindOf(node.name) === "video" ? await videoFrame(node) : await engine().imageThumbnail(node.source!, THUMB_PX);
    return blob ? URL.createObjectURL(blob) : null;
  }).catch(() => null);
  cache.set(node.id, p);
  if (cache.size > MAX_CACHED) {
    const [oldKey, oldVal] = cache.entries().next().value!;
    cache.delete(oldKey);
    void oldVal.then((u) => u && URL.revokeObjectURL(u));
  }
  return p;
}

export function clearThumbnails(): void {
  for (const p of cache.values()) void p.then((u) => u && URL.revokeObjectURL(u));
  cache.clear();
}

/** Grab a frame ~10% into a video (videos can't be decoded in workers). */
async function videoFrame(node: TreeNode): Promise<Blob | null> {
  const url = URL.createObjectURL(await sourceToBlob(node.source!, mimeOf(node.name)));
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("video"));
    });
    video.currentTime = Number.isFinite(video.duration) ? Math.min(video.duration * 0.1, 3) : 0;
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error("video"));
    });
    const scale = Math.min(1, THUMB_PX / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.8));
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
  }
}
