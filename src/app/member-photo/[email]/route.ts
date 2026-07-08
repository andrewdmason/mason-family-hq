// Serves a family member's primary profile photo over a STABLE same-origin URL.
//
// The image bytes live in the private `member-photos` bucket, so we can't hand
// out a public URL. Instead of baking an expiring signed URL into page HTML
// (which breaks when that HTML is later served stale from the PWA cache — see
// src/lib/media/member-photo-url.ts), the avatar's <img src> points here. Each
// request re-reads the current primary photo and streams it fresh, so the URL in
// the HTML never goes stale.
//
// Auth: the route is inside the middleware's session gate, so an unauthenticated
// request is bounced to /login before it reaches here, and the RLS-scoped client
// only sees rows the caller is allowed to read — the private bucket stays private.

import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MEMBER_PHOTOS_BUCKET = "member-photos";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ email: string }> },
) {
  const { email } = await params;
  const target = decodeURIComponent(email).toLowerCase();

  const supabase = await createClient();

  // Match case-insensitively: member_email casing isn't guaranteed to match the
  // lowercased path segment, and emails carry no LIKE wildcards to worry about.
  const { data: photos } = await supabase
    .from("journal_member_photos")
    .select("member_email, storage_path")
    .eq("is_primary", true);

  const path = photos?.find(
    (p) => (p.member_email as string).toLowerCase() === target,
  )?.storage_path as string | undefined;

  if (!path) return new NextResponse(null, { status: 404 });

  const { data: blob, error } = await supabase.storage
    .from(MEMBER_PHOTOS_BUCKET)
    .download(path);

  if (error || !blob) return new NextResponse(null, { status: 404 });

  return new NextResponse(blob, {
    headers: {
      "Content-Type": blob.type || "image/jpeg",
      // Per-user (private) and cacheable briefly so repeated avatars on a page
      // don't refetch, while a changed primary photo still shows within minutes.
      "Cache-Control": "private, max-age=600",
    },
  });
}
