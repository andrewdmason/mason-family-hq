"use client";

// Player home (F3): what a dad-coach opens between reps at the tee. The
// current focus areas — cue + tell — must be readable above the fold on a
// phone; everything else (new session, in-progress work, assessment history)
// stacks below. Mirrors the roster/session shell convention: client view fed
// by a force-dynamic server page.

import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { FocusCard } from "@/components/swing/player/focus-card";
import { humanizeIssueKey } from "@/lib/swing/format";
import { NewSessionButton } from "@/components/swing/player/new-session-button";
import {
  ageFromBirthYear,
  type AssessmentStatus,
  type SwingAssessment,
  type SwingFocusArea,
  type SwingPlayer,
  type SwingSession,
} from "@/lib/swing/types";

export function PlayerPage({
  player,
  current,
  assessments,
  issueLabels,
  inProgressSessions,
}: {
  player: SwingPlayer;
  current: { assessment: SwingAssessment; focusAreas: SwingFocusArea[] } | null;
  assessments: SwingAssessment[];
  /** assessment id → focus-area issue keys (complete assessments only). */
  issueLabels: Record<string, string[]>;
  inProgressSessions: SwingSession[];
}) {
  // The field reference shows only active focus areas; parked issues live on
  // the assessment page.
  const focusAreas = current
    ? current.focusAreas.filter((fa) => fa.disposition === "focus")
    : [];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
      <Link
        href="/swing"
        className="-ml-1.5 mb-1 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Players
      </Link>

      <header className="mb-4">
        <h1 className="font-serif text-2xl tracking-tight">{player.name}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Age {ageFromBirthYear(player.birthYear)} · Bats {player.bats}
        </p>
      </header>

      {current ? (
        <section aria-label="Current focus areas">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
              Current focus
            </h2>
            <Link
              href={`/swing/assessments/${current.assessment.id}`}
              className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
            >
              Full assessment
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-3">
            {focusAreas.map((area) => (
              <FocusCard key={area.id} area={area} />
            ))}
          </div>
          {current.assessment.confidenceNotes && (
            <p className="mt-2 text-xs text-muted-foreground">
              {current.assessment.confidenceNotes}
            </p>
          )}
          <NewSessionButton playerId={player.id} className="mt-5" />
        </section>
      ) : (
        <NoAssessmentYet playerId={player.id} />
      )}

      {inProgressSessions.length > 0 && (
        <section aria-label="Sessions in progress" className="mt-8">
          <h2 className="mb-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            In progress
          </h2>
          <ul className="divide-y divide-border/70 rounded-xl border">
            {inProgressSessions.map((session) => (
              <SessionRow key={session.id} session={session} playerId={player.id} />
            ))}
          </ul>
        </section>
      )}

      {assessments.length > 0 && (
        <section aria-label="Assessment history" className="mt-8">
          <h2 className="mb-2 text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Assessments
          </h2>
          <ul className="divide-y divide-border/70 rounded-xl border">
            {assessments.map((assessment) => (
              <AssessmentRow
                key={assessment.id}
                assessment={assessment}
                issueKeys={issueLabels[assessment.id] ?? []}
              />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/* ------------------------------------------------------------ empty state - */

function NoAssessmentYet({ playerId }: { playerId: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ClipboardList className="size-6" />
      </span>
      <div>
        <p className="font-medium text-foreground">No assessment yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Film 5–10 slo-mo swings from the side and run a session — the first
          assessment sets this player&apos;s baseline.
        </p>
      </div>
      <NewSessionButton playerId={playerId} size="lg" />
    </div>
  );
}

/* ------------------------------------------------------------- list rows - */

function SessionRow({
  session,
  playerId,
}: {
  session: SwingSession;
  playerId: string;
}) {
  const label =
    session.status === "analyzing"
      ? "Analyzing"
      : session.status === "analysis_failed"
        ? "Analysis failed"
        : "Draft";
  return (
    <li className="relative flex items-center gap-2 px-3 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 sm:px-4">
      <Link
        href={`/swing/players/${playerId}/sessions/${session.id}`}
        className="absolute inset-0"
        aria-label={`Session filmed ${formatDateOnly(session.filmedOn)} — resume`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            Session · {formatDateOnly(session.filmedOn)}
          </span>
          <Badge
            variant={session.status === "analysis_failed" ? "destructive" : "outline"}
            className="shrink-0"
          >
            {label}
          </Badge>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </li>
  );
}

const ASSESSMENT_BADGES: Record<
  AssessmentStatus,
  { label: string; variant: "outline" | "secondary" | "destructive" }
> = {
  complete: { label: "Complete", variant: "outline" },
  superseded: { label: "Superseded", variant: "secondary" },
  voided: { label: "Voided", variant: "secondary" },
  analysis_failed: { label: "Failed", variant: "destructive" },
  generating: { label: "Generating", variant: "outline" },
};

function AssessmentRow({
  assessment,
  issueKeys,
}: {
  assessment: SwingAssessment;
  issueKeys: string[];
}) {
  const badge = ASSESSMENT_BADGES[assessment.status];
  const detail = [
    assessment.swingCount !== null
      ? `${assessment.swingCount} swing${assessment.swingCount === 1 ? "" : "s"}`
      : null,
    issueKeys.length > 0 ? issueKeys.map(humanizeIssueKey).join(", ") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="relative flex items-center gap-2 px-3 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/40 sm:px-4">
      <Link
        href={`/swing/assessments/${assessment.id}`}
        className="absolute inset-0"
        aria-label={`Assessment from ${formatTimestamp(assessment.createdAt)}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">
            {formatTimestamp(assessment.createdAt)}
          </span>
          <Badge variant={badge.variant} className="shrink-0">
            {badge.label}
          </Badge>
        </div>
        {detail && (
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{detail}</p>
        )}
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
    </li>
  );
}

/* ------------------------------------------------------------------ dates - */

/** filmed_on is a plain YYYY-MM-DD — parse as local, not UTC midnight. */
function formatDateOnly(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
