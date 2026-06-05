import { NextRequest } from "next/server";
import { readHomeCache, writeHomeCache } from "@/lib/home/cache";
import {
  generateHomeSuggestions,
  suggestionsWidgetKey,
} from "@/lib/home/suggestions";
import { localDate, resolveTimezone } from "@/lib/date-utils";
import type {
  HomeJournalAudience,
  HomeJournalSuggestion,
} from "@/lib/home/types";

export const runtime = "nodejs";

/**
 * Read-or-generate today's journal opening-question suggestions for one Home
 * widget (personal → "private", family → "family"). Idempotent per audience per
 * day: a cached set is returned as-is so the (relatively expensive) candidate
 * generation runs at most once per widget per day.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    audience?: string;
    tz?: string;
  };
  const audience: HomeJournalAudience =
    body.audience === "family" ? "family" : "private";
  const tz = await resolveTimezone(body.tz);
  const date = localDate(new Date(), tz);
  const key = suggestionsWidgetKey(audience);

  const cached = await readHomeCache<HomeJournalSuggestion[]>(key, date);
  if (cached && cached.length > 0) {
    return Response.json({ suggestions: cached });
  }

  try {
    const suggestions = await generateHomeSuggestions(audience, tz);
    if (suggestions.length > 0) {
      await writeHomeCache(key, date, suggestions);
    }
    return Response.json({ suggestions });
  } catch (err) {
    console.error("[home/journal-suggestions] generation failed:", err);
    return new Response("generation failed", { status: 500 });
  }
}
