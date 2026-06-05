import { FamilyHeaderClient } from "@/components/family/header-client";
import { requireUserId } from "@/lib/members/auth";
import { getJournalNotifications } from "@/lib/journal/notifications";
import { createClient } from "@/lib/supabase/server";

export async function FamilyHeader() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const notifications = await getJournalNotifications(supabase, userId);

  return <FamilyHeaderClient notifications={notifications} />;
}
