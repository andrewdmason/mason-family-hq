// Assessment detail view (U11). Server component by design: everything here
// is static display of an immutable assessment snapshot — only the
// regenerate/void buttons need a client island (assessment-actions.tsx).
//
// Reading order is the coaching order: status banner → who/when → narrative →
// honesty notes → focus cards (THE TELL LEADS — it's what the coach watches
// for at the tee) → parked issues (de-emphasized, AE3) → progress vs. prior.

import Link from "next/link";
import { AlertTriangle, Ban, History, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AssessmentActions } from "@/components/swing/assessment/assessment-actions";
import { formatDateOnly, humanizeIssueKey } from "@/lib/swing/format";
import type {
  ProgressVerdictKind,
  SwingAssessment,
  SwingFocusArea,
  SwingPlayer,
  SwingSession,
} from "@/lib/swing/types";

export function AssessmentView({
  assessment,
  player,
  session,
  focusAreas,
  priorAreasById,
  stillUrls,
  supersededById,
}: {
  assessment: SwingAssessment;
  player: SwingPlayer;
  session: SwingSession | null;
  focusAreas: SwingFocusArea[];
  priorAreasById: Record<string, SwingFocusArea>;
  /** path → short-TTL signed URL, signed fresh on every page load. */
  stillUrls: Record<string, string>;
  supersededById: string | null;
}) {
  const focus = focusAreas.filter((fa) => fa.disposition === "focus");
  const sessionHref = `/swing/players/${player.id}/sessions/${assessment.sessionId}`;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:px-6">
      <StatusBanner
        assessment={assessment}
        playerName={player.name}
        sessionHref={sessionHref}
        supersededById={supersededById}
      />

      {/* Voided content stays readable (it explains WHY it was voided) but is
          visually washed — it is not part of the player's record. */}
      <div className={assessment.status === "voided" ? "opacity-60" : undefined}>
        <header className="mb-6">
          <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Swing assessment
          </p>
          <h1 className="mt-1 font-serif text-2xl tracking-tight">
            <Link href={`/swing/players/${player.id}`} className="hover:underline">
              {player.name}
            </Link>
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {session && <span>{formatDateOnly(session.filmedOn)}</span>}
            {assessment.swingCount !== null && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {assessment.swingCount} swing{assessment.swingCount === 1 ? "" : "s"}{" "}
                  analyzed
                </span>
              </>
            )}
            {assessment.model && (
              <Badge
                variant="outline"
                className="h-4 px-1.5 text-[10px] font-normal text-muted-foreground/80"
              >
                {assessment.model}
              </Badge>
            )}
          </div>
        </header>

        {assessment.narrative && (
          <section className="mb-6 space-y-3 text-[15px] leading-relaxed text-foreground">
            {assessment.narrative
              .split(/\n+/)
              .filter((p) => p.trim().length > 0)
              .map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
          </section>
        )}

        {/* Honesty surface — rendered visibly, never hidden ("based on 4
            swings, head-tracking low"). */}
        {assessment.confidenceNotes && (
          <aside className="mb-6 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{assessment.confidenceNotes}</p>
          </aside>
        )}

        {focus.length > 0 && (
          <section className="mb-6">
            <SectionHeading>
              Focus area{focus.length === 1 ? "" : "s"}
            </SectionHeading>
            <div className="space-y-4">
              {focus.map((area, i) => (
                <FocusAreaCard
                  key={area.id}
                  area={area}
                  index={i}
                  stillUrls={stillUrls}
                />
              ))}
            </div>
          </section>
        )}

        {/* Parked issues: visible but clearly secondary (AE3 — never silently
            dropped, never competing with the 1–2 real focus areas). */}
        {assessment.parked.length > 0 && (
          <details className="mb-6 rounded-lg border border-border/70 px-3 py-2.5">
            <summary className="cursor-pointer text-xs text-muted-foreground select-none">
              Also seen, parked for later ({assessment.parked.length})
            </summary>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {assessment.parked.map((issue) => (
                <li key={issue.issueKey}>
                  <span className="font-medium capitalize">
                    {humanizeIssueKey(issue.issueKey)}:
                  </span>{" "}
                  {issue.summary}
                </li>
              ))}
            </ul>
          </details>
        )}

        {assessment.progress.length > 0 && (
          <section className="mb-6">
            <SectionHeading>Progress since last assessment</SectionHeading>
            <ul className="space-y-2">
              {assessment.progress.map((entry) => (
                <ProgressRow
                  key={entry.priorFocusAreaId}
                  verdict={entry.verdict}
                  evidence={entry.evidence}
                  prior={priorAreasById[entry.priorFocusAreaId]}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      {assessment.status === "complete" && (
        <AssessmentActions
          assessmentId={assessment.id}
          sessionId={assessment.sessionId}
          playerId={player.id}
          playerName={player.name}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------- status banners --- */

function StatusBanner({
  assessment,
  playerName,
  sessionHref,
  supersededById,
}: {
  assessment: SwingAssessment;
  playerName: string;
  sessionHref: string;
  supersededById: string | null;
}) {
  if (assessment.status === "voided") {
    return (
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        <Ban className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-semibold text-foreground">Voided</span> — not part of{" "}
          {playerName}&apos;s record. The previous assessment&apos;s focus areas are
          current again.
        </p>
      </div>
    );
  }
  if (assessment.status === "superseded") {
    return (
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        <History className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-semibold text-foreground">
            Replaced by a regenerated assessment.
          </span>{" "}
          This version is kept for reference only.
          {supersededById && (
            <>
              {" "}
              <Link
                href={`/swing/assessments/${supersededById}`}
                className="font-medium text-foreground underline underline-offset-2"
              >
                View the current one
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }
  if (assessment.status === "analysis_failed") {
    return (
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <p>
          <span className="font-semibold">Analysis failed.</span>{" "}
          {assessment.error ?? "The coaching engine hit a problem."} Retry from the{" "}
          <Link
            href={sessionHref}
            className="font-medium underline underline-offset-2"
          >
            session page
          </Link>{" "}
          — nothing re-uploads.
        </p>
      </div>
    );
  }
  if (assessment.status === "generating") {
    return (
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
        <RotateCcw className="mt-0.5 size-4 shrink-0" />
        <p>This assessment is still being generated — check back in a minute.</p>
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------ focus area card --- */

function FocusAreaCard({
  area,
  index,
  stillUrls,
}: {
  area: SwingFocusArea;
  index: number;
  stillUrls: Record<string, string>;
}) {
  return (
    <article className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge variant="secondary">Focus {index + 1}</Badge>
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {humanizeIssueKey(area.issueKey)}
        </span>
        {area.libraryGap && (
          <Badge variant="outline" className="font-normal text-amber-600">
            improvised — not from the drill library
          </Badge>
        )}
      </div>

      {/* THE TELL LEADS — the observable, naked-eye thing the coach watches
          for at the tee. Everything else on the card serves this. */}
      <p className="text-xs font-bold tracking-wider text-sky-700 uppercase dark:text-sky-400">
        Watch for
      </p>
      <p className="mt-1 text-lg leading-snug font-bold text-foreground sm:text-xl">
        {area.tell}
      </p>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {area.diagnosis}
      </p>

      {/* The cue is said out loud to a 9-year-old — render it big and quotable. */}
      <div className="mt-4 rounded-xl bg-sky-100/80 px-4 py-3 text-center dark:bg-sky-950/50">
        <p className="text-[10px] font-semibold tracking-wider text-sky-700/80 uppercase dark:text-sky-400/80">
          Say it
        </p>
        <p className="mt-0.5 font-serif text-xl text-sky-900 dark:text-sky-200">
          &ldquo;{area.cue}&rdquo;
        </p>
      </div>

      {area.drills.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Drill{area.drills.length === 1 ? "" : "s"}
          </p>
          <div className="space-y-2">
            {area.drills.map((drill) => (
              <div
                key={drill.name}
                className="rounded-lg border border-border/70 px-3 py-2.5"
              >
                <p className="text-sm font-medium">{drill.name}</p>
                {drill.steps.length > 0 && (
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {drill.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                )}
                {drill.equipment && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Equipment: {drill.equipment}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {area.evidenceStills.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
            Evidence
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {area.evidenceStills.map((still) => {
              const url = stillUrls[still.path];
              return (
                <figure key={still.path} className="min-w-0">
                  {url ? (
                    // Signed URL with a short TTL — next/image's cache/loader
                    // adds nothing here, a plain img is correct.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={still.caption}
                      className="w-full rounded-lg border bg-muted"
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                      Still unavailable
                    </div>
                  )}
                  <figcaption className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground capitalize">
                      {still.phase}
                    </span>{" "}
                    — {still.caption}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------- progress --- */

const VERDICT_STYLES: Record<ProgressVerdictKind, { label: string; className: string }> = {
  keep: {
    label: "Keep at it",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  },
  advance: {
    label: "Improved",
    className: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  },
  replace: {
    label: "Replaced",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  },
};

function ProgressRow({
  verdict,
  evidence,
  prior,
}: {
  verdict: ProgressVerdictKind;
  evidence: string;
  prior: SwingFocusArea | undefined;
}) {
  const style = VERDICT_STYLES[verdict];
  return (
    <li className="rounded-lg border border-border/70 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={`inline-flex h-5 shrink-0 items-center rounded-4xl px-2 text-xs font-medium ${style.className}`}
        >
          {style.label}
        </span>
        {prior ? (
          <Link
            href={`/swing/assessments/${prior.assessmentId}`}
            className="min-w-0 text-sm font-medium hover:underline"
          >
            &ldquo;{prior.cue}&rdquo;{" "}
            <span className="font-normal text-muted-foreground capitalize">
              ({humanizeIssueKey(prior.issueKey)})
            </span>
          </Link>
        ) : (
          <span className="text-sm text-muted-foreground">Earlier focus area</span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{evidence}</p>
    </li>
  );
}

/* -------------------------------------------------------------- helpers --- */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {children}
    </h2>
  );
}
