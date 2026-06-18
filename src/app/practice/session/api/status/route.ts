import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Poll a session's processing status (plan U7). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const { data: session } = await supabase
    .from("practice_sessions")
    .select("status, confidence, error_message, audio_retained")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let taskCount = 0;
  if (session.status === "ready") {
    const { count } = await supabase
      .from("practice_tasks")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    taskCount = count ?? 0;
  }

  return NextResponse.json({
    status: session.status,
    confidence: session.confidence,
    error: session.error_message,
    audioRetained: session.audio_retained,
    taskCount,
  });
}
