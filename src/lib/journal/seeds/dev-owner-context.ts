import type { createAdminClient } from "@/lib/supabase/admin";

// Local-dev convenience: the owner's Present (current life) doc. New users are
// provisioned with an EMPTY Present by design — meant to be filled via the
// questionnaire — so on a fresh local setup the owner's source-grounded question
// types (me-topic, relationship, gratitude, …) have nothing to draw on.
// backfillOwnerContext fills it in for the owner, and ONLY when it's still empty,
// so it never clobbers later edits. (Life history lives in the seeded timeline.)
//
// This is dev-only: it's called solely from /auth/dev-login (which is gated to
// NODE_ENV === "development" and a non-production Supabase). Production owners
// still start blank and fill the docs themselves.

type AdminClient = ReturnType<typeof createAdminClient>;

export const DEV_OWNER_PRESENT = `# Andrew

## Situation

Left Descript (was CEO/founder). Not currently working a traditional job — not retired, but flexible. Has many interests; usually has half a dozen project ideas in various stages.

## Family

- Jenny — wife (Jenny Gillespie Mason). Coordinates the family calendar.
- Sebastian — older son. Bentley School (K-8). Plays guitar (Thursday lessons), baseball / batting cage (FSB).
- Oscar — younger son. Baseball with Coach Ben (Tuesdays 4–6pm at FSB, ages 8–12). Basketball Saturdays.
- Kids attend school in the East Bay. Andrew does morning drop-off (~7:55am).

## People (non-family)

People Andrew has mentioned. Update as new names surface in journal entries.

- Nick Josefowitz — friend in Berkeley. Plays board games with Andrew.
- Vera — works with Andrew on TTL. Weekly Monday noon meeting.
- Yoshi — Andrew's piano teacher at SFCM (Wednesday lessons).
- Coach Ben — coaches Oscar's baseball (Tuesdays at FSB).
- Sunny — former Descript employee. Getting married in Thailand in November; Andrew hopes to attend with the family.

## Currently working on

Active:

- Tabletop Library (TTL) — board game library/venue in the East Bay. Major focus.
- Descript Board — board of directors role at his former company.
- Morning journal app — this app you live in (AI-driven daily interview-style journaling).
- Christmas trip planning — researching Four Seasons properties: Anguilla, Nevis, Punta Mita. Also looked at Maldives (Jan–April best).
- Thailand trip (November) — Sunny (former Descript employee) is getting married in Thailand. Andrew hopes to go with the family.
- Bentley School Board — board member at the kids' school.
- Piano practice tracking app — personal app (practice book), not for release.

Planning:

- SFCM board exploration (researching trustees and board involvement at SF Symphony, SF Opera).
- Interactive book reading app (making books more alive / conversational via chatbots).

Backlog:

- Media engagement frameworks — analytical project on what makes media engaging across dimensions like sensory richness, agency, imagination, cognitive demand.

## Interests

- Board games — deep interest. Runs TTL. Thinks about game design and taxonomy. Plays games with Nick Josefowitz in Berkeley.
- Music — piano lessons at SFCM with Yoshi (Wednesdays). Chamber music coaching Mondays. Zellerbach subscription. Interested in the institutional side (board research).
- Photography — shoots Leica. Lightroom. Recent subjects: family, kids' baseball, travel.
- CrossFit — CrossFit Oakland. Auto-signed up for 9am weekday classes.
- AI & education — researching how schools should integrate AI. Comparing Bentley, Head-Royce, College Prep.
- Reading / intellectual — analytical thinker. Likes frameworks and taxonomies (e.g. found "ponderous" for slow-but-thoughtful game tempo).

## Recurring rhythms

- Morning school drop-off ~7:55am
- CrossFit 9am weekdays
- TTL work Mondays (noon meeting with Vera + team at 3048 Claremont Ave, Berkeley)
- Piano lesson Wednesdays at SFCM
- Chamber music coaching Mondays 6–7:30pm
- Kids' sports late afternoon / evening

## Open threads

- What does this post-Descript chapter look like — identity, purpose, pace.
- What makes some media/entertainment forms more engaging than others.
- The institutional landscape of Bay Area arts organizations.
- Navigating school choices and how schools handle technology / AI.
- Building TTL — operations, hiring, brand.
- Balancing a full family schedule with personal interests.
- Lots of app ideas — what to commit to building vs. just thinking about.
`;

/**
 * Fill the owner's Present doc from the dev fixture, but only where it's still
 * empty — so it seeds a fresh local setup without ever overwriting edits made
 * through the app or the questionnaire. Safe to call on every dev-login
 * (idempotent once the doc has content).
 */
export async function backfillOwnerContext(
  admin: AdminClient,
  userId: string
): Promise<void> {
  for (const [name, content] of [["Present", DEV_OWNER_PRESENT]] as const) {
    await admin
      .from("journal_agent_files")
      .update({ content })
      .eq("user_id", userId)
      .eq("name", name)
      .eq("content", "");
  }
}
