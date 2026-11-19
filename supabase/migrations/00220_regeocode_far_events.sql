-- Upcoming events geocoded far from home get geocoded again. The geocoder took
-- the nearest match to home even when the nearest was nowhere near: "The
-- Springs Resort & Spa, Arenal" (Costa Rica) was placed at a resort in Pagosa
-- Springs, Colorado, so its days read in Mountain time. geocoding.ts now only
-- trusts the nearest match within 150 km; this clears what the old rule cached
-- (coords are otherwise kept for as long as the location text is unchanged).
-- Nearby events are untouched. The next sync passes refill these.
UPDATE calendar_events e
SET location_lat = NULL,
    location_lng = NULL,
    geocoded_at = NULL,
    geocoded_location = NULL,
    location_time_zone = NULL,
    drive_minutes = NULL,
    drive_calculated_at = NULL
FROM calendar_logistics_settings s
WHERE s.id = 1
  AND s.home_lat IS NOT NULL
  AND s.home_lng IS NOT NULL
  AND e.start_time > now()
  AND e.location_lat IS NOT NULL
  AND (abs(e.location_lat - s.home_lat) > 1.5 OR abs(e.location_lng - s.home_lng) > 1.5);
