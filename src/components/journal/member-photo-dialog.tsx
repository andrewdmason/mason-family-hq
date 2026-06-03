"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Loader2, Star, Trash2, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { makeSquareAvatarBlob } from "@/lib/journal/photo-upload";
import {
  addMemberPhoto,
  deleteMemberPhoto,
  setPrimaryMemberPhoto,
} from "@/app/(journal)/settings/family/actions";
import type { FamilyMember, MemberPhoto } from "@/lib/types";

export function MemberPhotoDialog({
  member,
  photos,
  trigger,
}: {
  member: FamilyMember;
  photos: MemberPhoto[];
  trigger: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = member.name || member.email;

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const blob = await makeSquareAvatarBlob(file);
        const form = new FormData();
        form.set("email", member.email);
        form.set("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
        await addMemberPhoto(form);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't upload that photo.");
      }
    });
  }

  function handlePrimary(photoId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await setPrimaryMemberPhoto(photoId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't update the photo.");
      }
    });
  }

  function handleDelete(photoId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteMemberPhoto(photoId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't delete that photo.");
      }
    });
  }

  return (
    <Dialog>
      <DialogTrigger render={trigger as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Photos for {label}</DialogTitle>
          <DialogDescription>
            Add photos and pick one as the primary. The primary shows next to
            their posts in the family feed.
          </DialogDescription>
        </DialogHeader>

        {photos.length > 0 ? (
          <ul className="grid grid-cols-3 gap-3">
            {photos.map((p) => (
              <li key={p.id} className="group relative">
                <div
                  className={cn(
                    "relative aspect-square overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10",
                    p.is_primary && "ring-2 ring-foreground"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  {p.is_primary && (
                    <span className="absolute left-1 top-1 rounded-full bg-foreground/80 p-1 text-background">
                      <Star className="h-3 w-3 fill-current" />
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-1">
                  {p.is_primary ? (
                    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <Check className="h-3 w-3" /> Primary
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handlePrimary(p.id)}
                      disabled={pending}
                      className="text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                    >
                      Make primary
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(p.id)}
                    disabled={pending}
                    aria-label="Delete photo"
                    className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-serif text-sm italic text-muted-foreground">
            No photos yet.
          </p>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePick}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {pending ? "Working…" : "Add a photo"}
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
}
