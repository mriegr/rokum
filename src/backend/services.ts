import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  addApartmentPhoto,
  getPoiIcon,
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
import { badRequest } from "./httpErrors";
import {
  getMunichUbahnStations,
  getMunichUbahnRoutes,
  hasTransitOverlayCache,
  saveMunichUbahnRoutes,
} from "./transitOverlayCache";
import { simplifyRoutePaths } from "./routeSimplifier";
import { makeSportStudioSvg } from "./sportStudioIcons";
import { sanitizePathSegment } from "./storagePaths";

type Coordinates = {
  latitude: number;
  longitude: number;
};

const STANDARD_RADIUS_METERS = 1800;
const USER_AGENT = "rokum-apartment-shortlist/1.0";
const OVERPASS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const ADDRESS_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const ADDRESS_SEARCH_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const ADDRESS_SEARCH_CACHE_MAX_ENTRIES = 200;
const MAX_APARTMENT_PHOTO_BYTES = 15 * 1024 * 1024;

type OverpassCacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const overpassCache = new Map<string, OverpassCacheEntry>();

export type MapAddressSuggestion = {
  displayLabel: string;
  address: string;
  latitude: number;
  longitude: number;
};

type AddressSearchCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  suggestions: MapAddressSuggestion[];
};

type JawgAutocompletePayload = {
  features?: Array<{
    geometry?: {
      type?: string;
      coordinates?: unknown[];
    };
    properties?: {
      label?: string;
      name?: string;
    };
  }>;
};

const addressSearchCache = new Map<string, AddressSearchCacheEntry>();
const addressSearchInflight = new Map<string, Promise<MapAddressSuggestion[]>>();

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

function isWithinMunichGreaterArea(latitude: number, longitude: number) {
  const [[west, south], [east, north]] = MUNICH_GREATER_AREA_BOUNDS;
  return longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}

function normalizeAddressSuggestions(payload: JawgAutocompletePayload) {
  return (payload.features ?? []).flatMap((feature) => {
    const address = feature.properties?.label?.trim();
    const displayLabel = feature.properties?.name?.trim() || address?.split(",")[0]?.trim();
    const coordinates = feature.geometry?.coordinates;
    const longitude = Number(coordinates?.[0]);
    const latitude = Number(coordinates?.[1]);
    if (
      !address ||
      !displayLabel ||
      feature.geometry?.type !== "Point" ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !isWithinMunichGreaterArea(latitude, longitude)
    ) {
      return [];
    }

    return [{
      displayLabel,
      address,
      latitude,
      longitude,
    }];
  }).slice(0, 5);
}

function cacheAddressSuggestions(cacheKey: string, suggestions: MapAddressSuggestion[]) {
  if (!addressSearchCache.has(cacheKey) && addressSearchCache.size >= ADDRESS_SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = addressSearchCache.keys().next().value;
    if (oldestKey) {
      addressSearchCache.delete(oldestKey);
    }
  }

  const now = Date.now();
  addressSearchCache.delete(cacheKey);
  addressSearchCache.set(cacheKey, {
    suggestions,
    expiresAt: now + ADDRESS_SEARCH_CACHE_TTL_MS,
    staleUntil: now + ADDRESS_SEARCH_STALE_TTL_MS,
  });
}

export async function searchMapAddresses(config: AppConfig, query: string) {
  if (!config.jawgApiKey) {
    throw new Error("Map API configuration is missing.");
  }
  const jawgApiKey = config.jawgApiKey;

  const normalizedQuery = query.trim().replace(/\s+/g, " ");
  const cacheKey = normalizedQuery.toLocaleLowerCase("de-DE");
  const now = Date.now();
  const cached = addressSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    addressSearchCache.delete(cacheKey);
    addressSearchCache.set(cacheKey, cached);
    return cached.suggestions;
  }
  if (cached && cached.staleUntil <= now) {
    addressSearchCache.delete(cacheKey);
  }

  const existingRequest = addressSearchInflight.get(cacheKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request = (async () => {
    try {
      const [[west, south], [east, north]] = MUNICH_GREATER_AREA_BOUNDS;
      const url = new URL("https://api.jawg.io/places/v1/autocomplete");
      url.searchParams.set("text", normalizedQuery);
      url.searchParams.set("access-token", jawgApiKey);
      url.searchParams.set("boundary.rect.min_lon", String(west));
      url.searchParams.set("boundary.rect.min_lat", String(south));
      url.searchParams.set("boundary.rect.max_lon", String(east));
      url.searchParams.set("boundary.rect.max_lat", String(north));
      url.searchParams.set("layers", "address,street,venue");
      url.searchParams.set("lang", "de");
      url.searchParams.set("size", "5");

      const payload = await fetchJson<JawgAutocompletePayload>(url.toString());
      if (!Array.isArray(payload.features)) {
        throw new Error("Jawg autocomplete returned an invalid payload");
      }

      const suggestions = normalizeAddressSuggestions(payload);
      cacheAddressSuggestions(cacheKey, suggestions);
      return suggestions;
    } catch (error) {
      if (cached && cached.staleUntil > Date.now()) {
        return cached.suggestions;
      }
      throw error;
    } finally {
      addressSearchInflight.delete(cacheKey);
    }
  })();

  addressSearchInflight.set(cacheKey, request);
  return request;
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
      subcategory: venue.categories?.filter(Boolean)[0] ?? "",
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
    const svg = makeSportStudioSvg(tag);
    const safeName = sanitizePathSegment(tag, "sport");
    const filename = `${safeName}.svg`;
    const filePath = join(iconDir, filename);
    const iconPath = `/uploads/icons/${filename}`;
    const existingIcon = getPoiIcon(database, "sport_studio", tag);

    writeFileSync(filePath, svg, "utf8");
    if (!existingIcon) {
      upsertPoiIcon(database, "sport_studio", tag, iconPath);
    }
  }
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

    if (value.size > MAX_APARTMENT_PHOTO_BYTES) {
      throw badRequest("Apartment photos must be smaller than 15 MB");
    }

    const mimeType = value.type.toLowerCase();
    if (mimeType && !mimeType.startsWith("image/")) {
      throw badRequest("Apartment photos must be image files");
    }

    const buffer = await value.arrayBuffer();
    const safeName = sanitizePathSegment(value.name || "photo.jpg", "photo.jpg");
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
