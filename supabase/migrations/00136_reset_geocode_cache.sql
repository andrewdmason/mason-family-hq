-- Geocoding moved from Nominatim-only to Google Places Text Search (with
-- Nominatim fallback). Nominatim mis-resolved bare venue names — "Chabot"
-- matched a residential street in Lathrop (69 min away) instead of the
-- Oakland school 5 min away — and the coords cache never self-invalidates
-- (coords are reused whenever geocoded_location still matches the location
-- text). Clear the cache for upcoming events so the next sync ticks
-- re-resolve every location through Places; drive blocks then self-correct
-- via the reconcile sweep's hash check. Drive-block mirrors themselves
-- (drive_source_event_id is not null) never carry a geocode, but keep the
-- guard for clarity.
update calendar_events
set location_lat = null,
    location_lng = null,
    geocoded_at = null,
    geocoded_location = null,
    drive_minutes = null,
    drive_calculated_at = null
where drive_source_event_id is null
  and start_time > now()
  and (location_lat is not null or drive_calculated_at is not null);
