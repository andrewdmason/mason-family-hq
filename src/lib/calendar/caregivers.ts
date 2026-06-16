// Nannies / babysitters who do drop-off and pick-up. A duty assigned to a
// caregiver behaves exactly like N/A (no drive block on anyone's Google
// calendar — see desiredFor in drive-events.ts) but records WHO, so it shows
// on the event card. These are free-text labels, not family_members: caregivers
// aren't members and have no calendars. Add or rename here.
export const CAREGIVERS = ["Marina", "Elias"] as const;

export type Caregiver = (typeof CAREGIVERS)[number];

/** Match a free-form string against a known caregiver, case-insensitively.
 * Returns the canonical name (e.g. "marina" → "Marina") or null. */
export function normalizeCaregiver(value: string): Caregiver | null {
  const v = value.trim().toLowerCase();
  return CAREGIVERS.find((c) => c.toLowerCase() === v) ?? null;
}

// Caregivers have no member color — duty chips render in a neutral slate so they
// read as "covered, but not a parent".
export const CAREGIVER_COLOR = "#64748b"; // slate-500
