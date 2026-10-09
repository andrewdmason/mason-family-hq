"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  LOG_MODE_COOKIE,
  parseLogMode,
  type LogMode,
} from "@/lib/practice/quick-log";

type LogModeContextValue = {
  mode: LogMode;
  setMode: (mode: LogMode) => void;
};

const LogModeContext = createContext<LogModeContextValue | null>(null);

export function useLogMode(): LogModeContextValue {
  const ctx = useContext(LogModeContext);
  if (!ctx) throw new Error("useLogMode needs a LogModeProvider");
  return ctx;
}

const STORAGE_KEY = "practice-log-mode";
const CHANGE_EVENT = "practice-log-mode-change";

function readStoredMode(): LogMode | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parseLogMode(raw);
  } catch {
    // Fall through to the cookie.
  }
  // A choice made before this moved to localStorage lives only in the cookie.
  const cookie = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${LOG_MODE_COOKIE}=`));
  return cookie ? parseLogMode(cookie.split("=")[1]) : null;
}

function subscribe(onChange: () => void) {
  // Another tab switching modes follows along too.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Whether today's log shows as the full list or the quick logger's cards.
 * Remembered per device in localStorage, which is what the browser reads after
 * a reload. The service worker can replay an older copy of the page, so the
 * server's guess (from a cookie mirror) only covers the first paint.
 */
export function LogModeProvider({
  initialMode,
  children,
}: {
  initialMode: LogMode;
  children: ReactNode;
}) {
  const mode = useSyncExternalStore(
    subscribe,
    () => readStoredMode() ?? initialMode,
    () => initialMode
  );
  const setMode = useCallback((next: LogMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or full storage: the cookie below still carries it.
    }
    document.cookie = `${LOG_MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return (
    <LogModeContext.Provider value={value}>{children}</LogModeContext.Provider>
  );
}
