"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

/**
 * Frictionless capture: type, Enter, it's in the list. Stays focused after
 * submit so a brain-dump of five tasks is five Enters.
 */
export function QuickEntry({
  placeholder,
  onCreate,
}: {
  placeholder: string;
  onCreate: (title: string) => void;
}) {
  const [title, setTitle] = useState("");

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setTitle("");
  };

  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-2 py-1.5 focus-within:border-primary/40">
      <Plus className="size-4 shrink-0 text-muted-foreground" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-muted-foreground/70"
        aria-label="New to-do"
      />
    </div>
  );
}
