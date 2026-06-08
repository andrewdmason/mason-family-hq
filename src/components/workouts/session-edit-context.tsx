"use client";

import { createContext, useContext, useState } from "react";

/**
 * Edit/read-only state for a workout session view. A completed session shows a
 * celebratory read-only summary by default; "Edit" reopens the full editable
 * form WITHOUT un-completing it. An incomplete session is always editable (the
 * common logging path).
 *
 * `EditingOnly` / `LockedOnly` gate which presentation renders, so the heavy
 * server-rendered blocks tree can be passed through as children and only mounted
 * in the relevant mode.
 */
type SessionEditState = {
  editing: boolean;
  completed: boolean;
  toggle: () => void;
};

const SessionEditContext = createContext<SessionEditState | null>(null);

export function SessionEditProvider({
  completed,
  children,
}: {
  completed: boolean;
  children: React.ReactNode;
}) {
  // Incomplete → always editable. Completed → start locked (read-only summary).
  const [editing, setEditing] = useState(!completed);

  // Reset the mode whenever completion flips — e.g. after "Mark done"
  // revalidates the page, lock straight into the summary without a manual
  // refresh; after a reopen, drop back into the editable form. (React's
  // recommended "adjust state during render" pattern, no effect/flash.)
  const [prevCompleted, setPrevCompleted] = useState(completed);
  if (completed !== prevCompleted) {
    setPrevCompleted(completed);
    setEditing(!completed);
  }

  const value: SessionEditState = {
    editing: completed ? editing : true,
    completed,
    toggle: () => completed && setEditing((e) => !e),
  };
  return (
    <SessionEditContext.Provider value={value}>
      {children}
    </SessionEditContext.Provider>
  );
}

export function useSessionEditing(): SessionEditState {
  return (
    useContext(SessionEditContext) ?? {
      editing: true,
      completed: false,
      toggle: () => {},
    }
  );
}

/** Renders its children only in the editable form mode. */
export function EditingOnly({ children }: { children: React.ReactNode }) {
  const { editing } = useSessionEditing();
  return editing ? <>{children}</> : null;
}

/** Renders its children only in the completed, locked (summary) mode. */
export function LockedOnly({ children }: { children: React.ReactNode }) {
  const { editing, completed } = useSessionEditing();
  return completed && !editing ? <>{children}</> : null;
}
