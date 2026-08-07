import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ReadingComprehensionLog } from "@/lib/types";

/**
 * The parent's diagnostic for the Part 1 gate: every try the reader made, what they
 * wrote, and the verdict and hint the grader gave back — plus the answer key the
 * grader was working from, so a wrong call is visible rather than mysterious.
 *
 * Adult-only (it shows the grader-facing anchor). Renders nothing when there's no
 * Part 1 at all; still renders on a cleared gate with no tries logged, since those
 * predate the log or were a parent override.
 */
export function ComprehensionLog({
  log,
  action = null,
}: {
  log: ReadingComprehensionLog;
  /** The "let them past Part 1" control, when it applies. */
  action?: React.ReactNode;
}) {
  if (!log.prompt && log.attempts.length === 0) return null;

  const cleared = log.clearedAt != null;
  const overridden = log.clearedByEmail != null;
  const misses = log.attempts.filter((a) => a.met !== true).length;

  return (
    <section className="mt-6 rounded-lg border border-border bg-muted/20 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Part 1 · quick check
        </p>
        {cleared ? (
          <Badge variant="outline">
            {overridden ? "Opened by a parent" : "Cleared"}
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className={cn(
              misses > 0 &&
                "border-amber-500/50 text-amber-700 dark:text-amber-400"
            )}
          >
            {misses > 0 ? `Stuck — ${misses} missed` : "Not cleared yet"}
          </Badge>
        )}
      </div>

      {log.prompt && (
        <p className="mt-3 border-l-2 border-muted pl-4 font-serif text-sm italic leading-relaxed text-muted-foreground">
          {log.prompt}
        </p>
      )}

      {log.anchorSummary && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            What the grader treats as the right answer
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {log.anchorSummary}
          </p>
          {log.rubric && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium">Bar for a pass:</span> {log.rubric}
            </p>
          )}
        </details>
      )}

      {log.attempts.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {overridden
            ? "No tries recorded — a parent opened the essay directly."
            : "No tries yet."}
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {log.attempts.map((a) => (
            <li
              key={a.id}
              className="rounded-md border border-border/60 bg-background px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">
                  Try {a.attemptNumber}
                  <span className="ml-2 font-normal text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </p>
                <span
                  className={cn(
                    "text-xs",
                    a.met === true
                      ? "text-emerald-700 dark:text-emerald-400"
                      : a.met === false
                        ? "text-amber-700 dark:text-amber-400"
                        : "text-muted-foreground"
                  )}
                >
                  {a.met === true
                    ? "Accepted"
                    : a.met === false
                      ? "Turned away"
                      : "Couldn't grade"}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                {a.answerText}
              </p>
              {a.note && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium">Told them:</span> {a.note}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      {action && <div className="mt-4 flex justify-end">{action}</div>}
    </section>
  );
}
