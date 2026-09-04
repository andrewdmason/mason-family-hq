import { NextRequest, NextResponse } from "next/server";
import { PlainAccessError, resolvePlainBook } from "@/lib/reading/plain/access";
import { reconcileHash } from "@/lib/reading/plain/batch";
import { planVersion, readPlainPlan } from "@/lib/reading/plain/plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A book's translation as the reader sees it: chapter statuses, the paragraphs
 * of every ready chapter, and the glossary.
 *
 * Polled while chapters are pending, so it is never cacheable by intermediaries
 * — but it does answer 304 to a matching ETag, because the paragraph payload is
 * a few hundred kilobytes and the common poll answer is "nothing changed".
 *
 * Reading this is also what ingests a finished batch while somebody is looking:
 * the cron sweep is the backstop for the batch that finishes overnight.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params;

  let access;
  try {
    access = await resolvePlainBook(bookId);
  } catch (err) {
    if (err instanceof PlainAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  try {
    try {
      await reconcileHash(access.admin, access.hash);
    } catch (err) {
      // A batch we can't reach right now is not a reason to hide the chapters
      // that are already done.
      console.error("[plain] reconcile failed", err);
    }

    const version = await planVersion(access.admin, access.hash);
    const etag = `"${access.hash.slice(0, 16)}-${version}"`;
    if (req.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": "private, no-store" },
      });
    }

    const plan = await readPlainPlan(access.admin, access.hash);
    return NextResponse.json(plan, {
      headers: { ETag: etag, "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't load the translation.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
