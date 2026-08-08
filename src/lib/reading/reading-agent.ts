import "server-only";

/**
 * LAYER 1 — THE AGENT. Who is talking.
 *
 * One of these opens every prompt in the reader: the anchored chat, both
 * mid-book templates, and both of the reader's own documents. It is the same
 * person throughout, given a different brief each time.
 *
 * DELIBERATELY SHORT, and that is the design rather than an accident of
 * drafting. What these prompts kept doing was reacting to a bad answer by
 * writing another rule, and a rule is a much blunter instrument than it looks:
 * told repeatedly to have a position and commit to it, the companion argued at
 * a reader who had asked a simple question. The thing being aimed for is a good
 * conversation with a well-read person, which is what an unprompted Claude
 * already gives you — so the job here is to say who is in the room and what
 * this book is, then get out of the way.
 *
 * Both are TEACHERS, not critics. The prompts had grown an adversarial streak
 * nobody asked for — demanding an argument, testing whether the evidence bore
 * the weight put on it, saying so when it found a book unconvincing. That reads
 * as rigour and is the wrong relationship: the reader did not come for a verdict
 * on the book, they came to get more out of it than they would alone. Judging is
 * easier to write than teaching and it sounds smarter, so it will keep trying to
 * creep back in.
 */

/** Which agent is in the room, decided by what kind of book this is. */
export type ReadingAgent = "literature" | "subject" | "neutral";

/**
 * What each one is called, for the prompt inspector.
 *
 * Worth a name rather than leaving it to be inferred from the prose. Which agent
 * a book gets is the single most consequential thing about its prompt and the
 * hardest to check by eye — the two personas are four sentences each and read
 * alike at a glance, so telling them apart meant finding the clause that differs.
 * A label makes a wrong classification obvious instead of subtle.
 */
export const AGENT_LABELS: Record<ReadingAgent, string> = {
  literature: "Literature professor",
  subject: "Subject teacher",
  neutral: "Generalist",
};

/**
 * `fiction` is genuinely null for some books — autofiction, essay collections,
 * anything the classifier declined — and a companion confidently in the wrong
 * mode is worse than one that stays open. Only ever fiction/non-fiction, never
 * the genre: handing the model twenty genre labels invites it to PERFORM the
 * genre, which is a worse failure than the one it fixes.
 */
export function agentFor(fiction: boolean | null): ReadingAgent {
  if (fiction === true) return "literature";
  if (fiction === false) return "subject";
  return "neutral";
}

const AGENTS: Record<ReadingAgent, string> = {
  literature:
    "You are the user's reading companion, playing the role of a great " +
    "literature professor and teacher: coaching them through this book and " +
    "helping them get meaning from it.",
  subject:
    "You are the user's reading companion, playing the role of a great teacher " +
    "on the subject this book is about: coaching them through it and helping " +
    "them get meaning and use out of its ideas.",
  neutral:
    "You are the user's reading companion, playing the role of a great " +
    "teacher: coaching them through this book and helping them get meaning " +
    "from it.",
};

/**
 * The agent block — who is talking, and nothing else.
 *
 * There is deliberately no line here about HOW to talk. There was one, telling
 * it to use contractions and plain words and to prefer being interesting over
 * sounding impressive, and it was cut for the reason every line here has to
 * survive: the model already does that. An instruction that buys nothing is not
 * free — it lengthens the prompt, it competes with the instructions that do
 * matter, and a model handed a list of ways to sound natural starts sounding
 * like something working through a list.
 *
 * THE BAR FOR ANYTHING ADDED HERE: would an unprompted Claude, told only what
 * book this is and who it is talking to, get this wrong? If not, leave it out.
 * A plain Claude conversation about a novel is already good; the job of this
 * file is to give it the book and the reader, not to teach it to read.
 */
export function agentPrompt(fiction: boolean | null): string {
  return AGENTS[agentFor(fiction)];
}
