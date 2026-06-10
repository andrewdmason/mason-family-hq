// Geocoding (Nominatim) and drive time (Google Routes API) utilities, ported
// from KidCalendar. Server-only — these call external HTTP APIs.
//
// Nominatim is free and keyless but rate-limited to 1 req/sec — callers own the
// pacing (see drive-time.ts). The Routes API reuses the GOOGLE_PLACES_API_KEY
// from KidCalendar; without it getDriveTime returns null and callers fall back
// to an estimate.

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "FamilyHQ/1.0 (family-calendar-app)";

// Bias radius in degrees (~100 miles ≈ 1.5°)
const BIAS_DEGREES = 1.5;

export interface GeocodingResult {
  lat: number;
  lng: number;
}

export async function geocodeAddress(
  address: string,
  nearLat?: number,
  nearLng?: number,
): Promise<GeocodingResult | null> {
  const url = new URL("/search", NOMINATIM_BASE);
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "us");

  // Bias results toward home, so "Willard Park" resolves to the local one.
  if (nearLat != null && nearLng != null) {
    url.searchParams.set(
      "viewbox",
      `${nearLng - BIAS_DEGREES},${nearLat + BIAS_DEGREES},${nearLng + BIAS_DEGREES},${nearLat - BIAS_DEGREES}`,
    );
    url.searchParams.set("bounded", "0"); // prefer viewbox but allow outside
  }

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 0 },
  });

  if (!res.ok) return null;

  const data = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!data.length) return null;

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
  };
}

export interface DriveTimeResult {
  durationMinutes: number;
  distanceKm: number;
}

export async function getDriveTime(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<DriveTimeResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify({
        origin: {
          location: { latLng: { latitude: fromLat, longitude: fromLng } },
        },
        destination: {
          location: { latLng: { latitude: toLat, longitude: toLng } },
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
      }),
    },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as {
    routes?: Array<{ duration?: string; distanceMeters?: number }>;
  };
  const route = data.routes?.[0];
  if (!route?.duration) return null;

  // duration is a string like "1234s"
  const durationSec = parseInt(route.duration.replace("s", ""), 10);

  return {
    durationMinutes: Math.ceil(durationSec / 60),
    distanceKm: Math.round((route.distanceMeters ?? 0) / 100) / 10,
  };
}
