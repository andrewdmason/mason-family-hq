"use client";

import { groupByBucket } from "@/lib/assignments/buckets";
import {
  DUE_BUCKET_LABELS,
  DUE_BUCKET_ORDER,
  type KidAssignments,
  type SchoolAssignment,
} from "@/lib/assignments/types";
import { cn } from "@/lib/utils";

export function AssignmentsClient({
  kids,
  isParent,
  connected,
}: {
  kids: KidAssignments[];
  isParent: boolean;
  connected: boolean;
}) {
  const totalAssignments = kids.reduce(
    (sum, k) => sum + k.assignments.length,
    0,
  );
  // Show a per-kid heading when a parent is looking at more than one child.
  const showKidHeadings = isParent && kids.length > 1;

  return (
    <div className="space-y-10">
      {/* Parents get the dedicated ConnectBentley card on the page; kids just
          get a gentle note while nothing is set up. */}
      {!connected && !isParent && totalAssignments === 0 && <ConnectNotice />}

      {kids.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No students are set up yet.
        </p>
      ) : (
        kids.map((kid) => (
          <KidSection
            key={kid.kidEmail}
            kid={kid}
            showHeading={showKidHeadings}
          />
        ))
      )}
    </div>
  );
}

function ConnectNotice() {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
      Your assignments will show up here once a parent connects this to Bentley.
    </div>
  );
}

function KidSection({
  kid,
  showHeading,
}: {
  kid: KidAssignments;
  showHeading: boolean;
}) {
  const groups = groupByBucket(kid.assignments);

  return (
    <section>
      {showHeading && (
        <h2 className="mb-3 font-serif text-lg tracking-tight text-foreground">
          {firstName(kid.kidName)}
        </h2>
      )}

      {kid.assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing due right now.
        </p>
      ) : (
        <div className="space-y-6">
          {DUE_BUCKET_ORDER.map((bucket) => {
            const items = groups.get(bucket);
            if (!items?.length) return null;
            return (
              <div key={bucket}>
                <h3
                  className={cn(
                    "mb-2 text-xs font-semibold uppercase tracking-wide",
                    bucket === "overdue"
                      ? "text-red-600"
                      : "text-muted-foreground",
                  )}
                >
                  {DUE_BUCKET_LABELS[bucket]}
                  <span className="ml-1.5 font-normal text-muted-foreground/70">
                    {items.length}
                  </span>
                </h3>
                <ul className="space-y-2">
                  {items.map((a) => (
                    <AssignmentRow key={a.id} assignment={a} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AssignmentRow({ assignment }: { assignment: SchoolAssignment }) {
  return (
    <li className="rounded-lg border bg-card px-3.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {assignment.title}
          </p>
          {assignment.course && (
            <p className="truncate text-xs text-muted-foreground">
              {assignment.course}
            </p>
          )}
        </div>
        {assignment.due_date && (
          <time className="shrink-0 text-xs text-muted-foreground">
            {formatDue(assignment.due_date)}
          </time>
        )}
      </div>
    </li>
  );
}

/** First name for a kid heading; falls back to "there" (mirrors home/members). */
function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "there";
}

function formatDue(dueDate: string): string {
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
