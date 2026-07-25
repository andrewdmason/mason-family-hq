"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  DEFAULT_SETTINGS,
  readerSettingsStore,
  type ReaderSettings,
} from "@/lib/reading/reader-settings";

/**
 * This device's reader layout settings.
 *
 * Subscribed rather than copied into state: the server renders the defaults, the
 * browser swaps in whatever it has stored, and a change made in one tab reaches
 * every other tab reading the same book.
 */
export function useReaderSettings(): {
  settings: ReaderSettings;
  update: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
  reset: () => void;
} {
  const settings = useSyncExternalStore(
    readerSettingsStore.subscribe,
    readerSettingsStore.getSnapshot,
    readerSettingsStore.getServerSnapshot
  );

  const update = useCallback(
    <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => {
      const current = readerSettingsStore.getSnapshot();
      if (current[key] === value) return;
      readerSettingsStore.set({ ...current, [key]: value });
    },
    []
  );

  const reset = useCallback(() => readerSettingsStore.set(DEFAULT_SETTINGS), []);

  return { settings, update, reset };
}
