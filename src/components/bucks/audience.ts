import type { BucksKidSummary } from "@/lib/bucks/types";

/** AudienceSelect value meaning "both kids" (audience_user_id null). */
export const SHARED = "__shared__";

/** The select value (kid email or SHARED) → the audience email an action wants. */
export function audienceEmail(value: string): string | null {
  return value === SHARED ? null : value;
}

/** Readable label for a stored audience user id. */
export function audienceLabel(userId: string | null, kids: BucksKidSummary[]): string {
  if (!userId) return "Both kids";
  return kids.find((k) => k.userId === userId)?.name ?? "One kid";
}

/** The AudienceSelect value (email or SHARED) for a stored audience user id. */
export function audienceValue(userId: string | null, kids: BucksKidSummary[]): string {
  if (!userId) return SHARED;
  return kids.find((k) => k.userId === userId)?.email ?? SHARED;
}
