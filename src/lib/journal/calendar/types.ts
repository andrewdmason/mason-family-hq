/**
 * Which direction the calendar block reaches, chosen per question type:
 * - "recent": looks back, including today's already-happened events (recent-calendar).
 * - "ahead": looks back a short tail plus forward (the only forward-looking
 *   window — intentions).
 *
 * The span defaults to the built-in 3-back / 7-ahead, but a recurring post scales
 * it to its cadence (see loadCalendarBlock's `spanDays`): a weekly recap looks
 * back ~7 days, a monthly one ~30.
 */
export type CalendarWindow = "recent" | "ahead";

export type CalendarSource = {
  id: string;
  displayName: string;
  feedUrl: string;
};

export type NormalizedEvent = {
  sourceId: string;
  sourceName: string;
  title: string;
  start: Date;
  end: Date | null;
  allDay: boolean;
  location: string | null;
  tentative: boolean;
};

export type FeedResult =
  | {
      ok: true;
      sourceId: string;
      sourceName: string;
      events: NormalizedEvent[];
    }
  | {
      ok: false;
      sourceId: string;
      sourceName: string;
      error: string;
    };
