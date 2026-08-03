import "server-only";
import { getIsAdult } from "@/lib/members/auth";

/**
 * Who is allowed to have a book read to them: adults, and for now only adults.
 *
 * A deliberate hold, written down rather than left to be an accident of where
 * the reader happens to live. Two reasons, and the second is the one that would
 * be hard to undo:
 *
 * The kids' reading is a PROGRAMME — weekly goals, check-ins, quizzes, and
 * Mason Bucks attached to the whole thing. A goal you can complete by pressing
 * play stops measuring reading practice and starts measuring patience, and that
 * change would happen silently, to targets that were set assuming something
 * else. And a chapter costs real money on an account nobody is watching.
 *
 * There is a genuinely good version of this for a kid — read-along, where the
 * voice reads and the words light up as they go, which is well-evidenced for a
 * struggling or reluctant reader. That's a different feature with different
 * rules: parent-enabled per book, probably capped, probably counting toward
 * goals at a discount or not at all. Worth building on purpose later; not worth
 * arriving by accident now.
 */
export async function requireListening(): Promise<void> {
  if (!(await getIsAdult())) {
    throw new Error("Listening to books isn't available on this account.");
  }
}
