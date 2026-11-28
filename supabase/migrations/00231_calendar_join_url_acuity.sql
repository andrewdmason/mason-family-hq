-- Calendar: a booking service's link to its call is a link to join by.
--
-- Acuity (Test Innovators' tutoring, among others) doesn't put the Zoom link
-- in the invitation: it puts its own, app.acuityscheduling.com/schedule.php?
-- …&action=zoom, which sends you on to the meeting. calendar_join_url (00221)
-- only knew the call services' own links, so those events had no join_url,
-- and the apps showed "Zoom" as a place you can't open.
--
-- The same function, with Acuity's redirect among the call services; then
-- every event it now finds a link for is brought up to date.

CREATE OR REPLACE FUNCTION calendar_join_url(conference text, location text, description text)
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
    -- A booking service's redirect to the call it made: Acuity's join link
    -- is schedule.php?…&action=zoom, beside its reschedule/cancel links
    -- (action=appt), which aren't calls.
    || '|acuityscheduling\.com/schedule\.php\?(?=(?:[^\s<>"''\\]*[&;])?action=(?:zoom|meet|teams)\M)'
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

UPDATE calendar_events
SET join_url = public.calendar_join_url(conference_url, location, description)
WHERE join_url IS DISTINCT FROM public.calendar_join_url(conference_url, location, description);
