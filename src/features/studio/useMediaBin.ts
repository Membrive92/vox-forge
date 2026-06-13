import { useCallback, useEffect, useState } from "react";

import {
  deleteMedia,
  listMedia,
  type ListMediaOptions,
  type MediaAsset,
} from "@/api/studio";
import { logger } from "@/logging/logger";

/**
 * Remote state for the Studio media library (T2I-2 / UX-03 M1-M2):
 * list, search and delete. Generation is owned by the composer (it
 * registers the job in the global tray); on success the composer calls
 * {@link MediaBinState.prepend} so the new asset shows immediately
 * without a round-trip.
 */
export interface MediaBinState {
  assets: MediaAsset[];
  loading: boolean;
  error: string | null;
  /** Reload the list, optionally filtered (e.g. by prompt substring). */
  refresh: (options?: ListMediaOptions) => Promise<void>;
  remove: (assetId: string) => Promise<void>;
  /** Insert freshly-generated assets at the front (newest-first order). */
  prepend: (newAssets: MediaAsset[]) => void;
}

export function useMediaBin(): MediaBinState {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (options?: ListMediaOptions) => {
    setLoading(true);
    try {
      const list = await listMedia(options ?? { kind: "image" });
      setAssets(list);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error("Media bin: failed to list assets", { error: msg });
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (assetId: string) => {
    try {
      await deleteMedia(assetId);
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      logger.error("Media bin: delete failed", { error: msg, assetId });
    }
  }, []);

  const prepend = useCallback((newAssets: MediaAsset[]) => {
    if (newAssets.length === 0) return;
    setAssets((prev) => {
      const fresh = newAssets.filter((a) => !prev.some((p) => p.id === a.id));
      return [...fresh, ...prev];
    });
  }, []);

  useEffect(() => {
    void refresh({ kind: "image" });
  }, [refresh]);

  return { assets, loading, error, refresh, remove, prepend };
}
