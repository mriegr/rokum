import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import {
  addApartmentPhoto,
  insertOrIgnorePoi,
  listCustomPois,
  listPoisByCategory,
} from "./db";
import type {
  AppConfig,
  CustomPoi,
  PoiRecord,
  StandardPoiCategory,
  TravelMetrics,
} from "./types";

type Coordinates = {
  latitude: number;
  longitude: number;
};

const STANDARD_RADIUS_METERS = 1800;
const USER_AGENT = "rokum-apartment-shortlist/1.0";

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function haversineDistanceMeters(a: Coordinates, b: Coordinates) {
  const earthRadius = 6371000;
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const arc =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Remote request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function geocodeAddress(config: AppConfig, address: string) {
  const url = new URL(`${config.nominatimBaseUrl}/search`);
  url.searchParams.set("q", `${address}, ${config.city}`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const results = await fetchJson<
    Array<{ lat: string; lon: string }>
  >(url.toString());

  const first = results[0];
  if (!first) {
    throw new Error(`Could not geocode address: ${address}`);
  }

  return {
    latitude: Number(first.lat),
    longitude: Number(first.lon),
  };
}

function overpassQuery(category: StandardPoiCategory, latitude: number, longitude: number) {
  switch (category) {
    case "supermarket":
      return `[out:json][timeout:25];(node["shop"="supermarket"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});way["shop"="supermarket"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude}););out center tags;`;
    case "sport_studio":
      return "";
    case "ubahn":
      return `[out:json][timeout:25];(node["railway"="station"]["station"="subway"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});node["public_transport"="station"]["subway"="yes"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});way["railway"="station"]["station"="subway"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude}););out center tags;`;
    case "cafe":
      return `[out:json][timeout:25];(node["amenity"="cafe"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});way["amenity"="cafe"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude}););out center tags;`;
    case "park_or_river":
      return `[out:json][timeout:25];(node["leisure"="park"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});way["leisure"="park"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});way["natural"="water"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});way["waterway"="riverbank"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude}););out center tags;`;
  }
}

async function fetchOverpassPois(
  config: AppConfig,
  category: StandardPoiCategory,
  latitude: number,
  longitude: number,
) {
  if (category === "sport_studio") {
    return [] as Omit<PoiRecord, "id">[];
  }

  const query = overpassQuery(category, latitude, longitude);
  const response = await fetch(config.overpassBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": USER_AGENT,
    },
    body: query,
  });

  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status}`);
  }

  const payload = (await response.json()) as {
    elements: Array<{
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  };

  return payload.elements
    .map((element) => {
      const elementLatitude = element.lat ?? element.center?.lat;
      const elementLongitude = element.lon ?? element.center?.lon;

      if (!elementLatitude || !elementLongitude) {
        return null;
      }

      const tags = element.tags ?? {};
      const name =
        tags.name ||
        (category === "park_or_river" ? "Park or river access" : "Unnamed POI");

      const address = [
        tags["addr:street"],
        tags["addr:housenumber"],
        tags["addr:postcode"],
      ]
        .filter(Boolean)
        .join(" ")
        .trim();

      return {
        category,
        name,
        address,
        latitude: elementLatitude,
        longitude: elementLongitude,
        source: "overpass",
        externalId: `${element.id}`,
      } satisfies Omit<PoiRecord, "id">;
    })
    .filter(Boolean) as Omit<PoiRecord, "id">[];
}

function nearestPois(candidates: PoiRecord[], origin: Coordinates) {
  return candidates
    .map((candidate) => ({
      candidate,
      distance: haversineDistanceMeters(origin, candidate),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5)
    .map((entry) => entry.candidate);
}

export async function ensurePoisForCategory(
  database: Database,
  config: AppConfig,
  category: StandardPoiCategory,
  origin: Coordinates,
) {
  const localCandidates = nearestPois(listPoisByCategory(database, category), origin);
  if (localCandidates.length >= 3) {
    return localCandidates;
  }

  try {
    const remoteCandidates = await fetchOverpassPois(
      config,
      category,
      origin.latitude,
      origin.longitude,
    );

    for (const candidate of remoteCandidates) {
      insertOrIgnorePoi(database, candidate);
    }
  } catch (error) {
    console.warn(`POI fetch failed for ${category}, continuing with local cache`, error);
  }

  return nearestPois(listPoisByCategory(database, category), origin);
}

export async function routeWalking(
  config: AppConfig,
  from: Coordinates,
  to: Coordinates,
): Promise<TravelMetrics> {
  try {
    const url = new URL(
      `${config.walkingBaseUrl}/route/v1/walking/${from.longitude},${from.latitude};${to.longitude},${to.latitude}`,
    );
    url.searchParams.set("overview", "false");

    const payload = await fetchJson<{
      routes?: Array<{ distance: number; duration: number }>;
    }>(url.toString());

    const route = payload.routes?.[0];
    if (!route) {
      return { distanceMeters: null, durationMinutes: null, source: "osrm-missing" };
    }

    return {
      distanceMeters: Math.round(route.distance),
      durationMinutes: Math.round((route.duration / 60) * 10) / 10,
      source: "osrm",
    };
  } catch (error) {
    console.warn("Walking route lookup failed, using haversine fallback", error);
    const distanceMeters = Math.round(haversineDistanceMeters(from, to) * 1.22);
    return {
      distanceMeters,
      durationMinutes: Math.round((distanceMeters / 80) * 10) / 10,
      source: "haversine",
    };
  }
}

function heuristicTransitEstimate(
  from: Coordinates,
  to: Coordinates,
  ubahnCandidates: PoiRecord[],
): TravelMetrics {
  const directDistance = haversineDistanceMeters(from, to);
  const directMinutes = directDistance / 80;
  const nearestStationDistance = ubahnCandidates[0]
    ? haversineDistanceMeters(from, ubahnCandidates[0])
    : directDistance * 0.4;
  const egressWalkDistance = Math.min(directDistance * 0.2, 900);
  const railDistance = Math.max(directDistance - nearestStationDistance - egressWalkDistance, 0);
  const railMinutes = railDistance / 500;
  const waitMinutes = 6;
  const estimated = Math.min(directMinutes, waitMinutes + nearestStationDistance / 70 + railMinutes + egressWalkDistance / 75);

  return {
    distanceMeters: Math.round(directDistance),
    durationMinutes: Math.round(estimated * 10) / 10,
    source: "heuristic",
  };
}

export async function routeTransit(
  config: AppConfig,
  from: Coordinates,
  to: Coordinates,
  ubahnCandidates: PoiRecord[],
): Promise<TravelMetrics> {
  if (config.transitMode === "otp1" && config.transitBaseUrl) {
    const url = new URL(`${config.transitBaseUrl.replace(/\/$/, "")}/plan`);
    url.searchParams.set("fromPlace", `${from.latitude},${from.longitude}`);
    url.searchParams.set("toPlace", `${to.latitude},${to.longitude}`);
    url.searchParams.set("mode", "TRANSIT,WALK");
    url.searchParams.set("numItineraries", "1");

    try {
      const payload = await fetchJson<{
        plan?: {
          itineraries?: Array<{ duration: number; walkDistance?: number }>;
        };
      }>(url.toString());

      const itinerary = payload.plan?.itineraries?.[0];
      if (itinerary) {
        return {
          distanceMeters: itinerary.walkDistance
            ? Math.round(itinerary.walkDistance)
            : Math.round(haversineDistanceMeters(from, to)),
          durationMinutes: Math.round((itinerary.duration / 60) * 10) / 10,
          source: "otp1",
        };
      }
    } catch (error) {
      console.warn("OTP transit request failed, using heuristic fallback", error);
    }
  }

  return heuristicTransitEstimate(from, to, ubahnCandidates);
}

export async function seedSportStudios(database: Database) {
  const seedFile = Bun.file("./urbansportsclub-venues-with-addresses.json");
  if (!(await seedFile.exists())) {
    return;
  }

  const payload = (await seedFile.json()) as {
    venues?: Array<{
      name?: string | null;
      address?: {
        streetAddress?: string | null;
        postalCode?: string | null;
        addressLocality?: string | null;
      } | null;
      geo?: {
        latitude?: string | number | null;
        longitude?: string | number | null;
      } | null;
      slug?: string | null;
    }>;
  };

  for (const venue of payload.venues ?? []) {
    const latitude = Number(venue.geo?.latitude);
    const longitude = Number(venue.geo?.longitude);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !venue.name) {
      continue;
    }

    const address = [
      venue.address?.streetAddress,
      venue.address?.postalCode,
      venue.address?.addressLocality,
    ]
      .filter(Boolean)
      .join(", ");

    insertOrIgnorePoi(database, {
      category: "sport_studio",
      name: venue.name,
      address,
      latitude,
      longitude,
      source: "urbansportsclub",
      externalId: venue.slug ?? null,
    });
  }
}

function sanitizeFileName(value: string) {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "-");
}

export async function storeUploadedPhotos(
  database: Database,
  config: AppConfig,
  apartmentId: number,
  formData: { getAll(name: string): unknown[] },
) {
  const storedKeys: string[] = [];
  for (const value of formData.getAll("photos")) {
    if (!(value instanceof File) || value.size === 0) {
      continue;
    }

    const buffer = await value.arrayBuffer();
    const safeName = sanitizeFileName(value.name || "photo.jpg");
    const hash = createHash("sha1")
      .update(`${apartmentId}:${safeName}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12);
    const storageKey = `${apartmentId}-${hash}-${safeName}`;
    const targetPath = join(config.uploadDirectory, storageKey);
    await Bun.write(targetPath, buffer);
    addApartmentPhoto(database, apartmentId, storageKey, safeName, value.type || "image/jpeg");
    storedKeys.push(storageKey);
  }

  return storedKeys;
}

export function categoryLabel(category: StandardPoiCategory) {
  switch (category) {
    case "supermarket":
      return "Supermarket";
    case "sport_studio":
      return "Sport studio";
    case "ubahn":
      return "U-Bahn";
    case "cafe":
      return "Cafes";
    case "park_or_river":
      return "Park or river";
  }
}

export function getActiveCustomPois(database: Database) {
  return listCustomPois(database).filter((poi) => poi.isActive);
}
