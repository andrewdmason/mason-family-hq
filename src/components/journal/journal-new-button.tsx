"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Camera,
  ChevronDown,
  FileText,
  Loader2,
  MessageSquareQuote,
  PencilLine,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getOrCreateTodayEntry,
  startFreeformEntry,
} from "@/app/(journal)/journal/actions";
import {
  MAX_UPLOAD_BYTES,
  detectMediaType,
  uploadJournalMedia,
} from "@/lib/journal/photo-upload";

/**
 * Split "New" button for an app header. The main segment opens today's entry
 * (the question picker) like the old "+". The dropdown jumps straight into one
 * of the four other ways to start: write freely, start with a photo, save a
 * quote, or paste a recap. Freeform/quote/recap deep-link into the picker via
 * `?start=`; the photo option is handled here because opening a file dialog
 * needs the click's user gesture, which a fresh page load lacks.
 *
 * `audience` pre-sets where the new entry goes: "family" (from the Family app)
 * or "personal" (from the Journal app). It's threaded into the editor via
 * `?audience=` and force-set as the new entry's visibility for the non-question
 * starts; the picker's audience control can still change it before you commit.
 */
export function JournalNewButton({
  audience,
}: {
  audience: "personal" | "family";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // The editor reads "private"/"family" (the visibility values); "personal" is
  // just the user-facing name for the private journal.
  const visibility = audience === "family" ? "family" : "private";
  const q = `audience=${visibility}`;

  // Redundant while you're already starting an entry — hide it on the editor.
  if (pathname === "/journal/new") return null;

  async function handlePhotoFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || busy) return;
    if (!detectMediaType(file) || file.size > MAX_UPLOAD_BYTES) return;

    setBusy(true);
    try {
      const entry = await getOrCreateTodayEntry();
      await uploadJournalMedia(entry.id, file);
      await startFreeformEntry(entry.id, visibility);
      router.push(`/journal/new?${q}`);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center rounded-md border bg-background">
      <Link
        href={`/journal/new?${q}`}
        className="inline-flex h-8 items-center gap-1 rounded-l-md pl-2 pr-2.5 font-serif text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-4" />
        New
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="More ways to start an entry"
              className="inline-flex h-8 items-center rounded-r-md border-l px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            />
          }
        >
          <ChevronDown className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60 font-serif">
          <DropdownMenuItem onClick={() => router.push(`/journal/new?${q}`)}>
            <Sparkles />
            Start with a question
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => router.push(`/journal/new?${q}&start=freeform`)}
          >
            <PencilLine />
            Start with your own words
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            {busy ? <Loader2 className="animate-spin" /> : <Camera />}
            Start with a photo
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push(`/journal/new?${q}&start=quote`)}
          >
            <MessageSquareQuote />
            Save a quote
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => router.push(`/journal/new?${q}&start=recap`)}
          >
            <FileText />
            Paste a chatbot recap
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          void handlePhotoFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
