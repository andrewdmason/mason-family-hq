import { FamilyHeaderClient } from "@/components/family/header-client";
import { getIsOwner, requireUserId } from "@/lib/members/auth";
import { getJournalNotifications } from "@/lib/journal/notifications";
import { createClient } from "@/lib/supabase/server";

export async function FamilyHeader() {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const [notifications, isOwner] = await Promise.all([
    getJournalNotifications(supabase, userId),
    getIsOwner(supabase),
  ]);

  return (
    <FamilyHeaderClient notifications={notifications} isOwner={isOwner} />
  );
}
