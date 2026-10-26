import type { AnalyzerIndex } from "./model";

/**
 * Analyzer results cached in IndexedDB, keyed by a fingerprint of the scripts and images
 * analyzed (paths + sizes), so reopening the same game skips the scan.
 */

const DB = "rpv-analyzer";
const STORE = "indexes";
const VERSION = 5; // bump when the index format or analysis changes
const MAX_ENTRIES = 8;

export interface CachedIndex {
  key: string;
  savedAt: number;
  index: AnalyzerIndex;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function fingerprint(parts: { path: string; size: number }[]): string {
  const text = parts.map((p) => `${p.path}:${p.size}`).sort().join("|");
  let h1 = 0x811c9dc5;
  let h2 = 0;
  for (let i = 0; i < text.length; i++) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 0x01000193);
    h2 = (h2 * 31 + text.charCodeAt(i)) | 0;
  }
  return `${(h1 >>> 0).toString(16)}-${(h2 >>> 0).toString(16)}-${parts.length}`;
}

export async function loadCached(key: string): Promise<CachedIndex | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CachedIndex | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function saveCached(entry: CachedIndex): Promise<void> {
  try {
    const db = await open();
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    store.put(entry);
    const all = await new Promise<CachedIndex[]>((resolve) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as CachedIndex[]);
      req.onerror = () => resolve([]);
    });
    for (const old of all.sort((a, b) => b.savedAt - a.savedAt).slice(MAX_ENTRIES)) store.delete(old.key);
  } catch {
    /* caching is best-effort */
  }
}

export async function deleteCached(key: string): Promise<void> {
  try {
    const db = await open();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
  } catch {
    /* ignore */
  }
}
