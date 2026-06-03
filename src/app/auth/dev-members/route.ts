import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Dev-only: lists family members so the login page can offer a quick switcher.
// Never available against production Supabase.
export async function GET() {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.NEXT_PUBLIC_SUPABASE_ENV === "production"
  ) {
    return NextResponse.json({ members: [] }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("family_members")
    .select("email, name, role")
    .order("created_at", { ascending: true });

  // Owner first, then creation order. (Text role doesn't sort owner-first, so do
  // it here rather than in the query.)
  const members = (data ?? []).sort(
    (a, b) => Number(b.role === "owner") - Number(a.role === "owner")
  );

  return NextResponse.json({ members });
}
