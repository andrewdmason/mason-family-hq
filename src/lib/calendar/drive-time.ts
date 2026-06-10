// Background drive-time cache refresh, ported from KidCalendar. Geocodes event
// locations (Nominatim, paced at 1 req/sec) and computes home→event drive times
// (Google Routes API), caching both on the calendar_events row. Runs inside the
// cron sync tick, after the source syncs land new times/locations and before
// the drive blocks reconcile (drive-events.ts), so a moved/relocated event gets
// a corrected block in the same tick.

import { createAdminClient } from "@/lib/supabase/admin";
import { geocodeAddress, getDriveTime } from "./geocoding";
import { isHomeLocation } from "./calendar-utils";

type AdminClient = ReturnType<typeof createAdminClient>;

const STALE_HOURS = 24;
// Nominatim allows 1 req/sec; the cron route's budget is 60s, so cap geocodes
// per run — a backlog drains over a few ticks (steady state is 0–2 new
// locations per tick).
const NOMINATIM_DELAY_MS = 1100;
const MAX_GEOCODES_PER_RUN = 20;
const SKIP_LOCATIONS = new Set(["tbd", "tba", "n/a", "unknown", "home"]);
// A bare venue name ("Albany High") can geocode to a same-named place across
// the country — the viewbox bias prefers local but doesn't enforce it. Any
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
  const staleThreshold = new Date(
    Date.now() - STALE_HOURS * 3600_000,
  ).toISOString();

  const { data: events } = await supabase
    .from("calendar_events")
    .select(
      "id, location, location_lat, location_lng, geocoded_location, drive_minutes, drive_calculated_at",
    )
    .gt("start_time", now)
    .eq("is_canceled", false)
    .eq("all_day", false)
    .not("location", "is", null)
    .is("drive_source_event_id", null) // never compute drive time for drive blocks
    .or(
      `drive_calculated_at.is.null,drive_calculated_at.lt.${staleThreshold},drive_minutes.is.null`,
    );

  if (!events?.length) return { calculated: 0 };

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
      SKIP_LOCATIONS.has(locKey) ||
      isHomeLocation(location, settings.homeAddress)
    ) {
      await supabase
        .from("calendar_events")
        .update({ drive_calculated_at: new Date().toISOString() })
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
        geo = await geocodeAddress(location, homeLat, homeLng);
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
        // Geocoding failed — stamp as attempted so we retry on staleness only.
        await supabase
          .from("calendar_events")
          .update({ drive_calculated_at: new Date().toISOString() })
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
      })
      .eq("id", event.id);
    if (driveMinutes != null) calculated += 1;
  }

  return { calculated };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
