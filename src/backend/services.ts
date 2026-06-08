import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  addApartmentPhoto,
  listActivePois,
  listActivePoisByCategory,
  insertOrIgnorePoi,
  listCustomPois,
  upsertPoiIcon,
} from "./db";
import type {
  AppConfig,
  CustomPoi,
  PoiRecord,
  StandardPoiCategory,
  TransitStop,
  TravelMetrics,
  UbahnRoute,
} from "../shared/types";
import { MUNICH_GREATER_AREA_BOUNDS } from "../shared/munich";
import {
  getMunichUbahnStations,
  getMunichUbahnRoutes,
  hasTransitOverlayCache,
  saveMunichUbahnRoutes,
} from "./transitOverlayCache";
import { simplifyRoutePaths } from "./routeSimplifier";

type Coordinates = {
  latitude: number;
  longitude: number;
};

const STANDARD_RADIUS_METERS = 1800;
const USER_AGENT = "rokum-apartment-shortlist/1.0";
const OVERPASS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type OverpassCacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const overpassCache = new Map<string, OverpassCacheEntry>();

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

function overpassQuery(category: string, latitude: number, longitude: number) {
  switch (category) {
    case "supermarket":
      return `[out:json][timeout:25];(node["shop"="supermarket"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude});way["shop"="supermarket"](around:${STANDARD_RADIUS_METERS},${latitude},${longitude}););out center tags;`;
    case "sport_studio":
      return "";
    default:
      return "";
  }
}

async function fetchOverpassPois(
  config: AppConfig,
  category: string,
  latitude: number,
  longitude: number,
) {
  if (category === "sport_studio" || category === "ubahn") {
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
      const name = tags.name || "Unnamed POI";

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
        subcategory: "",
        name,
        address,
        isActive: true,
        latitude: elementLatitude,
        longitude: elementLongitude,
        source: ["overpass"],
        externalId: `${element.id}`,
        tags: [],
        note: "",
      } as Omit<PoiRecord, "id">;
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
  category: string,
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
      subcategory: "",
      name: venue.name,
      address,
      isActive: true,
      latitude,
      longitude,
      source: ["urbansportsclub"],
      externalId: venue.slug ?? null,
      tags: venue.categories?.filter(Boolean) ?? [],
      note: "",
    });
  }
}

export function seedSportStudioIcons(database: Database, iconDir: string) {
  const seedPath = existsSync("./urbansportsclub-venues-with-addresses.json")
    ? "./urbansportsclub-venues-with-addresses.json"
    : existsSync("./urbansportsclub-venues-with-addresses co.json")
      ? "./urbansportsclub-venues-with-addresses co.json"
      : null;
  if (!seedPath) {
    return;
  }
  const text = readFileSync(seedPath, "utf-8");
  const data = JSON.parse(text) as {
    venues?: Array<{ categories?: string[] | null }>;
  };
  const tags = new Set<string>();
  for (const venue of data.venues ?? []) {
    for (const category of venue.categories ?? []) {
      if (category) tags.add(category);
    }
  }
  const uniqueTags = [...tags].sort();
  mkdirSync(iconDir, { recursive: true });

  for (const tag of uniqueTags) {
    const svg = makeSportSvg(tag);
    const safeName = tag.replace(/[^a-zA-Z0-9._-]/g, "-");
    const filename = `${safeName}.svg`;
    const filePath = join(iconDir, filename);
    if (!existsSync(filePath)) {
      Bun.write(filePath, svg);
    }
    upsertPoiIcon(database, "sport_studio", tag, `/uploads/icons/${filename}`);
  }
}

function makeSportSvg(tag: string): string {
  const iconContent = SUBICON_MAP[tag] ?? defaultSvgSymbol(tag);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5" fill="#2ecc71"/>
  <g transform="translate(2,2)">${iconContent}</g>
</svg>`;
}

function defaultSvgSymbol(tag: string): string {
  const abbr = tag
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return `<text x="10" y="15" text-anchor="middle" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="12" font-weight="bold">${abbr}</text>`;
}

const SUBICON_MAP: Record<string, string> = {
  Running: `<path d="M10,4a2,2,0,1,0,0-4a2,2,0,0,0,0,4zm0,2v6l-4,5m4-5l4,5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M7,8l3,2m3-2l-3,2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,

  Yoga: `<circle cx="10" cy="4" r="2.5" fill="#fff"/>` +
    `<path d="M10,6.5v5l-4,5m4-5l4,5M7,11l-3,2m6-2l3,2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M10,9.5l-4,2m4-2l4,2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  Cycling: `<circle cx="10" cy="10" r="7" stroke="#fff" stroke-width="1.8" fill="none"/>` +
    `<circle cx="10" cy="10" r="2" fill="#fff"/>` +
    `<line x1="10" y1="3" x2="10" y2="17" stroke="#fff" stroke-width="1.5"/>` +
    `<line x1="3" y1="10" x2="17" y2="10" stroke="#fff" stroke-width="1.5"/>`,

  Swimming: `<path d="M3,14q3.5-6,7,0q3.5-6,7,0" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<circle cx="10" cy="5" r="2.5" fill="#fff"/>` +
    `<path d="M10,7.5l-3,3m3-3l4,2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,

  Tennis: `<circle cx="10" cy="10" r="5" stroke="#fff" stroke-width="1.5" fill="none"/>` +
    `<path d="M13,7l4-4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="9" cy="6" r="1.5" fill="#fff"/>`,

  "Table Tennis": `<circle cx="10" cy="6" r="2" fill="#fff"/>` +
    `<ellipse cx="10" cy="13" rx="5" ry="4" stroke="#fff" stroke-width="1.5" fill="none"/>` +
    `<line x1="13" y1="10" x2="17" y2="12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,

  Football: `<circle cx="10" cy="10" r="7" fill="none" stroke="#fff" stroke-width="1.8"/>` +
    `<polygon points="10,4 13,8 12,13 8,13 7,8" fill="none" stroke="#fff" stroke-width="1.2"/>`,

  Dance: `<circle cx="10" cy="3" r="2.5" fill="#fff"/>` +
    `<path d="M10,5.5v5l-4,5m4-6l-3-2m3,2l4,3" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M6,9l-2,4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  Fitness: `<rect x="4" y="8" width="12" height="4" rx="1.5" fill="#fff"/>` +
    `<circle cx="4" cy="10" r="3" fill="#fff"/><circle cx="16" cy="10" r="3" fill="#fff"/>` +
    `<rect x="4" y="8" width="12" height="4" rx="1.5" stroke="#2ecc71" stroke-width="1" fill="none"/>`,

  Climbing: `<circle cx="10" cy="4" r="2" fill="#fff"/>` +
    `<path d="M10,6v3" stroke="#fff" stroke-width="1.8" fill="none"/>` +
    `<circle cx="7" cy="13" r="1.5" fill="#fff"/><circle cx="13" cy="13" r="1.5" fill="#fff"/>` +
    `<circle cx="10" cy="16" r="2" fill="#fff"/>`,

  Bouldering: `<circle cx="10" cy="3" r="2" fill="#fff"/>` +
    `<path d="M10,5v4" stroke="#fff" stroke-width="1.8" fill="none"/>` +
    `<circle cx="5" cy="11" r="1.5" fill="#fff"/><circle cx="15" cy="11" r="1.5" fill="#fff"/>` +
    `<circle cx="10" cy="17" r="2" fill="#fff"/>`,

  "Boxing Sports": `<circle cx="7" cy="8" r="4" fill="#fff"/><circle cx="13" cy="8" r="4" fill="#fff"/>` +
    `<circle cx="7" cy="8" r="2" fill="#2ecc71"/><circle cx="13" cy="8" r="2" fill="#2ecc71"/>`,

  "Mixed Martial Arts": `<rect x="3" y="3" width="14" height="14" rx="2" stroke="#fff" stroke-width="1.8" fill="none"/>` +
    `<circle cx="8" cy="8" r="3" fill="#fff"/><circle cx="12" cy="8" r="3" fill="#fff"/>` +
    `<circle cx="8" cy="8" r="1.5" fill="#2ecc71"/><circle cx="12" cy="8" r="1.5" fill="#2ecc71"/>`,

  "Free Fight": `<circle cx="10" cy="8" r="5" fill="#fff"/>` +
    `<circle cx="10" cy="8" r="2.5" fill="#2ecc71"/>` +
    `<path d="M5,14q5,4,10,0" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,

  "Modern Self Defense": `<path d="M5,3v8q0,4,5,6q5-2,5-6V3Z" fill="#fff"/>` +
    `<line x1="8" y1="8" x2="12" y2="12" stroke="#2ecc71" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="12" y1="8" x2="8" y2="12" stroke="#2ecc71" stroke-width="2" stroke-linecap="round"/>`,

  Pilates: `<rect x="3" y="6" width="14" height="8" rx="3" stroke="#fff" stroke-width="1.8" fill="none"/>` +
    `<circle cx="10" cy="10" r="2.5" fill="#fff"/>`,

  "Pilates Reformer": `<rect x="2" y="6" width="16" height="8" rx="1" stroke="#fff" stroke-width="1.5" fill="none"/>` +
    `<rect x="2" y="6" width="4" height="8" rx="1" fill="#fff"/>` +
    `<line x1="18" y1="8" x2="18" y2="12" stroke="#fff" stroke-width="1.5"/>`,

  "Pole Dance": `<line x1="10" y1="2" x2="10" y2="18" stroke="#fff" stroke-width="2.5"/>` +
    `<circle cx="10" cy="4" r="2" fill="#fff"/>` +
    `<path d="M12,6l4,4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>` +
    `<path d="M10,10l-4,3" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>`,

  "Indoor Cycling": `<circle cx="10" cy="10" r="6" stroke="#fff" stroke-width="1.8" fill="none"/>` +
    `<line x1="10" y1="4" x2="10" y2="16" stroke="#fff" stroke-width="1.5"/>` +
    `<line x1="4" y1="10" x2="16" y2="10" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="10" cy="10" r="2" fill="#fff"/>` +
    `<path d="M4,16l6-2" stroke="#fff" stroke-width="1.5" fill="none"/>`,

  Wellness: `<path d="M10,18c-4-3-7-6-7-9c0-3,3-5,7-2c4-3,7-1,7,2c0,3-3,6-7,9z" fill="#fff"/>` +
    `<path d="M8,10l2,2l4-4" stroke="#2ecc71" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  Sauna: `<path d="M16,5l-6,9H4l6-9z" fill="#fff"/>` +
    `<path d="M10,14l-2,3" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M6,12l-1,2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` +
    `<path d="M14,12l1,2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,

  Spa: `<circle cx="10" cy="12" r="6" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<path d="M10,6c0,0,4-2,4,2s-4,4-4,4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<path d="M10,6c0,0-4-2-4,2s4,4,4,4" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  Massage: `<circle cx="10" cy="4" r="2" fill="#fff"/>` +
    `<path d="M10,6v4" stroke="#fff" stroke-width="1.8" fill="none"/>` +
    `<circle cx="6" cy="13" r="3" fill="#fff"/><circle cx="14" cy="13" r="3" fill="#fff"/>` +
    `<circle cx="6" cy="13" r="1" fill="#2ecc71"/><circle cx="14" cy="13" r="1" fill="#2ecc71"/>`,

  Meditation: `<circle cx="10" cy="4" r="2.5" fill="#fff"/>` +
    `<path d="M10,6.5v3l-5,5m5-5l5,5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M10,9l-3,2m3-2l3,2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<circle cx="10" cy="16" r="2" fill="none" stroke="#fff" stroke-width="1.5"/>`,

  Hiking: `<path d="M10,3a2,2,0,1,0,0-4a2,2,0,0,0,0,4zm0,2v6l-4,7m4-7l4,5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M6,8l4,2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<polyline points="18,14 15,8 12,12" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  Bootcamp: `<polyline points="5,14 8,6 12,8 16,4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<line x1="3" y1="16" x2="17" y2="16" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="8" y1="6" x2="8" y2="16" stroke="#fff" stroke-width="1" stroke-dasharray="2,2"/>`,

  Crosstraining: `<line x1="5" y1="5" x2="15" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<line x1="15" y1="5" x2="5" y2="15" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<circle cx="10" cy="10" r="6" fill="none" stroke="#fff" stroke-width="1.5"/>`,

  "Functional Training": `<circle cx="10" cy="10" r="3" fill="#fff"/>` +
    `<circle cx="10" cy="10" r="7" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3,2"/>` +
    `<line x1="10" y1="3" x2="10" y2="5" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` +
    `<line x1="10" y1="15" x2="10" y2="17" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` +
    `<line x1="3" y1="10" x2="5" y2="10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` +
    `<line x1="15" y1="10" x2="17" y2="10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,

  Barre: `<line x1="2" y1="5" x2="18" y2="5" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="8" cy="4" r="1.5" fill="#fff"/>` +
    `<path d="M8,5.5v4l-3,4m3-4l4,2" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>` +
    `<line x1="2" y1="7" x2="6" y2="7" stroke="#fff" stroke-width="1"/>`,

  "Beach Volleyball": `<circle cx="10" cy="10" r="5" fill="none" stroke="#fff" stroke-width="1.8"/>` +
    `<path d="M13,7q5,0 0,10" stroke="#fff" stroke-width="1.2" fill="none"/>` +
    `<circle cx="10" cy="10" r="1.5" fill="#fff"/>`,

  Badminton: `<ellipse cx="10" cy="5" rx="2" ry="3" fill="#fff"/>` +
    `<polyline points="8,8 10,16 12,8" stroke="#fff" stroke-width="1.5" fill="none" stroke-linejoin="round"/>` +
    `<line x1="10" y1="10" x2="10" y2="16" stroke="#fff" stroke-width="1" stroke-dasharray="1,2"/>`,

  Squash: `<rect x="2" y="2" width="16" height="16" rx="1" stroke="#fff" stroke-width="1.5" fill="none"/>` +
    `<circle cx="12" cy="12" r="3" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<line x1="14" y1="10" x2="18" y2="6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,

  Padel: `<ellipse cx="10" cy="10" rx="6" ry="7" stroke="#fff" stroke-width="1.5" fill="none"/>` +
    `<line x1="10" y1="3" x2="10" y2="17" stroke="#fff" stroke-width="1" stroke-dasharray="2,2"/>` +
    `<circle cx="8" cy="8" r="1" fill="#fff"/><circle cx="12" cy="8" r="1" fill="#fff"/>` +
    `<circle cx="10" cy="12" r="1" fill="#fff"/>`,

  "Game of Golf": `<circle cx="7" cy="6" r="3" fill="#fff"/>` +
    `<line x1="7" y1="9" x2="7" y2="15" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M10,15l4-6l4,1" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  "Golf Driving Range": `<line x1="4" y1="16" x2="12" y2="4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="14" cy="4" r="2.5" fill="#fff"/>` +
    `<path d="M16,14a5,5,0,0,0,0-10" stroke="#fff" stroke-width="1.5" fill="none"/>`,

  Trampoline: `<path d="M3,12q7-3,14,0" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<line x1="3" y1="16" x2="3" y2="12" stroke="#fff" stroke-width="1.5"/>` +
    `<line x1="17" y1="16" x2="17" y2="12" stroke="#fff" stroke-width="1.5"/>` +
    `<polyline points="7,8 10,3 13,8" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  "Ice Skating": `<line x1="3" y1="16" x2="19" y2="16" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="8" cy="6" r="2" fill="#fff"/>` +
    `<path d="M8,8v5l-4,3m4-5l6,2l4-1" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  Archery: `<path d="M15,4q-8,0-8,8q0,8,8,8" stroke="#fff" stroke-width="1.5" fill="none"/>` +
    `<line x1="3" y1="12" x2="17" y2="12" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `<polygon points="17,10 20,12 17,14" fill="#fff"/>`,

  Aqua: `<path d="M3,14q3-4,6,0q3-4,6,0" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<path d="M6,10q3-4,6,0q3-4,6,0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.5"/>` +
    `<circle cx="10" cy="5" r="2" fill="#fff"/>`,

  "Stand Up Paddling": `<path d="M4,14h12" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<circle cx="10" cy="4" r="2" fill="#fff"/>` +
    `<line x1="10" y1="6" x2="10" y2="14" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>` +
    `<path d="M7,7l3,2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<path d="M13,7l-3,2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  EMS: `<polyline points="13,2 7,10 11,10 9,18 15,10 11,10" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,

  "EMS Cardio": `<polyline points="14,3 10,10 12,10 10,16 16,9 13,9" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M4,10a2,2,0,0,1,4,0a2,2,0,0,1,4,0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  "Vibration Training": `<line x1="10" y1="2" x2="10" y2="18" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<path d="M4,8q0-3,3,0q3,3,6,0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<path d="M10,8q3-3,6,0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  Cryotherapy: `<line x1="10" y1="2" x2="10" y2="18" stroke="#fff" stroke-width="1.5"/>` +
    `<line x1="2" y1="10" x2="18" y2="10" stroke="#fff" stroke-width="1.5"/>` +
    `<line x1="5" y1="5" x2="15" y2="15" stroke="#fff" stroke-width="1.2"/>` +
    `<line x1="15" y1="5" x2="5" y2="15" stroke="#fff" stroke-width="1.2"/>` +
    `<circle cx="10" cy="10" r="3" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="10" cy="10" r="1" fill="#fff"/>`,

  PersonalTraining: `<circle cx="10" cy="4" r="2.5" fill="#fff"/>` +
    `<path d="M10,6.5v5l-4,5m4-5l4,5" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M7,9l3,2m3-2l-3,2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<circle cx="18" cy="3" r="1" fill="#fff"/>` +
    `<line x1="18" y1="4" x2="18" y2="7" stroke="#fff" stroke-width="1"/>`,

  Relaxation: `<path d="M12,4a8,8,0,1,1-8,8" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/>` +
    `<circle cx="12" cy="4" r="2" fill="#fff"/>` +
    `<circle cx="4" cy="12" r="2" fill="#fff"/>` +
    `<line x1="12" y1="6" x2="12" y2="10" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` +
    `<line x1="12" y1="10" x2="8" y2="12" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>`,

  Hyrox: `<line x1="4" y1="3" x2="4" y2="17" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<line x1="4" y1="10" x2="11" y2="10" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<line x1="11" y1="3" x2="11" y2="17" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>` +
    `<circle cx="16" cy="8" r="2" fill="#fff"/>` +
    `<path d="M16,10v4l-2,3" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>` +
    `<path d="M14,13l2-1l2,1" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  "Qi Gong and Tai Chi": `<circle cx="10" cy="10" r="8" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<path d="M10,4v6l-4,4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M10,10l4-2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<circle cx="10" cy="10" r="1.5" fill="#fff"/>`,

  Aerial: `<line x1="10" y1="2" x2="10" y2="6" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="6" cy="4" r="2" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="14" cy="4" r="2" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<circle cx="6" cy="4" r="1" fill="#fff"/><circle cx="14" cy="4" r="1" fill="#fff"/>` +
    `<path d="M5,7q0,6,10,0" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,

  "Traditional Asian Martial Arts": `<circle cx="10" cy="10" r="8" fill="none" stroke="#fff" stroke-width="1.5"/>` +
    `<path d="M10,2a8,8,0,0,1,0,16a4,4,0,0,0,0-8a4,4,0,0,1,0-8z" fill="#fff"/>` +
    `<circle cx="10" cy="6" r="1.5" fill="#2ecc71"/><circle cx="10" cy="14" r="1.5" fill="#fff"/>`,

  Capoeira: `<circle cx="10" cy="3" r="2.5" fill="#fff"/>` +
    `<path d="M10,5.5l-3,4l5,3l-6,4" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M12,7l4-2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>` +
    `<path d="M10,10l-2,2" stroke="#fff" stroke-width="1.5" fill="none" stroke-linecap="round"/>`,
};

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

function extractMunichBoundsQuery() {
  const [[west, south], [east, north]] = MUNICH_GREATER_AREA_BOUNDS;
  return { south, west, north, east };
}

async function fetchMunichUbahnOverlayFromOverpass(config: AppConfig) {
  const { south, west, north, east } = extractMunichBoundsQuery();

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
(
  relation["route"="subway"](${south},${west},${north},${east});
  node["railway"="station"]["station"="subway"](${south},${west},${north},${east});
  node["public_transport"="station"]["subway"="yes"](${south},${west},${north},${east});
  way["railway"="station"]["station"="subway"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;
      `.trim(),
  );

  const nodeMap = new Map<number, { latitude: number; longitude: number }>();
  const wayMap = new Map<number, number[]>();
  const wayTagsMap = new Map<number, Record<string, string>>();
  const relationMap = new Map<number, NonNullable<(typeof routesPayload.elements)[number]>>();
  const referencedRouteRelationIds = new Set<number>();
  const ubahnStations = new Map<string, TransitStop>();
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
    if (element.type === "relation") {
      relationMap.set(element.id, element);
      if (element.tags?.route === "subway") {
        for (const member of element.members ?? []) {
          if (member.type === "relation") {
            referencedRouteRelationIds.add(member.ref);
          }
        }
      }
    }

    if (element.type === "way") {
      if (element.nodes) {
        wayMap.set(element.id, element.nodes);
      }
      if (element.tags) {
        wayTagsMap.set(element.id, element.tags);
      }
    }
  }

  const stationCandidates: Array<{
    name: string;
    latitude: number;
    longitude: number;
    modes: string[];
  }> = [];

  for (const element of routesPayload.elements) {
    if (!element.tags) {
      continue;
    }

    const isStationNode =
      element.type === "node" &&
      (element.tags.railway === "station" || element.tags.subway === "yes");
    const isStationWay =
      element.type === "way" &&
      element.tags.railway === "station" &&
      element.tags.station === "subway";

    if (!isStationNode && !isStationWay) {
      continue;
    }

    let latitude = element.lat ?? null;
    let longitude = element.lon ?? null;

    if (element.type === "way" && (latitude === null || longitude === null)) {
      const coords = (element.nodes ?? [])
        .map((nodeId) => nodeMap.get(nodeId))
        .filter(Boolean);
      if (coords.length > 0) {
        latitude = coords.reduce((sum, coord) => sum + coord!.latitude, 0) / coords.length;
        longitude = coords.reduce((sum, coord) => sum + coord!.longitude, 0) / coords.length;
      }
    }

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      continue;
    }

    const modes = transitModeTags(element.tags);
    if (!modes.includes("U-Bahn")) {
      continue;
    }

    const name = element.tags.name || element.tags.ref || "U-Bahn station";
    stationCandidates.push({ name, latitude, longitude, modes });
  }

  // Group stations by name and proximity (within 500 meters) and average coordinates
  const stationGroups: Array<Array<{
    name: string;
    latitude: number;
    longitude: number;
    modes: string[];
  }>> = [];

  for (const cand of stationCandidates) {
    let addedToGroup = false;
    for (const group of stationGroups) {
      const representative = group[0];
      if (representative && representative.name === cand.name) {
        const dist = haversineDistanceMeters(representative, cand);
        if (dist <= 500) {
          group.push(cand);
          addedToGroup = true;
          break;
        }
      }
    }
    if (!addedToGroup) {
      stationGroups.push([cand]);
    }
  }

  for (const group of stationGroups) {
    const firstNode = group[0];
    if (!firstNode) {
      continue;
    }
    const name = firstNode.name;
    const avgLatitude = group.reduce((sum, s) => sum + s.latitude, 0) / group.length;
    const avgLongitude = group.reduce((sum, s) => sum + s.longitude, 0) / group.length;
    const mergedModes = Array.from(new Set(group.flatMap((s) => s.modes)));

    const key = `${name}|${avgLatitude.toFixed(4)}|${avgLongitude.toFixed(4)}`;
    ubahnStations.set(key, {
      id: key,
      name,
      latitude: avgLatitude,
      longitude: avgLongitude,
      modes: mergedModes.length > 0 ? mergedModes : ["U-Bahn"],
      routeRefs: [],
    });
  }

  function collectRoutePaths(
    relation: NonNullable<(typeof routesPayload.elements)[number]>,
    visitedRelations = new Set<number>(),
  ) {
    if (relation.type !== "relation" || visitedRelations.has(relation.id)) {
      return [] as Array<Array<{ latitude: number; longitude: number }>>;
    }

    visitedRelations.add(relation.id);
    const paths: Array<Array<{ latitude: number; longitude: number }>> = [];

    for (const member of relation.members ?? []) {
      if (member.type === "way") {
        if (member.role === "platform" || member.role === "stop" || member.role === "station") {
          continue;
        }

        const tags = wayTagsMap.get(member.ref);
        if (tags) {
          if (
            tags.railway === "platform" ||
            tags.public_transport === "platform" ||
            tags.highway === "platform" ||
            tags.railway === "station" ||
            tags.public_transport === "station" ||
            tags.amenity === "station"
          ) {
            continue;
          }
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
          // Check if the path is a small closed loop (typical of station/platform polygons)
          if (path.length >= 3) {
            const first = path[0];
            const last = path[path.length - 1];
            if (first && last && haversineDistanceMeters(first, last) < 2) {
              let maxDist = 0;
              for (let i = 0; i < path.length; i++) {
                for (let j = i + 1; j < path.length; j++) {
                  const d = haversineDistanceMeters(path[i]!, path[j]!);
                  if (d > maxDist) maxDist = d;
                }
              }
              if (maxDist < 250) {
                // Skip small loops
                continue;
              }
            }
          }
          paths.push(path);
        }
        continue;
      }

      if (member.type === "relation") {
        const nested = relationMap.get(member.ref);
        if (!nested) {
          continue;
        }
        paths.push(...collectRoutePaths(nested, visitedRelations));
      }
    }

    return paths;
  }

  // Group route relations by ref (subway line, e.g., "U1")
  const routeGroups = new Map<string, Array<{
    id: string;
    name: string;
    ref: string;
    color: string | null;
    paths: Array<Array<{ latitude: number; longitude: number }>>;
  }>>();

  for (const element of routesPayload.elements) {
    if (element.type !== "relation" || element.tags?.route !== "subway") {
      continue;
    }

    if (referencedRouteRelationIds.has(element.id)) {
      continue;
    }

    const paths = collectRoutePaths(element);
    if (paths.length === 0) {
      continue;
    }

    const ref = element.tags.ref || "";
    const color = normalizeMapColor(element.tags.colour || element.tags.color || null);
    const name = element.tags.name || element.tags.ref || "U-Bahn route";

    const groupKey = ref || `${element.id}`;
    if (!routeGroups.has(groupKey)) {
      routeGroups.set(groupKey, []);
    }
    routeGroups.get(groupKey)!.push({
      id: `${element.id}`,
      name,
      ref,
      color,
      paths,
    });
  }

  for (const [groupKey, routesInGroup] of routeGroups.entries()) {
    if (routesInGroup.length === 0) {
      continue;
    }

    const firstRoute = routesInGroup[0];
    if (!firstRoute) {
      continue;
    }
    const color = routesInGroup.find((r) => r.color !== null)?.color ?? null;

    // Merge paths from all routes in this group
    const mergedPaths: Array<Array<{ latitude: number; longitude: number }>> = [];
    for (const r of routesInGroup) {
      mergedPaths.push(...r.paths);
    }

    // --- Build unified route line from all direction paths ---
    const finalPaths = simplifyRoutePaths(
      mergedPaths,
      haversineDistanceMeters,
    );

    if (finalPaths.length === 0) {
      continue;
    }

    const ref = firstRoute.ref;
    const name = ref ? `U-Bahn ${ref}` : firstRoute.name;
    const id = ref || firstRoute.id;

    ubahnRoutes.push({
      id,
      name,
      ref,
      color,
      paths: finalPaths,
    });
  }

  const stationList = Array.from(ubahnStations.values());

  // Match stations to routes by proximity (within 100m)
  for (const station of stationList) {
    const matchedRefs = new Set<string>();
    for (const route of ubahnRoutes) {
      if (!route.ref) continue;
      for (const path of route.paths) {
        let found = false;
        for (const point of path) {
          if (haversineDistanceMeters(station, point) < 100) {
            matchedRefs.add(route.ref);
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    station.routeRefs = [...matchedRefs].sort();
  }

  await saveMunichUbahnRoutes(config, {
    ubahnStations: stationList,
    ubahnRoutes,
  });
  return {
    ubahnStations: stationList,
    ubahnRoutes,
  };
}

export async function fetchMunichUbahnOverlay(config: AppConfig) {
  if (hasTransitOverlayCache(config)) {
    const [ubahnStations, ubahnRoutes] = await Promise.all([
      getMunichUbahnStations(config),
      getMunichUbahnRoutes(config),
    ]);
    if (ubahnStations.length > 0 || ubahnRoutes.length > 0) {
      return { ubahnStations, ubahnRoutes };
    }
  }

  return await fetchMunichUbahnOverlayFromOverpass(config);
}

export async function fetchTransitMapOverlay(
  config: AppConfig,
): Promise<{ ubahnStations: TransitStop[]; ubahnRoutes: UbahnRoute[] }> {
  try {
    return await fetchMunichUbahnOverlay(config);
  } catch (error) {
    console.warn("Transit overlay fetch failed, continuing without routes", error);
    return { ubahnStations: [], ubahnRoutes: [] };
  }
}
