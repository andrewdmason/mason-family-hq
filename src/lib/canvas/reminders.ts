import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendMail } from "@/lib/mail/gmail-dwd";

/**
 * The monthly key renewal. The school caps a student's Canvas key at 30 days,
 * so a few days before it runs out (or as soon as Canvas refuses it) the
 * parents get one email saying so, with the steps. Connecting a new key clears
 * `reminded_at`, so the next key gets its own reminder.
 */

const WARN_BEFORE = 5 * 864e5;
export const CANVAS_TOKEN_SETTINGS = "/profile/settings";

export async function remindExpiringCanvasKeys(db: SupabaseClient, siteUrl: string): Promise<number> {
  const { data: conns } = await db
    .from("canvas_connections")
    .select("student_id, base_url, token_expires_at, connected_by, reminded_at")
    .is("reminded_at", null)
    .not("token_expires_at", "is", null);
  const due = (conns ?? []).filter((c) => Date.parse(c.token_expires_at) - Date.now() <= WARN_BEFORE);
  if (due.length === 0) return 0;

  const { data: members } = await db.from("family_members").select("user_id, email, name, role");
  const parents = (members ?? []).filter((m) => m.role === "owner" || m.role === "parent");
  let sent = 0;

  for (const c of due) {
    const kid = members?.find((m) => m.user_id === c.student_id)?.name ?? "your kid";
    const sender = members?.find((m) => m.user_id === c.connected_by) ?? parents[0];
    if (!sender) continue;
    const expired = Date.parse(c.token_expires_at) <= Date.now();
    const when = new Date(c.token_expires_at).toLocaleDateString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const subject = expired ? `${kid}'s Canvas key for Tuttles has expired` : `${kid}'s Canvas key for Tuttles expires ${when}`;
    const steps = [
      `${expired ? "Tuttles can't read" : "Tuttles will stop reading"} ${kid}'s Canvas ${expired ? "until it gets a new key" : `on ${when}`}. The school caps these keys at 30 days, so this comes up monthly. It takes a minute:`,
      "",
      `1. Signed in to Canvas as ${kid}, open ${c.base_url}${CANVAS_TOKEN_SETTINGS} and click "+ New Access Token". Name it Tuttles and pick the latest expiry it allows.`,
      `2. Paste the key on ${siteUrl}/tuttles under Canvas.`,
    ];
    const html = steps
      .map((l) => (l ? `<p>${l.replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>')}</p>` : ""))
      .join("");

    for (const parent of parents) {
      try {
        if (
          await sendMail({
            fromEmail: sender.email,
            fromName: "Tuttles",
            toEmail: parent.email,
            subject,
            text: steps.join("\n"),
            html,
            threadKey: `tuttles-canvas-${c.student_id}`,
          })
        ) {
          sent += 1;
        }
      } catch (err) {
        console.error("[canvas-reminder] send failed", parent.email, err);
      }
    }
    await db.from("canvas_connections").update({ reminded_at: new Date().toISOString() }).eq("student_id", c.student_id);
  }
  return sent;
}
