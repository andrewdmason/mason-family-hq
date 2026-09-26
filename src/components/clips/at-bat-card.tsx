import Link from "next/link";
import { Clapperboard, Loader2 } from "lucide-react";
import { pitchSummary, posterUrl, resultLabel, type ClipAtBat } from "@/lib/clips/types";

/** Feed tile for one at-bat: thumbnail, result badge, pitch summary. */
export function AtBatCard({ atBat, index }: { atBat: ClipAtBat; index: number }) {
  const summary = pitchSummary(atBat.pitches);
  const badge = resultLabel(atBat.result);
  const busy = atBat.status === "uploading" || atBat.status === "processing";

  return (
    <Link
      href={`/clips/at-bat/${atBat.id}`}
      className="group flex flex-col gap-1.5"
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10 transition group-hover:ring-foreground/30">
        {atBat.hasPoster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={posterUrl(atBat)}
            alt=""
            loading="lazy"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <Clapperboard className="size-6" />
          </div>
        )}
        {badge && (
          <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 font-mono text-xs font-semibold text-white">
            {badge}
          </span>
        )}
        {busy && (
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/60 px-2 py-1 text-xs text-white">
            <Loader2 className="size-3 animate-spin" />
            {atBat.status === "uploading" ? "Uploading…" : "Preparing playback…"}
          </span>
        )}
      </div>
      <div className="flex items-baseline justify-between gap-2 px-0.5 text-xs">
        <span className="font-medium text-foreground">AB {index + 1}</span>
        <span className="truncate text-muted-foreground">{summary ?? "Not marked yet"}</span>
      </div>
    </Link>
  );
}
