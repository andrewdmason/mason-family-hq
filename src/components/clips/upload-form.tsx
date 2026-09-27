"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as tus from "tus-js-client";
import { AlertCircle, CheckCircle2, Film, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { createClient } from "@/lib/supabase/client";
import { supabaseUrl } from "@/lib/supabase/config";
import { formatBytes } from "@/lib/clips/format";
import { CLIPS_BUCKET, type ClipGame, type ClipKid } from "@/lib/clips/types";
import { beginAtBatUpload, createGame, finishAtBatUpload } from "@/app/(clips)/clips/actions";
import { cn } from "@/lib/utils";

// Uploads go straight from the phone to storage over the resumable (TUS)
// protocol in 6MB chunks, so a dropped connection just retries the chunk, and
// re-picking a video after the page was closed resumes it where it stopped.
// The screen has to stay open while uploading (Safari pauses uploads in the
// background), so we hold a wake lock and warn before leaving.

type ItemStatus = "queued" | "uploading" | "finishing" | "done" | "error";
type Item = {
  key: string;
  file: File;
  status: ItemStatus;
  progress: number; // 0..1
  error?: string;
};

const NEW_GAME = "__new__";
const RESUME_KEY = "clips:resume";

function fileKey(f: File) {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Resumable uploads go to the storage host directly on hosted Supabase (the
// recommended path for large files); local dev uses the API URL as-is.
function tusEndpoint() {
  const m = supabaseUrl.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  return m
    ? `https://${m[1]}.storage.supabase.co/storage/v1/upload/resumable`
    : `${supabaseUrl}/storage/v1/upload/resumable`;
}

type ResumeMap = Record<string, { atBatId: string; gameId: string }>;
function readResume(): ResumeMap {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as ResumeMap;
  } catch {
    return {};
  }
}
function writeResume(map: ResumeMap) {
  localStorage.setItem(RESUME_KEY, JSON.stringify(map));
}

export function UploadForm({
  kids,
  games,
  initialKidSlug,
  initialGameId,
}: {
  kids: ClipKid[];
  games: ClipGame[];
  initialKidSlug?: string;
  initialGameId?: string;
}) {
  const router = useRouter();
  const initialGame = games.find((g) => g.id === initialGameId);
  const [kidId, setKidId] = useState(
    initialGame?.kidId ?? kids.find((k) => k.slug === initialKidSlug)?.id ?? kids[0]?.id ?? "",
  );
  const kidGames = useMemo(() => games.filter((g) => g.kidId === kidId), [games, kidId]);
  const [gameChoice, setGameChoice] = useState<string>(initialGame?.id ?? NEW_GAME);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState(todayKey);
  const [items, setItemsState] = useState<Item[]>([]);
  // The upload loop runs outside React's render cycle, so it reads the queue
  // from this mirror; every change goes through setItems to keep both in step.
  const itemsRef = useRef<Item[]>([]);
  function setItems(next: (list: Item[]) => Item[]) {
    itemsRef.current = next(itemsRef.current);
    setItemsState(itemsRef.current);
  }
  const [gameId, setGameId] = useState<string | null>(initialGame?.id ?? null);
  const [formError, setFormError] = useState<string | null>(null);
  const running = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const busy = items.some((i) => i.status === "uploading" || i.status === "finishing" || i.status === "queued");
  const locked = items.length > 0; // game choice is fixed once videos are queued

  function patch(key: string, p: Partial<Item>) {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }

  // Keep the screen awake and warn before leaving while anything is in flight.
  useEffect(() => {
    if (!busy) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      lock?.release().catch(() => {});
      window.removeEventListener("beforeunload", warn);
    };
  }, [busy]);

  async function resolveGame(): Promise<string> {
    if (gameId) return gameId;
    if (gameChoice !== NEW_GAME) {
      setGameId(gameChoice);
      return gameChoice;
    }
    const { id } = await createGame({ kidId, name: newName, playedOn: newDate });
    setGameId(id);
    return id;
  }

  async function uploadOne(item: Item, gid: string) {
    const supabase = createClient();
    patch(item.key, { status: "uploading", progress: 0, error: undefined });
    try {
      const resume = readResume();
      const prior = resume[item.key];
      const { atBatId, path, resumed } = await beginAtBatUpload({
        gameId: gid,
        fileName: item.file.name,
        bytes: item.file.size,
        resumeId: prior?.gameId === gid ? prior.atBatId : undefined,
      });
      writeResume({ ...readResume(), [item.key]: { atBatId, gameId: gid } });

      await new Promise<void>((resolve, reject) => {
        const upload = new tus.Upload(item.file, {
          endpoint: tusEndpoint(),
          retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
          chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6MB chunks
          uploadDataDuringCreation: true,
          removeFingerprintOnSuccess: true,
          headers: { "x-upsert": "true" },
          metadata: {
            bucketName: CLIPS_BUCKET,
            objectName: path,
            contentType: item.file.type || "video/quicktime",
            cacheControl: "3600",
          },
          // A long upload can outlive the access token; stamp a fresh one on
          // every request (getSession refreshes it when needed).
          onBeforeRequest: async (req) => {
            const { data } = await supabase.auth.getSession();
            const token = data.session?.access_token;
            if (token) req.setHeader("authorization", `Bearer ${token}`);
          },
          onProgress: (sent, total) => patch(item.key, { progress: total ? sent / total : 0 }),
          onError: (err) => reject(err),
          onSuccess: () => resolve(),
        });
        // Only pick up a half-finished upload when it's for this same at-bat —
        // a stale one from another game would land the bytes at its old path.
        (resumed ? upload.findPreviousUploads() : Promise.resolve([]))
          .then((previous) => {
            if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
            upload.start();
          })
          .catch(reject);
      });

      patch(item.key, { status: "finishing", progress: 1 });
      await finishAtBatUpload(atBatId);
      const rest = readResume();
      delete rest[item.key];
      writeResume(rest);
      patch(item.key, { status: "done" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      patch(item.key, { status: "error", error: message.slice(0, 200) });
    }
  }

  // Work through the queue one video at a time (keeps each upload fast and
  // lets the first at-bat become watchable while the rest are still going).
  async function pump(gid: string) {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === "queued");
        if (!next) break;
        await uploadOne(next, gid);
      }
    } finally {
      running.current = false;
      router.refresh();
    }
  }

  async function onPick(files: FileList | null) {
    if (!files?.length) return;
    setFormError(null);
    if (!gameId && gameChoice === NEW_GAME && !newName.trim()) {
      setFormError("Name the game first (e.g. “vs Tribe”).");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    const existing = new Set(items.map((i) => i.key));
    const fresh = Array.from(files)
      .filter((f) => !existing.has(fileKey(f)))
      // Oldest first, so at-bats upload in the order they happened.
      .sort((a, b) => a.lastModified - b.lastModified)
      .map((file) => ({ key: fileKey(file), file, status: "queued" as const, progress: 0 }));
    if (fileInput.current) fileInput.current.value = "";
    let gid: string;
    try {
      gid = await resolveGame();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Could not create the game");
      return;
    }
    setItems((list) => [...list, ...fresh]);
    void pump(gid);
  }

  function retry(key: string) {
    if (!gameId) return;
    patch(key, { status: "queued", progress: 0, error: undefined });
    void pump(gameId);
  }

  const allDone = items.length > 0 && items.every((i) => i.status === "done");
  const fieldClass =
    "h-10 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 sm:text-sm";

  return (
    <div className="mt-6 flex flex-col gap-5">
      <fieldset disabled={locked} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Who&apos;s batting</span>
          <div className="flex gap-2">
            {kids.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => {
                  setKidId(k.id);
                  setGameChoice(NEW_GAME);
                }}
                className={cn(
                  "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-60",
                  kidId === k.id
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-foreground hover:bg-muted",
                )}
              >
                {k.displayName.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Game</span>
          <select
            className={fieldClass}
            value={gameChoice}
            onChange={(e) => setGameChoice(e.target.value)}
          >
            <option value={NEW_GAME}>New game…</option>
            {kidGames.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} · {g.playedOn}
              </option>
            ))}
          </select>
        </label>

        {gameChoice === NEW_GAME && (
          <div className="flex gap-2">
            <label className="flex flex-[2] flex-col gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <input
                className={fieldClass}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="vs Tribe"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-sm font-medium">Date</span>
              <input
                type="date"
                className={fieldClass}
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </label>
          </div>
        )}
      </fieldset>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <input
        ref={fileInput}
        type="file"
        accept="video/*,.mov,.mp4,.m4v"
        multiple
        className="hidden"
        onChange={(e) => onPick(e.target.files)}
      />
      <Button size="lg" className="h-11" onClick={() => fileInput.current?.click()}>
        <Film /> {items.length ? "Add more videos" : "Choose videos"}
      </Button>

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key} className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                {item.status === "done" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : item.status === "error" ? (
                  <AlertCircle className="size-4 shrink-0 text-destructive" />
                ) : (
                  <Loader2
                    className={cn("size-4 shrink-0 text-muted-foreground", item.status !== "queued" && "animate-spin")}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.status === "uploading"
                    ? `${Math.round(item.progress * 100)}% of ${formatBytes(item.file.size)}`
                    : item.status === "queued"
                      ? `Waiting · ${formatBytes(item.file.size)}`
                      : item.status === "finishing"
                        ? "Finishing…"
                        : item.status === "done"
                          ? "Uploaded"
                          : "Failed"}
                </span>
                {item.status === "error" && (
                  <Button variant="ghost" size="icon-sm" aria-label="Retry" onClick={() => retry(item.key)}>
                    <RotateCcw />
                  </Button>
                )}
              </div>
              {(item.status === "uploading" || item.status === "finishing") && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(item.progress * 100)}%` }}
                  />
                </div>
              )}
              {item.error && <p className="mt-1 text-xs text-destructive">{item.error}</p>}
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <p className="text-xs text-muted-foreground">
          Keep this screen open until the uploads finish — each at-bat shows up in the feed as soon as it&apos;s done.
        </p>
      )}
      {allDone && gameId && (
        <Link href={`/clips/game/${gameId}`} className={buttonVariants({ variant: "outline", size: "lg" })}>
          Go to the game
        </Link>
      )}
    </div>
  );
}
