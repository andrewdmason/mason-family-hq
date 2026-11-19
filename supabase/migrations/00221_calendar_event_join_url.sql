-- How to join an event that happens on a call: a Zoom, Google Meet, Microsoft
-- Teams (…) link, kept apart from where the event is.
--
-- Calendars put the link in different places: Google has its own conference
-- field (a Meet link is never in the location), booking tools write "Click to
-- join meeting: https://…" into the location, and people paste an invitation
-- into the description. The clients used to see only the location, so a link
-- there was drawn as a place (a map pin that searched Maps for a URL, a drive
-- to arrange), and a link anywhere else wasn't seen at all.
--
-- join_url is worked out here, in one place, for every writer (the three
-- syncs, the app's saves, the agent API): a trigger sets it on each write, so
-- nothing has to remember to. location and description stay as they were
-- written, which is what goes back to Google.
--
--   conference_url  what Google's conference field says (google-sync.ts)
--   join_url        the link to join by, or NULL when the event isn't a call

ALTER TABLE calendar_events
  ADD COLUMN conference_url text,
  ADD COLUMN join_url text;

-- The link to join by, looked for in order:
--   1. Google's conference field.
--   2. The location: a call service's link, else any link that isn't a map
--      (a location that is a link is how you get there).
--   3. The description: a call service's link only. Descriptions are full of
--      other links (a team page, a sign-up form), so nothing is guessed.
-- Written as it should be opened: with a scheme, without the punctuation or
-- HTML that happened to follow it.
CREATE FUNCTION calendar_join_url(conference text, location text, description text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  -- A link runs to the next space, quote, bracket or backslash (descriptions
  -- from Google are HTML, those from ICS feeds keep their escapes).
  rest constant text := '[^\s<>"''\\]*';
  -- The call services, each by the shape of its meeting links (zoom.us/j/…
  -- is a meeting, zoom.us/u/… is its list of dial-in numbers). The scheme is
  -- optional: people type "zoom.us/j/123".
  call constant text :=
    '(?:^|[^a-z0-9.@/-])((?:https?://)?(?:[a-z0-9-]+\.)*(?:'
    || 'zoom\.us/(?:j|my|w|s|wc/join)/'
    || '|zoomgov\.com/(?:j|my|w|s|wc/join)/'
    || '|meet\.google\.com/[a-z0-9]'
    || '|teams\.microsoft\.com/(?:l/meetup-join|meet)/'
    || '|teams\.live\.com/meet/'
    || '|webex\.com/[a-z0-9]'
    || '|facetime\.apple\.com/join'
    || '|whereby\.com/[a-z0-9]'
    || '|gotomeet\.me/[a-z0-9]'
    || '|gotomeeting\.com/join/'
    || '|meet\.goto\.com/[a-z0-9]'
    || '|join\.skype\.com/[a-z0-9]'
    || '|bluejeans\.com/[a-z0-9]'
    || '|chime\.aws/[a-z0-9]'
    || '|meet\.jit\.si/[a-z0-9]'
    || '|doxy\.me/[a-z0-9]'
    || ')' || rest || ')';
  -- A link to a map is a place, not a call.
  map constant text :=
    '^https?://(?:[a-z0-9-]+\.)*(?:maps\.google\.|google\.[a-z.]+/maps|maps\.app\.goo\.gl|goo\.gl/maps|g\.co/kgs|maps\.apple\.com|waze\.com)';
  found text;
BEGIN
  IF conference ~* '^https?://\S+$' THEN
    RETURN conference;
  END IF;

  found := (pg_catalog.regexp_match(location, call, 'i'))[1];
  IF found IS NULL THEN
    found := (pg_catalog.regexp_match(location, '(https?://[a-z0-9]' || rest || ')', 'i'))[1];
    IF found ~* map THEN
      found := NULL;
    END IF;
  END IF;
  IF found IS NULL THEN
    found := (pg_catalog.regexp_match(description, call, 'i'))[1];
  END IF;
  IF found IS NULL THEN
    RETURN NULL;
  END IF;

  found := pg_catalog.replace(found, '&amp;', '&');
  found := pg_catalog.rtrim(found, '.,;:!?)]}');
  IF found !~* '^https?://' THEN
    found := 'https://' || found;
  END IF;
  RETURN found;
END;
$$;

CREATE FUNCTION calendar_events_set_join_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.join_url := public.calendar_join_url(NEW.conference_url, NEW.location, NEW.description);
  RETURN NEW;
END;
$$;

-- Every write, not only those of the three columns: a row copied whole (a
-- repeating event split in two) can't then carry a stale link along.
CREATE TRIGGER calendar_events_join_url
  BEFORE INSERT OR UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION calendar_events_set_join_url();

-- The events already here. Only those with a link are touched (the trigger
-- sets the column; the assignment is what makes it a write).
UPDATE calendar_events
SET join_url = public.calendar_join_url(conference_url, location, description)
WHERE public.calendar_join_url(conference_url, location, description) IS NOT NULL;
