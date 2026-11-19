// Background drive-time cache refresh, ported from KidCalendar. Geocodes event
// locations (Google Places, falling back to Nominatim — pacing below covers
// the fallback's 1 req/sec limit) and computes home→event drive times
// (Google Routes API), caching both on the calendar_events row. Runs inside the
// cron sync tick, after the source syncs land new times/locations and before
// the drive blocks reconcile (drive-events.ts), so a moved/relocated event gets
// a corrected block in the same tick.

import tzLookup from "@photostructure/tz-lookup";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodeAddress, getDriveTime } from "./geocoding";
import { isHomeLocation } from "./calendar-utils";
import { isPlace, placeText } from "./place";

type AdminClient = ReturnType<typeof createAdminClient>;

// Times in drive-block titles/descriptions are formatted in the family's home
// timezone (every stop is local). Server-only — the client gets this via
// LogisticsHints so ghost-block titles match the written ones byte-for-byte.
export const FAMILY_TZ = process.env.FAMILY_TIMEZONE || "America/Los_Angeles";

const STALE_HOURS = 24;
// Nominatim allows 1 req/sec; the cron route's budget is 60s, so cap geocodes
// per run — a backlog drains over a few ticks (steady state is 0–2 new
// locations per tick).
const NOMINATIM_DELAY_MS = 1100;
const MAX_GEOCODES_PER_RUN = 20;
// A bare venue name ("Albany High") can geocode to a same-named place across
// the country — the home bias prefers local but doesn't enforce it. Any
// drive past this is almost certainly a mis-geocode for this family's events,
// so treat it as unknown (the block falls back to the marked estimate).
const MAX_DRIVE_MINUTES = 240;

export interface LogisticsSettings {
  homeAddress: string;
  homeLat: number | null;
  homeLng: number | null;
  bufferMinutes: number;
}

/** Read the single settings row, geocoding home lat/lng if missing or the
 * address was edited since the last geocode (home_geocoded_at < updated_at). */
export async function getLogisticsSettings(
  supabase: AdminClient,
): Promise<LogisticsSettings | null> {
  const { data: row } = await supabase
    .from("calendar_logistics_settings")
    .select(
      "home_address, home_lat, home_lng, home_geocoded_at, updated_at, drive_buffer_minutes",
    )
    .eq("id", 1)
    .maybeSingle();
  if (!row) return null;

  let homeLat = row.home_lat as number | null;
  let homeLng = row.home_lng as number | null;

  const stale =
    homeLat == null ||
    homeLng == null ||
    (row.home_geocoded_at &&
      row.updated_at &&
      new Date(row.home_geocoded_at) < new Date(row.updated_at));

  if (stale) {
    const geo = await geocodeAddress(row.home_address as string);
    if (geo) {
      homeLat = geo.lat;
      homeLng = geo.lng;
      await supabase
        .from("calendar_logistics_settings")
        .update({
          home_lat: geo.lat,
          home_lng: geo.lng,
          home_geocoded_at: new Date().toISOString(),
        })
        .eq("id", 1);
    }
  }

  return {
    homeAddress: row.home_address as string,
    homeLat,
    homeLng,
    bufferMinutes: (row.drive_buffer_minutes as number) ?? 5,
  };
}

/** Whether an event's cached drive time needs working out again: never tried,
 * tried over a day ago, or tried for a different location than it has now.
 * A try that failed (no coordinates, no route) counts as a try: it waits out
 * the day like any other, instead of spending two Places searches every tick.
 * `geocoded_location` is the location text last tried, found or not. */
export function driveIsDue(
  event: {
    location: string | null;
    geocoded_location: string | null;
    drive_calculated_at: string | null;
  },
  staleBefore: Date,
): boolean {
  if (!event.location) return false;
  if (event.drive_calculated_at == null) return true;
  if (new Date(event.drive_calculated_at) < staleBefore) return true;
  return (
    event.geocoded_location != null &&
    event.geocoded_location !== event.location.trim()
  );
}

/** Refresh the drive cache for upcoming located events: geocode locations and
 * compute home→event drive minutes, with per-run dedup caches and staleness
 * stamps (failures stamp drive_calculated_at too, so they retry after 24h, not
 * every tick). */
export async function refreshDriveTimes(
  supabase: AdminClient,
): Promise<{ calculated: number }> {
  const settings = await getLogisticsSettings(supabase);
  if (!settings || settings.homeLat == null || settings.homeLng == null) {
    return { calculated: 0 };
  }
  const { homeLat, homeLng } = settings;

  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_HOURS * 3600_000);

  // Every upcoming located event, then the due ones picked out here: "the
  // location isn't the one that was geocoded" compares two columns, which the
  // query can't. Without it a location edit kept its old drive time for a day.
  const { data: upcoming } = await supabase
    .from("calendar_events")
    .select(
      "id, location, location_lat, location_lng, geocoded_location, location_time_zone, drive_minutes, drive_calculated_at",
    )
    .gt("start_time", now)
    .eq("is_canceled", false)
    .eq("all_day", false)
    .not("location", "is", null)
    .is("drive_source_event_id", null); // never compute drive time for drive blocks

  const events = (upcoming ?? []).filter((event) =>
    driveIsDue(
      {
        location: event.location as string | null,
        geocoded_location: event.geocoded_location as string | null,
        drive_calculated_at: event.drive_calculated_at as string | null,
      },
      staleBefore,
    ),
  );
  if (!events.length) return { calculated: 0 };

  // Per-run dedup: many events share a location (weekly practice), so geocode
  // and route each distinct place once.
  const geoCache = new Map<string, { lat: number; lng: number } | null>();
  const driveCache = new Map<string, number | null>();

  let calculated = 0;
  let geocodes = 0;

  for (const event of events) {
    const location = (event.location as string).trim();
    const locKey = location.toLowerCase();
    // A location edit invalidates the cached coords (geocoded_location is the
    // text the coords were derived from).
    const coordsValid =
      event.location_lat != null &&
      event.location_lng != null &&
      event.geocoded_location === location;

    if (
      // A call's link, "Zoom", "TBD": not a place (place.ts).
      !isPlace(location) ||
      isHomeLocation(location, settings.homeAddress)
    ) {
      // Nowhere to drive to. An earlier location's drive time goes with it.
      await supabase
        .from("calendar_events")
        .update({
          location_lat: null,
          location_lng: null,
          geocoded_location: location,
          location_time_zone: null,
          drive_minutes: null,
          drive_calculated_at: new Date().toISOString(),
        })
        .eq("id", event.id);
      continue;
    }

    let eventLat = coordsValid ? (event.location_lat as number) : null;
    let eventLng = coordsValid ? (event.location_lng as number) : null;

    if (eventLat == null || eventLng == null) {
      let geo = geoCache.get(locKey);
      if (geo === undefined) {
        if (geocodes >= MAX_GEOCODES_PER_RUN) continue; // next tick
        await delay(NOMINATIM_DELAY_MS);
        // The place alone: a link written after it ("Room 4, Crowden School
        // https://zoom.us/…") isn't part of the address.
        geo = await geocodeAddress(
          placeText(location) ?? location,
          homeLat,
          homeLng,
        );
        geoCache.set(locKey, geo);
        geocodes += 1;
      }
      if (geo) {
        eventLat = geo.lat;
        eventLng = geo.lng;
        await supabase
          .from("calendar_events")
          .update({
            location_lat: geo.lat,
            location_lng: geo.lng,
            geocoded_at: new Date().toISOString(),
            geocoded_location: location,
          })
          .eq("id", event.id);
      } else {
        // Geocoding failed — stamp as attempted, for this location, so we
        // retry on staleness only. What the last location had is dropped.
        await supabase
          .from("calendar_events")
          .update({
            location_lat: null,
            location_lng: null,
            geocoded_location: location,
            location_time_zone: null,
            drive_minutes: null,
            drive_calculated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
        continue;
      }
    }

    const driveKey = `${eventLat.toFixed(4)},${eventLng.toFixed(4)}`;
    let driveMinutes = driveCache.get(driveKey);
    if (driveMinutes === undefined) {
      const result = await getDriveTime(homeLat, homeLng, eventLat, eventLng);
      driveMinutes = result?.durationMinutes ?? null;
      if (driveMinutes != null && driveMinutes > MAX_DRIVE_MINUTES) {
        driveMinutes = null;
      }
      driveCache.set(driveKey, driveMinutes);
    }

    await supabase
      .from("calendar_events")
      .update({
        drive_minutes: driveMinutes,
        drive_calculated_at: new Date().toISOString(),
        // Written here, not with the geocode, so events geocoded before the
        // column existed pick it up on their next pass.
        location_time_zone:
          zoneAt(eventLat, eventLng) ??
          (event.location_time_zone as string | null),
      })
      .eq("id", event.id);
    if (driveMinutes != null) calculated += 1;
  }

  return { calculated };
}

/** The IANA timezone at a point ("America/Costa_Rica"), from an offline
 * lookup — no API call. Null for coordinates it can't place. */
function zoneAt(lat: number, lng: number): string | null {
  try {
    return tzLookup(lat, lng);
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
