import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import {
  addApartmentPhoto,
  listActivePois,
  listActivePoisByCategory,
  insertOrIgnorePoi,
  listCustomPois,
} from "./db";
import type {
  AppConfig,
  CustomPoi,
  PoiRecord,
  StandardPoiCategory,
  TransitStop,
  TravelMetrics,
  UbahnRoute,
} from "./types";

type Coordinates = {
  latitude: number;
  longitude: number;
};

const STANDARD_RADIUS_METERS = 1800;
const TRANSIT_RADIUS_METERS = 3200;
const USER_AGENT = "rokum-apartment-shortlist/1.0";
const OVERPASS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TRANSIT_OVERLAY_CACHE_TTL_MS = 30 * 60 * 1000;
const TRANSIT_OVERLAY_FAILURE_TTL_MS = 10 * 60 * 1000;

type OverpassCacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const overpassCache = new Map<string, OverpassCacheEntry>();
const transitOverlayCache = new Map<
  string,
  {
    expiresAt: number;
    payload: { transitStops: TransitStop[]; ubahnRoutes: UbahnRoute[] };
  }
>();

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

export function nearbyPois(
  pois: PoiRecord[],
  origin: Coordinates,
  radiusMeters: number,
  limit?: number,
) {
  const ranked = pois
    .map((poi) => ({
      poi,
      distance: haversineDistanceMeters(origin, poi),
    }))
    .filter((entry) => entry.distance <= radiusMeters)
    .sort((left, right) => left.distance - right.distance);

  return typeof limit === "number" ? ranked.slice(0, limit).map((entry) => entry.poi) : ranked.map((entry) => entry.poi);
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

async function fetchOverpassJson<T>(config: AppConfig, query: string) {
  const cacheKey = `${config.overpassBaseUrl}\n${query}`;
  const now = Date.now();
  const cached = overpassCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload as T;
  }

  const response = await fetch(config.overpassBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: query,
  });

  if (!response.ok) {
    if (cached) {
      return cached.payload as T;
    }
    throw new Error(`Overpass request failed: ${response.status}`);
  }

  const payload = (await response.json()) as T;
  overpassCache.set(cacheKey, {
    payload,
    expiresAt: now + OVERPASS_CACHE_TTL_MS,
  });
  return payload;
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
  const payload = await fetchOverpassJson<{
    elements: Array<{
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }>;
  }>(config, query);

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
        isActive: true,
        latitude: elementLatitude,
        longitude: elementLongitude,
        source: "overpass",
        externalId: `${element.id}`,
        tags: [],
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
  const localCandidates = nearestPois(listActivePoisByCategory(database, category), origin);
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

  return nearestPois(listActivePoisByCategory(database, category), origin);
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
      categories?: string[] | null;
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
      isActive: true,
      latitude,
      longitude,
      source: "urbansportsclub",
      externalId: venue.slug ?? null,
      tags: venue.categories?.filter(Boolean) ?? [],
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

export function listNearbyMapPois(
  database: Database,
  origin: Coordinates,
  radiusMeters = 3500,
) {
  return nearbyPois(listActivePois(database), origin, radiusMeters);
}

function metersToLatDegrees(meters: number) {
  return meters / 111_320;
}

function metersToLonDegrees(meters: number, latitude: number) {
  return meters / (111_320 * Math.cos((latitude * Math.PI) / 180));
}

function transitModeTags(tags: Record<string, string>) {
  const modes = new Set<string>();
  if (tags.station === "subway" || tags.subway === "yes") modes.add("U-Bahn");
  if (tags.railway === "tram_stop" || tags.tram === "yes") modes.add("Tram");
  if (tags.highway === "bus_stop" || tags.bus === "yes") modes.add("Bus");
  if (tags.public_transport === "platform" && modes.size === 0) modes.add("Platform");
  return Array.from(modes);
}

function normalizeMapColor(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(trimmed)) {
    return `#${trimmed}`;
  }

  if (/^[a-z]+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return null;
}

export async function fetchTransitMapOverlay(
  config: AppConfig,
  origin: Coordinates,
): Promise<{ transitStops: TransitStop[]; ubahnRoutes: UbahnRoute[] }> {
  const cacheKey = `${origin.latitude.toFixed(4)},${origin.longitude.toFixed(4)}`;
  const now = Date.now();
  const cached = transitOverlayCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.payload;
  }

  const latDelta = metersToLatDegrees(TRANSIT_RADIUS_METERS);
  const lonDelta = metersToLonDegrees(TRANSIT_RADIUS_METERS, origin.latitude);
  const south = origin.latitude - latDelta;
  const north = origin.latitude + latDelta;
  const west = origin.longitude - lonDelta;
  const east = origin.longitude + lonDelta;

  try {
    const stopsPayload = await fetchOverpassJson<{
      elements: Array<{
        type: "node" | "way";
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    }>(
      config,
      `
[out:json][timeout:25];
(
  node["public_transport"~"platform|stop_position"](${south},${west},${north},${east});
  node["highway"="bus_stop"](${south},${west},${north},${east});
  node["railway"~"tram_stop|station|halt|subway_entrance"](${south},${west},${north},${east});
  way["public_transport"="platform"](${south},${west},${north},${east});
  way["railway"="station"]["station"="subway"](${south},${west},${north},${east});
);
out center tags;
      `.trim(),
    );

    const routesPayload = await fetchOverpassJson<{
      elements: Array<{
        type: "node" | "way" | "relation";
        id: number;
        lat?: number;
        lon?: number;
        nodes?: number[];
        tags?: Record<string, string>;
        members?: Array<{
          type: "way" | "node" | "relation";
          ref: number;
          role: string;
        }>;
      }>;
    }>(
      config,
      `
[out:json][timeout:25];
relation["route"="subway"](${south},${west},${north},${east});
out body;
>;
out skel qt;
      `.trim(),
    );

    const nodeMap = new Map<number, { latitude: number; longitude: number }>();
    const wayMap = new Map<number, number[]>();
    const transitStops = new Map<string, TransitStop>();
    const ubahnRoutes: UbahnRoute[] = [];

    for (const element of routesPayload.elements) {
      if (element.type === "node" && typeof element.lat === "number" && typeof element.lon === "number") {
        nodeMap.set(element.id, {
          latitude: element.lat,
          longitude: element.lon,
        });
      }
    }

    for (const element of routesPayload.elements) {
      if (element.type === "way" && element.nodes) {
        wayMap.set(element.id, element.nodes);
      }
    }

    for (const element of stopsPayload.elements) {
      const latitude = element.lat ?? element.center?.lat;
      const longitude = element.lon ?? element.center?.lon;
      if ((element.type === "node" || element.type === "way") && element.tags && typeof latitude === "number" && typeof longitude === "number") {
        const modes = transitModeTags(element.tags);
        if (modes.length === 0) {
          continue;
        }

        const key = `${element.id}`;
        transitStops.set(key, {
          id: key,
          name: element.tags.name || element.tags["ref_name"] || "Transit stop",
          latitude,
          longitude,
          modes,
        });
      }
    }

    for (const element of routesPayload.elements) {
      if (element.type !== "relation" || element.tags?.route !== "subway") {
        continue;
      }

      const paths: Array<Array<{ latitude: number; longitude: number }>> = [];
      for (const member of element.members ?? []) {
        if (member.type !== "way") {
          continue;
        }
        const nodeIds = wayMap.get(member.ref);
        if (!nodeIds) {
          continue;
        }
        const path = nodeIds
          .map((nodeId) => nodeMap.get(nodeId))
          .filter(Boolean)
          .map((node) => ({
            latitude: node!.latitude,
            longitude: node!.longitude,
          }));

        if (path.length >= 2) {
          paths.push(path);
        }
      }

      if (paths.length === 0) {
        continue;
      }

      ubahnRoutes.push({
        id: `${element.id}`,
        name: element.tags.name || element.tags.ref || "U-Bahn route",
        ref: element.tags.ref || "",
        color: normalizeMapColor(element.tags.colour || element.tags.color || null),
        paths,
      });
    }

    const payload = {
      transitStops: Array.from(transitStops.values()),
      ubahnRoutes,
    };
    transitOverlayCache.set(cacheKey, {
      payload,
      expiresAt: now + TRANSIT_OVERLAY_CACHE_TTL_MS,
    });
    return payload;
  } catch (error) {
    console.warn("Transit overlay fetch failed, continuing without routes", error);
    if (cached) {
      return cached.payload;
    }
    const payload = {
      transitStops: [],
      ubahnRoutes: [],
    };
    transitOverlayCache.set(cacheKey, {
      payload,
      expiresAt: now + TRANSIT_OVERLAY_FAILURE_TTL_MS,
    });
    return payload;
  }
}
