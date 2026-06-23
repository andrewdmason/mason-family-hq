import { CalendarClock, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import {
  getBenchmarkAttempts,
  getMovementHistory,
  getSessionDetail,
  getSubstitutesForMovements,
  type BlockView,
  type EntryView,
  type MovementHistory,
} from "@/lib/workouts/queries";
import {
  BLOCK_TYPE_LABEL,
  formatSessionDate,
  formatSetMetric,
  parseWodTitle,
} from "@/lib/workouts/format";
import { SetEditor, SetE1rmBadge } from "@/components/workouts/set-editor";
import { BlockScore } from "@/components/workouts/block-score";
import { MovementHistoryCard } from "@/components/workouts/movement-history-card";
import {
  BenchmarkBanner,
  type BenchmarkAttempt,
} from "@/components/workouts/benchmark-banner";
import { SessionNotes } from "@/components/workouts/session-notes";
import { SessionEffort } from "@/components/workouts/session-effort";
import { ReparseButton } from "@/components/workouts/reparse-button";
import { CompleteToggle } from "@/components/workouts/complete-toggle";
import { WhoopSyncPanel } from "@/components/workouts/whoop-sync-panel";
import {
  SessionEditProvider,
  EditingOnly,
  LockedOnly,
} from "@/components/workouts/session-edit-context";
import { WorkoutSummary } from "@/components/workouts/workout-summary";
import { SessionActionsMenu } from "@/components/workouts/session-actions-menu";
import { requireUserId } from "@/lib/members/auth";
import { hasWhoopConnection } from "@/lib/whoop/auth";
import { buildSessionDryRun } from "@/lib/whoop/push";
import { CalendarSourcePopover } from "@/components/workouts/calendar-source-popover";
import { SwapSuggestion } from "@/components/workouts/swap-button";
import { EditEntryButton } from "@/components/workouts/edit-entry-button";
import { getSiblingHints, type SiblingHint } from "@/lib/workouts/sibling";

/**
 * The full inline logging interface for a single workout session: source header,
 * structured blocks with set-by-set inputs, movement history/sibling hints,
 * benchmark banners, and the effort/notes/WHOOP/complete footer. Shared by the
 * workout detail page and the Today tab.
 *
 * Fetches by `sessionId` and returns `null` when the session is missing — each
 * caller decides what to do (404 on the detail page, fall through to the
 * rest-day state on Today).
 */
export async function WorkoutSessionView({ sessionId }: { sessionId: string }) {
  const supabase = await createClient();
  const session = await getSessionDetail(supabase, sessionId);
  if (!session) return null;

  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  // Whether the owner has a WHOOP connection — gates the sync chip below.
  const userId = await requireUserId(supabase);
  const { data: me } = await supabase
    .from("family_members")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  const whoopConnected = me?.email ? await hasWhoopConnection(me.email as string) : false;

  // A completed session locks to a read-only "done" view (Edit reopens it). The
  // WHOOP follow-up — with a preview of exactly what's sent — is offered once the
  // workout is done and a connection exists.
  const completed = session.completedAt !== null;
  const whoopPreview =
    whoopConnected && completed ? await buildSessionDryRun(session.id) : null;

  // Fetch per-movement history (loaded movements) and benchmark attempts in
  // parallel — this is the comparison data the gym view leans on.
  const entryHistory = new Map<string, MovementHistory>();
  const benchmarkAttempts = new Map<string, BenchmarkAttempt[]>();

  const historyJobs: Promise<void>[] = [];
  for (const block of session.blocks) {
    if (block.benchmarkId) {
      historyJobs.push(
        getBenchmarkAttempts(supabase, block.benchmarkId, {
          excludeSessionId: session.id,
        }).then((rows) => {
          benchmarkAttempts.set(block.id, rows);
        })
      );
    }
    for (const entry of block.entries) {
      if (entry.movementId && entry.isLoaded) {
        historyJobs.push(
          getMovementHistory(supabase, entry.movementId, {
            excludeSessionId: session.id,
          }).then((h) => {
            entryHistory.set(entry.id, h);
          })
        );
      }
    }
  }
  await Promise.all(historyJobs);

  // For loaded movements with no history of their own, estimate from a trained
  // family-mate (e.g. push press from strict press).
  const needHints = session.blocks
    .flatMap((b) => b.entries)
    .filter(
      (e) =>
        e.movementId &&
        e.isLoaded &&
        (entryHistory.get(e.id)?.bestE1rmStrict ?? null) === null &&
        (entryHistory.get(e.id)?.recent.length ?? 0) === 0
    );
  const siblingHints: Map<string, SiblingHint> =
    needHints.length > 0
      ? await getSiblingHints(
          supabase,
          needHints.map((e) => e.movementId as string)
        )
      : new Map();
  const hintByEntry = new Map<string, SiblingHint>();
  for (const e of needHints) {
    const h = e.movementId ? siblingHints.get(e.movementId) : undefined;
    if (h) hintByEntry.set(e.id, h);
  }

  // Preferred-substitute suggestions: map each entry whose movement the user has
  // a substitute defined for to that substitute.
  const allEntries = session.blocks.flatMap((b) => b.entries);
  const substitutes = await getSubstitutesForMovements(
    supabase,
    allEntries.map((e) => e.movementId).filter((id): id is string => !!id)
  );
  const subByEntry = new Map<string, { id: string; name: string }>();
  for (const e of allEntries) {
    const sub = e.movementId ? substitutes.get(e.movementId) : undefined;
    if (sub) subByEntry.set(e.id, sub);
  }

  const isUnparsed = session.parsedAt === null && session.blocks.length === 0;

  return (
    <SessionEditProvider completed={completed}>
      <header className="mb-5">
        {session.rawDescription ? (
          <CalendarSourcePopover
            sessionId={session.id}
            source={session.source}
            dateLabel={formatSessionDate(session.sessionDate)}
            rawDescription={session.rawDescription}
          />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {session.source === "calendar" ? (
              <CalendarClock className="size-3.5" />
            ) : (
              <ClipboardList className="size-3.5" />
            )}
            {formatSessionDate(session.sessionDate)}
            <span className="text-muted-foreground/50">·</span>
            {session.source === "calendar" ? "From calendar" : "Logged"}
          </div>
        )}
        <div className="mt-1 flex items-start justify-between gap-2">
          <h1 className="font-serif text-2xl tracking-tight text-foreground">
            {session.title ?? "Workout"}
          </h1>
          {/* Edit / Reopen live here, next to the title, in the completed state. */}
          <SessionActionsMenu
            sessionId={session.id}
            completed={completed}
            source={session.source}
          />
        </div>
      </header>

      {isUnparsed && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          <p className="text-foreground">
            This workout hasn&apos;t been structured yet.
          </p>
          {session.rawDescription && (
            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
              {session.rawDescription}
            </p>
          )}
          <div className="mt-3">
            <ReparseButton sessionId={session.id} label="Structure this workout" />
          </div>
        </div>
      )}

      {/* Completed + locked: one green recap card, with the WHOOP follow-up inside. */}
      <LockedOnly>
        <WorkoutSummary
          session={session}
          whoop={
            whoopConnected ? (
              <WhoopSyncPanel
                sessionId={session.id}
                status={session.whoopSyncStatus}
                syncedAt={session.whoopSyncedAt}
                error={session.whoopSyncError}
                preview={whoopPreview}
              />
            ) : null
          }
        />
      </LockedOnly>

      {/* Incomplete, or completed + "Edit": the full editable logging form. */}
      <EditingOnly>
        <div className="flex flex-col gap-5">
          {groupBlocks(session.blocks).map((group) =>
            group.blocks.length > 1 ? (
              <WodGroupCard
                key={group.key}
                group={group}
                sessionId={session.id}
                entryHistory={entryHistory}
                hintByEntry={hintByEntry}
                subByEntry={subByEntry}
                benchmarkAttempts={benchmarkAttempts}
                today={today}
              />
            ) : (
              <BlockCard
                key={group.blocks[0].id}
                block={group.blocks[0]}
                sessionId={session.id}
                entryHistory={entryHistory}
                hintByEntry={hintByEntry}
                subByEntry={subByEntry}
                benchmarkAttempts={benchmarkAttempts.get(group.blocks[0].id) ?? []}
                today={today}
              />
            )
          )}
        </div>

        <div className="mt-6 flex flex-col gap-4">
          <SessionEffort sessionId={session.id} initial={session.rpe} />
          <SessionNotes sessionId={session.id} initial={session.notes} />
        </div>

        {/* Incomplete only: the primary "Mark done" CTA. (A completed session
            being edited uses the ⋯ menu's Done editing / Reopen instead.) */}
        {!completed && (
          <div className="mt-6 flex border-t border-border/60 pt-4">
            <div className="ml-auto">
              <CompleteToggle sessionId={session.id} />
            </div>
          </div>
        )}
      </EditingOnly>
    </SessionEditProvider>
  );
}

// A WOD group is a run of consecutive blocks that belong to one named workout —
// e.g. "Steak and Pudding" Part 1 (cal bike) + Part 2 (AMRAP). Grouping uses the
// parser's explicit group_label, falling back to a "… Part N" title pattern so
// sessions parsed before group_label existed still group correctly.
type WodGroup = { key: string; label: string | null; blocks: BlockView[] };

function groupKeyFor(block: BlockView): { key: string | null; label: string | null } {
  if (block.groupLabel) return { key: block.groupLabel, label: block.groupLabel };
  const derived = parseWodTitle(block.title);
  if (derived.part && derived.base) return { key: derived.base, label: derived.base };
  return { key: null, label: null };
}

function partLabelFor(block: BlockView): string {
  if (block.groupLabel) return block.title ?? BLOCK_TYPE_LABEL[block.blockType];
  const derived = parseWodTitle(block.title);
  return derived.part ?? block.title ?? BLOCK_TYPE_LABEL[block.blockType];
}

function groupBlocks(blocks: BlockView[]): WodGroup[] {
  const groups: WodGroup[] = [];
  for (const block of blocks) {
    const { key, label } = groupKeyFor(block);
    const last = groups[groups.length - 1];
    if (key && last && last.key === key) {
      last.blocks.push(block);
    } else {
      groups.push({ key: key ?? `solo:${block.id}`, label, blocks: [block] });
    }
  }
  return groups;
}

function BlockBody({
  block,
  sessionId,
  entryHistory,
  hintByEntry,
  subByEntry,
  benchmarkAttempts,
  today,
}: {
  block: BlockView;
  sessionId: string;
  entryHistory: Map<string, MovementHistory>;
  hintByEntry: Map<string, SiblingHint>;
  subByEntry: Map<string, { id: string; name: string }>;
  benchmarkAttempts: BenchmarkAttempt[];
  today: string;
}) {
  return (
    <>
      {block.benchmarkName && (
        <div className="mb-3">
          <BenchmarkBanner name={block.benchmarkName} attempts={benchmarkAttempts} />
        </div>
      )}

      {/* Movements of one piece are grouped: a multi-movement piece gets a left
          rail + tint so it reads as a single circuit done together, rather than
          a list of unrelated exercises. */}
      <div
        className={
          block.entries.length > 1
            ? "flex flex-col gap-3 rounded-lg border-l-2 border-primary/25 bg-muted/15 py-2 pl-3 pr-1"
            : "flex flex-col gap-4"
        }
      >
        {block.entries.map((entry) => (
          <MovementEntry
            key={entry.id}
            entry={entry}
            sessionId={sessionId}
            history={entryHistory.get(entry.id) ?? null}
            siblingHint={hintByEntry.get(entry.id) ?? null}
            substitute={subByEntry.get(entry.id) ?? null}
            today={today}
          />
        ))}
      </div>

      {block.scoreType !== "none" || block.entries.length > 0 ? (
        <div className="mt-4">
          <BlockScore block={block} sessionId={sessionId} />
        </div>
      ) : null}
    </>
  );
}

function BlockCard({
  block,
  sessionId,
  entryHistory,
  hintByEntry,
  subByEntry,
  benchmarkAttempts,
  today,
}: {
  block: BlockView;
  sessionId: string;
  entryHistory: Map<string, MovementHistory>;
  hintByEntry: Map<string, SiblingHint>;
  subByEntry: Map<string, { id: string; name: string }>;
  benchmarkAttempts: BenchmarkAttempt[];
  today: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg text-foreground">
          {block.title ?? BLOCK_TYPE_LABEL[block.blockType]}
        </h2>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {BLOCK_TYPE_LABEL[block.blockType]}
        </span>
      </div>
      <BlockBody
        block={block}
        sessionId={sessionId}
        entryHistory={entryHistory}
        hintByEntry={hintByEntry}
        subByEntry={subByEntry}
        benchmarkAttempts={benchmarkAttempts}
        today={today}
      />
    </section>
  );
}

function WodGroupCard({
  group,
  sessionId,
  entryHistory,
  hintByEntry,
  subByEntry,
  benchmarkAttempts,
  today,
}: {
  group: WodGroup;
  sessionId: string;
  entryHistory: Map<string, MovementHistory>;
  hintByEntry: Map<string, SiblingHint>;
  subByEntry: Map<string, { id: string; name: string }>;
  benchmarkAttempts: Map<string, BenchmarkAttempt[]>;
  today: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 font-serif text-lg text-foreground">{group.label}</h2>
      <div className="flex flex-col divide-y divide-border/50">
        {group.blocks.map((block) => (
          <div key={block.id} className="py-3 first:pt-0 last:pb-0">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="font-medium text-foreground">{partLabelFor(block)}</h3>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {BLOCK_TYPE_LABEL[block.blockType]}
              </span>
            </div>
            <BlockBody
              block={block}
              sessionId={sessionId}
              entryHistory={entryHistory}
              hintByEntry={hintByEntry}
              subByEntry={subByEntry}
              benchmarkAttempts={benchmarkAttempts.get(block.id) ?? []}
              today={today}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function MovementEntry({
  entry,
  sessionId,
  history,
  siblingHint,
  substitute,
  today,
}: {
  entry: EntryView;
  sessionId: string;
  history: MovementHistory | null;
  siblingHint: SiblingHint | null;
  substitute: { id: string; name: string } | null;
  today: string;
}) {
  const name = entry.canonicalName ?? entry.rawName;
  // The prescription drives the suggested-load hint: use the first loaded set.
  const refSet =
    entry.sets.find((s) => s.prescribed.reps != null) ?? entry.sets[0] ?? null;

  // A movement inside a conditioning piece is part of the recipe: its result is
  // logged once on the block score, so its sets render as a compact line rather
  // than editable inputs (no double-entry). Scaled loads/reps are edited through
  // the pencil dialog; the line shows what you did, keeping the Rx visible when
  // they differ. Strength/accessory movements are logged set-by-set so their
  // loads feed e1RM.
  const isMetcon = (entry.sets[0]?.context ?? "strength") === "metcon";
  const metconLabels = entry.sets
    .map((s) => {
      const actual = formatSetMetric(s.metricType, s.actual);
      const rx = formatSetMetric(s.metricType, s.prescribed);
      if (actual === "—") return rx;
      return actual === rx ? actual : `${actual} (Rx ${rx})`;
    })
    .filter((label) => label !== "—");

  return (
    <div className="border-t border-border/40 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-1">
          <h3 className="font-medium text-foreground">{name}</h3>
          <EditEntryButton
            entryId={entry.id}
            sessionId={sessionId}
            movementName={name}
            initialNotes={entry.notes}
            sets={isMetcon ? entry.sets : []}
          />
        </div>
        {!isMetcon && (
          <div className="flex items-center gap-1.5">
            {entry.sets.map((s) => (
              <SetE1rmBadge key={s.id} set={s} />
            ))}
          </div>
        )}
      </div>

      {entry.notes && (
        <p className="mb-2 text-xs text-muted-foreground italic">{entry.notes}</p>
      )}

      {substitute && (
        <div className="mb-2">
          <SwapSuggestion
            entryId={entry.id}
            sessionId={sessionId}
            substitute={substitute}
          />
        </div>
      )}

      {history && entry.isLoaded && (
        <div className="mb-2">
          <MovementHistoryCard
            canonicalName={name}
            history={history}
            prescribedReps={refSet?.prescribed.reps ?? null}
            prescribedLoad={refSet?.prescribed.load ?? null}
            today={today}
            siblingHint={siblingHint}
          />
        </div>
      )}

      {isMetcon ? (
        metconLabels.length > 0 ? (
          <p className="text-xs text-muted-foreground">{metconLabels.join(" · ")}</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-1.5">
          {entry.sets.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatSetMetric(refSet?.metricType ?? "reps", refSet?.prescribed ?? {
                reps: null,
                load: null,
                unit: null,
                distance: null,
                duration: null,
                calories: null,
              })}
            </p>
          ) : (
            entry.sets.map((s, i) => (
              <SetEditor key={s.id} set={s} sessionId={sessionId} index={i} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
