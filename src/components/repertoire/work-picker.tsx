"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  updatePieceField,
  createWork,
} from "@/app/practice/repertoire/actions";
import type { Piece, Work } from "@/lib/types";

const ADD_NEW = "__add_new__";

export function WorkPicker({
  piece,
  work,
  works,
  composer,
  defaultOpen = false,
  onClose,
}: {
  piece: Piece;
  work: Work | null;
  works: Work[];
  composer: string;
  /** Start straight in the picker (used when opened from the overflow menu). */
  defaultOpen?: boolean;
  /** Called once the picker resolves (selection made or cancelled). */
  onClose?: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"display" | "picking" | "new">(
    defaultOpen ? "picking" : "display"
  );
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  function finish() {
    setMode("display");
    onClose?.();
  }

  const composerKey = composer.trim().toLowerCase();
  const available = composerKey
    ? works.filter(
        (w) => (w.composer ?? "").trim().toLowerCase() === composerKey
      )
    : [];

  async function setWork(workId: string | null) {
    setSaving(true);
    await updatePieceField(piece.id, "work_id", workId);
    setSaving(false);
    finish();
    router.refresh();
  }

  async function createAndSet() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    const form = new FormData();
    form.set("name", name);
    form.set("composer", composer);
    const result = await createWork(form);
    if (result.success && result.workId) {
      await updatePieceField(piece.id, "work_id", result.workId);
    }
    setSaving(false);
    setNewName("");
    finish();
    router.refresh();
  }

  if (mode === "new") {
    return (
      <span className="inline-flex items-center gap-2">
        <Input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New work name..."
          className="h-7 w-64 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              createAndSet();
            } else if (e.key === "Escape") {
              setNewName("");
              finish();
            }
          }}
        />
        <Button
          size="sm"
          onClick={createAndSet}
          disabled={saving || !newName.trim()}
        >
          {saving ? "..." : "Add"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setNewName("");
            finish();
          }}
        >
          Cancel
        </Button>
      </span>
    );
  }

  if (mode === "picking") {
    return (
      <Select
        value={work?.id ?? ""}
        onValueChange={(v) => {
          const val = v ?? "";
          if (val === ADD_NEW) {
            setMode("new");
          } else {
            setWork(val || null);
          }
        }}
      >
        <SelectTrigger className="h-7 text-sm">
          <SelectValue placeholder="None (standalone)">
            {work?.id
              ? works.find((w) => w.id === work.id)?.name ?? "None (standalone)"
              : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="">None (standalone)</SelectItem>
          {available.map((w) => (
            <SelectItem key={w.id} value={w.id}>
              {w.name}
            </SelectItem>
          ))}
          <SelectItem value={ADD_NEW}>+ Add new work</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (work) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Link
          href={`/practice/repertoire/works/${work.id}`}
          className="hover:text-foreground transition-colors"
        >
          {work.name}
        </Link>
        <button
          onClick={() => setMode("picking")}
          className="text-muted-foreground/70 hover:text-foreground transition-colors"
          aria-label="Change work"
        >
          <PencilIcon className="size-3" />
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setMode("picking")}
      disabled={!composer}
      className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:hover:text-muted-foreground"
      title={composer ? "Add to a work" : "Set a composer first"}
    >
      + Add to a work
    </button>
  );
}
