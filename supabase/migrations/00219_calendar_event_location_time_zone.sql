-- The timezone an event's place is in ("America/Costa_Rica"), worked out from
-- its geocoded coordinates by the drive-time pass (drive-time.ts). The iPhone
-- calendar uses it to draw the days of a trip in the trip's own time, so a
-- 10:45 AM tour reads 10:45 AM from home as well as once you're there.
--
-- Like the coordinates it comes from, it describes geocoded_location: a
-- location edit leaves it stale until the next pass re-geocodes.
ALTER TABLE calendar_events
  ADD COLUMN location_time_zone text;
