// A member's primary avatar, addressed by a STABLE same-origin URL instead of a
// short-lived Supabase signed URL.
//
// Why this exists: signed URLs expire (~1h). When a page's HTML is served stale
// from the PWA cache (service worker StaleWhileRevalidate), any signed URL baked
// into that HTML at render time has usually expired by the time the page paints
// on the next cold launch — so avatars render as broken images until a manual
// reload fetches fresh HTML. A stable URL never goes stale: the /member-photo
// route mints a fresh signed URL (server-side) on every request, so however old
// the surrounding HTML is, the avatar still loads.
//
// Returns null-safe stable path; callers still gate on "does this member have a
// primary photo?" so members without one fall back to initials (a 404 here would
// otherwise render as its own broken image).
export function memberPhotoUrl(email: string): string {
  return `/member-photo/${encodeURIComponent(email.toLowerCase())}`;
}
