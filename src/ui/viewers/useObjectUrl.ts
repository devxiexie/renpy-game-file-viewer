import { useEffect, useState } from "react";
import { sourceToBlob, type FileSource } from "../../core/vfs/source";

/** Object URL for a FileSource, revoked when the source changes or the component unmounts. */
export function useObjectUrl(source: FileSource | undefined, mime: string): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!source) return;
    let url: string | null = null;
    let cancelled = false;
    setState({ url: null, error: null });
    sourceToBlob(source, mime)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ url, error: null });
      })
      .catch((e) => !cancelled && setState({ url: null, error: String(e) }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, mime]);
  return state;
}
