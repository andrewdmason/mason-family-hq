import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Kid } from "./types";

// The two tracked boys (kind='kid'), ordered for the picker. Family-wide read
// RLS means any signed-in member sees the same list.
export async function getKids(): Promise<Kid[]> {
  const sb = await createClient();
  const { data } = await sb
    .from("baseball_people")
    .select("slug, display_name")
    .eq("kind", "kid")
    .order("display_name");
  return (data ?? []).map((p) => ({ slug: p.slug, displayName: p.display_name }));
}

type Client = Awaited<ReturnType<typeof createClient>>;

export async function resolvePerson(
  slug: string,
  client?: Client,
): Promise<{ id: string; displayName: string } | null> {
  const sb = client ?? (await createClient());
  const { data } = await sb
    .from("baseball_people")
    .select("id, display_name")
    .eq("slug", slug)
    .maybeSingle();
  return data ? { id: data.id, displayName: data.display_name } : null;
}
