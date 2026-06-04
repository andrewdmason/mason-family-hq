// Code-level defaults for a brand-new journal user.
//
// New family members are normally seeded by *copying the owner's* tuned
// Interviewer voice, question types, and settings (see provisioning.ts). These
// constants are the fallback for the very first owner on a fresh database (where
// there's no tuned owner to copy yet) and keep the seed content in one place
// rather than only in SQL migrations.

/**
 * The interviewer voice file every new user starts with. Generic on purpose —
 * voice and craft only, no person-specific topics. Each user (or the agent over
 * time) tunes their own copy; this is just the starting point.
 */
export const DEFAULT_INTERVIEWER = `# Interviewer

You are a thoughtful friend, not a therapist or coach.

## Voice

Warm. Quiet. Curious. The voice of someone who has known the user a long time and pays attention. Never performative.

## How you ask the opening question

- One or two sentences. Never longer. Never multi-part.
- Genuinely curious, not formulaic.
- Mix specific/concrete questions with reflective/abstract ones — but lean concrete most days.
- Favor the present and the recent past — things that have already happened or are happening now. Questions about upcoming events should be rare. (This is the dial for how future-facing the questions feel; adjust it here.)
- Small moments are valid. They often produce the best entries.
- Vary across days. Don't ask about the same domain two days in a row.
- Reserve deeply reflective questions ("what have you been chewing on that you haven't told anyone about?") for the right moment — high risk, high reward.
- Output only the question itself. No preamble, no greeting, no framing.
- Never narrate research or reasoning. The question just shows up, perfectly timed, like a friend texting in the morning.
- Never use "I notice that..." or "It sounds like..." preambles. Just ask.

## How you follow up

- One follow-up at a time.
- Stay in the territory the user opened — don't pivot.
- It's okay to be brief ("what made it land that way?").
- It's okay to be specific ("which part of it surprised you?").
- Don't summarize what they said back to them. Just ask the next thing.
- Don't push if they seem done.

## What to avoid

- Generic prompts like "How are you feeling today?"
- Anything that reads like a self-help worksheet.
- Therapist-speak ("how does that make you feel", "sit with that").
- Coach-speak ("what would success look like", "what's one thing you could do").
- Showing the user any "context" or "reasoning" about how you chose the question.
`;

/**
 * New users start with a blank Present (current-life) profile. Rather than fill
 * in a template by hand, the User settings tab offers a copyable questionnaire
 * prompt (see buildUserDocPrompt) that walks them through it in a chatbot and
 * writes the doc for them to paste back.
 */
export const DEFAULT_PRESENT_PROFILE = "";

export const DEFAULT_QUESTIONS_PER_DAY = 3;

export type BuiltinQuestionType = {
  name: string;
  base_description: string;
  weight: number;
  sort_order: number;
};

/**
 * The built-in question types. Their weight here is the *adult* default — the
 * four kid types (favorites, imagination, proud-moment, funny-moment) default to
 * 0 (off), and the age templates turn them on with an age-appropriate mix.
 *
 * The set was simplified in migration 00071, which merged four clusters of
 * near-duplicates (daily-recap → recent-calendar, upcoming-calendar →
 * intentions, unresolved-loop → historical-followup, and mood-check-in +
 * sensory-moment folded into a refocused, source-grounded gratitude) and added
 * the `principles` type. Keep this array in sync with that migration so a fresh
 * code seed and a migrated database land on the same set.
 */
export const BUILTIN_QUESTION_TYPES: BuiltinQuestionType[] = [
  { name: "recent-calendar", weight: 12, sort_order: 1, base_description: "Asks about a specific recent moment that already happened — pulled from your connected calendar over the last few days, or just from your day, including yesterday. Best once it has already happened; don't ask about today's still-upcoming events or anything in the future." },
  { name: "historical-followup", weight: 6, sort_order: 3, base_description: "Re-reads your own earlier journal entries and picks up a specific thread — an older one that's had time to develop or settle, or a more recent worry or tension you mentioned but left unresolved — and checks back on it, referencing it directly. Only draws on entries you wrote yourself, never another family member's shared post." },
  { name: "me-topic", weight: 6, sort_order: 4, base_description: "Draws on your Present doc — projects, interests, people — and asks about one, rotating so it doesn't fixate on the same thing. Stays in the Present doc: never pulls from your calendar at all, neither upcoming events nor past ones (a recital, a game, an appointment) — the calendar question types own those. If the Present doc is thin, ask a broader question about a known project or interest rather than reaching for a calendar event." },
  { name: "deep-introspective", weight: 6, sort_order: 5, base_description: "An open, reflective prompt aimed at something unspoken or unresolved. Not tied to any event — high risk, high reward." },
  { name: "gratitude", weight: 3, sort_order: 6, base_description: "A prompt to name something you're grateful for — anchored to something specific, not a generic 'what are you grateful for today?'. Draw on the Present doc (a person, project, or place that matters to you) or a recent entry so the gratitude centers on a real person, thing, or moment in your life." },
  { name: "intentions", weight: 3, sort_order: 9, base_description: "A forward-looking prompt about what's coming up and what you want from it — today, tomorrow, or the week ahead — with a light read on what's on your calendar." },
  { name: "relationship", weight: 3, sort_order: 11, base_description: "Surfaces a specific person from your Present doc or recent entries and asks about a recent moment with them. The question has to center on that person and your connection — never reframe a solo activity or calendar event (a recital, a workout, an errand) as a relationship question. If no specific person fits, ask about someone in your life rather than reaching for something on your calendar." },
  { name: "curveball", weight: 1, sort_order: 12, base_description: "A deliberately unexpected, playful prompt from an angle you wouldn't predict. Not based on your data." },
  { name: "favorites", weight: 0, sort_order: 14, base_description: "Asks you to name a favorite from today — a food, a song, a moment, something you played or watched. Light and concrete." },
  { name: "imagination", weight: 0, sort_order: 15, base_description: "A playful what-if or would-you-rather — pure imagination, not tied to your real day." },
  { name: "proud-moment", weight: 0, sort_order: 16, base_description: "Asks about something you figured out, pulled off, or feel proud of." },
  { name: "funny-moment", weight: 0, sort_order: 17, base_description: "Asks about something that made you laugh recently." },
  { name: "reminiscence", weight: 3, sort_order: 18, base_description: "Invites the user to tell a story from their past or reminisce on something old — a memory, a place, a person, a turning point. Targets a specific event from their timeline so the question is concrete." },
  { name: "family-followup", weight: 3, sort_order: 19, base_description: "Draws on a recent entry another family member shared to the family feed and asks the user about it, referencing that member by name (e.g. \"Jenny wrote about the camping trip — how was that for you?\"). Only fires when another member has shared something." },
  { name: "principles", weight: 3, sort_order: 20, base_description: "Invites you to put a principle, belief, or value into words and ground it in a real story — something that happened that taught it to you, or shows it in action. Draw on your timeline, your Present doc, and your earlier entries to make it specific and personal. The kind of thing worth passing down." },
  { name: "currently-reading", weight: 3, sort_order: 21, base_description: "Asks about a book from your reading life — a character, an idea, a passage that's stayed with you, or how it landed. Grounded in a specific book from your Reading list, whether you're partway through it or finished it a while ago." },
];
