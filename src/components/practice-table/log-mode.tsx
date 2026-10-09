"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LOG_MODE_COOKIE, type LogMode } from "@/lib/practice/quick-log";

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

/**
 * Whether today's log shows as the full list or the quick logger's cards.
 * Remembered per device in a cookie — the laptop on the piano stays on Quick
 * while another screen keeps the list — and read on the server so the right
 * one paints first.
 */
export function LogModeProvider({
  initialMode,
  children,
}: {
  initialMode: LogMode;
  children: ReactNode;
}) {
  const [mode, setModeState] = useState<LogMode>(initialMode);
  const setMode = useCallback((next: LogMode) => {
    setModeState(next);
    document.cookie = `${LOG_MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return (
    <LogModeContext.Provider value={value}>{children}</LogModeContext.Provider>
  );
}
