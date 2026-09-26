// An at-bat's feed thumbnail over a stable same-origin URL. Like the member
// photo route, this keeps expiring signed URLs out of page HTML that the app
// shell may later replay from cache. `?v=` (the at-bat's updated_at) busts the
// browser cache when a new thumbnail is captured.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CLIPS_BUCKET } from "@/lib/clips/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ atBatId: string }> },
) {
  const { atBatId } = await params;
  const sb = await createClient();
  const { data: ab } = await sb
    .from("clip_at_bats")
    .select("poster_path")
    .eq("id", atBatId)
    .maybeSingle();
  if (!ab?.poster_path) return new NextResponse(null, { status: 404 });

  const { data: blob } = await sb.storage.from(CLIPS_BUCKET).download(ab.poster_path);
  if (!blob) return new NextResponse(null, { status: 404 });
  return new NextResponse(blob, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
