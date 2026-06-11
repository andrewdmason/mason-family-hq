// Geocoding (Google Places Text Search, with Nominatim fallback) and drive
// time (Google Routes API) utilities. Server-only — these call external HTTP
// APIs.
//
// Places is the primary geocoder because event locations are often bare venue
// names ("Chabot"), which Nominatim matches against any same-named feature in
// the country (a residential street in Lathrop, 69 min away) while Places
// resolves to the nearest venue with that name. Nominatim is the
// keyless fallback; it's rate-limited to 1 req/sec — callers own the pacing
// (see drive-time.ts). The Routes API reuses the same GOOGLE_PLACES_API_KEY
// from KidCalendar; without it getDriveTime returns null and callers fall back
// to an estimate.

const PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_AUTOCOMPLETE_URL =
  "https://places.googleapis.com/v1/places:autocomplete";
// Places locationBias circle radius in meters (50 km is the API max). A bias,
// not a restriction — far-away tournaments still resolve.
const PLACES_BIAS_RADIUS_M = 50_000;

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "FamilyHQ/1.0 (family-calendar-app)";

// Nominatim bias radius in degrees (~100 miles ≈ 1.5°)
const BIAS_DEGREES = 1.5;

export interface GeocodingResult {
  lat: number;
  lng: number;
}

export interface PlaceSuggestion {
  placeId: string;
  label: string;
  secondary: string | null;
  location: string;
}

export async function suggestPlaces(
  input: string,
  nearLat?: number,
  nearLng?: number,
): Promise<PlaceSuggestion[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const query = input.trim();
  if (!apiKey || query.length < 2) return [];

  const res = await fetch(PLACES_AUTOCOMPLETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat",
    },
    body: JSON.stringify({
      input: query,
      includedRegionCodes: ["us"],
      ...(nearLat != null && nearLng != null
        ? {
            locationBias: {
              circle: {
                center: { latitude: nearLat, longitude: nearLng },
                radius: PLACES_BIAS_RADIUS_M,
              },
            },
          }
        : {}),
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    console.warn(
      `[places] Autocomplete failed (${res.status}) for "${query}": ${(await res.text()).slice(0, 200)}`,
    );
    return [];
  }

  const data = (await res.json()) as {
    suggestions?: Array<{
      placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
          mainText?: { text?: string };
          secondaryText?: { text?: string };
        };
      };
    }>;
  };

  return (data.suggestions ?? [])
    .map((s): PlaceSuggestion | null => {
      const p = s.placePrediction;
      const location = p?.text?.text?.trim();
      const label = p?.structuredFormat?.mainText?.text?.trim() ?? location;
      if (!p?.placeId || !location || !label) return null;
      return {
        placeId: p.placeId,
        label,
        secondary: p.structuredFormat?.secondaryText?.text?.trim() ?? null,
        location,
      };
    })
    .filter((s): s is PlaceSuggestion => s != null)
    .slice(0, 5);
}

export async function geocodeAddress(
  address: string,
  nearLat?: number,
  nearLng?: number,
): Promise<GeocodingResult | null> {
  // Nearest match first: for a bare venue name ("Chabot") the closest place
  // with that name is the family's venue (Chabot Elementary, 5 min) where
  // prominence ranking picks the famous one (Chabot College, Hayward). Pure
  // street addresses return empty under DISTANCE rank, so fall through to
  // relevance rank, then to keyless Nominatim.
  if (nearLat != null && nearLng != null) {
    const nearest = await geocodeWithPlaces(address, nearLat, nearLng, "DISTANCE");
    if (nearest) return nearest;
  }
  const places = await geocodeWithPlaces(address, nearLat, nearLng);
  if (places) return places;
  return geocodeWithNominatim(address, nearLat, nearLng);
}

async function geocodeWithPlaces(
  address: string,
  nearLat?: number,
  nearLng?: number,
  rankPreference?: "DISTANCE",
): Promise<GeocodingResult | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(PLACES_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.location",
    },
    body: JSON.stringify({
      textQuery: address,
      ...(rankPreference ? { rankPreference } : {}),
      ...(nearLat != null && nearLng != null
        ? {
            locationBias: {
              circle: {
                center: { latitude: nearLat, longitude: nearLng },
                radius: PLACES_BIAS_RADIUS_M,
              },
            },
          }
        : {}),
    }),
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    // Loud, not silent: a key that's missing "Places API (New)" would
    // otherwise quietly degrade every geocode to the Nominatim fallback.
    console.warn(
      `[geocode] Places text search failed (${res.status}) for "${address}": ${(await res.text()).slice(0, 200)}`,
    );
    return null;
  }

  const data = (await res.json()) as {
    places?: Array<{ location?: { latitude?: number; longitude?: number } }>;
  };
  const loc = data.places?.[0]?.location;
  if (loc?.latitude == null || loc?.longitude == null) return null;

  return { lat: loc.latitude, lng: loc.longitude };
}

async function geocodeWithNominatim(
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
