import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  bulkUpdatePoiActiveState,
  createDatabase,
  deleteApartmentPhotoRecord,
  deleteApartmentRecord,
  deleteCustomPoiRecord,
  getApartmentById,
  getApartmentPhoto,
  getCustomPoiById,
  getWeightSettings,
  insertApartment,
  insertCustomPoi,
  listAllPois,
  listApartments,
  listCustomPois,
  replaceApartmentCustomPoiScores,
  replaceApartmentPoiScores,
  saveWeightSettings,
  setApartmentScoring,
  updateApartmentCoordinates,
  updateApartmentRecord,
  updateCustomPoiCoordinates,
  updateCustomPoiRecord,
} from "./db";
import { loadConfig } from "./config";
import {
  CATEGORY_LABELS,
  buildCustomPoiScore,
  buildDefaultStandardPoiScore,
  calculatePricePerSqm,
  calculateTotalScore,
  combineCustomPoiScore,
  combineWalkAndTransitScore,
  scorePricePerSqm,
  scoreRooms,
} from "./scoring";
import {
  ensurePoisForCategory,
  fetchTransitMapOverlay,
  geocodeAddress,
  getActiveCustomPois,
  listNearbyMapPois,
  routeTransit,
  routeWalking,
  seedSportStudios,
  storeUploadedPhotos,
} from "./services";
import type {
  Apartment,
  ApartmentInput,
  ApartmentScoreSnapshot,
  BootstrapPayload,
  CustomPoi,
  MapConfig,
  CustomPoiInput,
  ManagedPoi,
  MapPayload,
  PoiManagementPayload,
  StandardPoiCategory,
  StandardPoiScore,
  WeightSettings,
} from "./types";

const STANDARD_CATEGORIES: StandardPoiCategory[] = [
  "supermarket",
  "sport_studio",
  "ubahn",
  "cafe",
  "park_or_river",
];

const TILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TILE_CACHE_MAX_ENTRIES = 512;

type TileCacheEntry = {
  body: ArrayBuffer;
  contentType: string;
  expiresAt: number;
};

const tileCache = new Map<string, TileCacheEntry>();
const tileInflight = new Map<string, Promise<{ body: ArrayBuffer; contentType: string }>>();

type AppState = Awaited<ReturnType<typeof initApp>>;

function requireApartmentInput(input: unknown): ApartmentInput {
  const payload = input as Record<string, unknown>;
  const address = String(payload.address ?? "").trim();
  if (!address) {
    throw new Error("Address is required");
  }

  return {
    address,
    squareMeters: Number(payload.squareMeters ?? 0),
    kaltmiete: Number(payload.kaltmiete ?? 0),
    warmmiete: Number(payload.warmmiete ?? 0),
    floorLevel: String(payload.floorLevel ?? ""),
    roomCount: Number(payload.roomCount ?? 0),
    description: String(payload.description ?? ""),
  };
}

function requireCustomPoiInput(input: unknown): CustomPoiInput {
  const payload = input as Record<string, unknown>;
  const name = String(payload.name ?? "").trim();
  const address = String(payload.address ?? "").trim();
  if (!name || !address) {
    throw new Error("Custom POI name and address are required");
  }

  return {
    name,
    address,
    notes: String(payload.notes ?? ""),
    isActive: payload.isActive === undefined ? true : Boolean(payload.isActive),
  };
}

function mergeWeightSettings(input: unknown, current: WeightSettings): WeightSettings {
  const payload = input as Record<string, unknown>;
  return {
    pricePerSqm: Number(payload.pricePerSqm ?? current.pricePerSqm),
    rooms: Number(payload.rooms ?? current.rooms),
    supermarket: Number(payload.supermarket ?? current.supermarket),
    sportStudio: Number(payload.sportStudio ?? current.sportStudio),
    ubahn: Number(payload.ubahn ?? current.ubahn),
    cafe: Number(payload.cafe ?? current.cafe),
    parkOrRiver: Number(payload.parkOrRiver ?? current.parkOrRiver),
    customPoi: Number(payload.customPoi ?? current.customPoi),
  };
}

function scoreCategoryWeightKey(category: StandardPoiCategory) {
  switch (category) {
    case "sport_studio":
      return "sportStudio";
    case "park_or_river":
      return "parkOrRiver";
    default:
      return category;
  }
}

function categoryLabel(category: StandardPoiCategory | "custom") {
  switch (category) {
    case "supermarket":
      return "Supermarket";
    case "sport_studio":
      return "Sport studio";
    case "ubahn":
      return "U-Bahn";
    case "cafe":
      return "Cafe";
    case "park_or_river":
      return "Park / river";
    case "custom":
      return "Custom";
  }
}

function buildManagedPois(app: AppState): ManagedPoi[] {
  const standardPois = listAllPois(app.database).map(
    (poi): ManagedPoi => ({
      id: poi.id,
      kind: "standard",
      category: poi.category,
      categoryLabel: categoryLabel(poi.category),
      name: poi.name,
      address: poi.address,
      isActive: poi.isActive,
      notes: "",
      source: poi.source,
      tags: poi.tags,
      latitude: poi.latitude,
      longitude: poi.longitude,
      createdAt: "",
      updatedAt: null,
    }),
  );
  const customPois = listCustomPois(app.database).map(
    (poi): ManagedPoi => ({
      id: poi.id,
      kind: "custom",
      category: "custom",
      categoryLabel: categoryLabel("custom"),
      name: poi.name,
      address: poi.address,
      isActive: poi.isActive,
      notes: poi.notes,
      source: "custom",
      tags: [],
      latitude: poi.latitude,
      longitude: poi.longitude,
      createdAt: poi.createdAt,
      updatedAt: poi.updatedAt,
    }),
  );

  return [...standardPois, ...customPois].sort((left, right) => {
    if (left.isActive !== right.isActive) {
      return Number(right.isActive) - Number(left.isActive);
    }

    if (left.kind !== right.kind) {
      return left.kind.localeCompare(right.kind);
    }

    return left.name.localeCompare(right.name);
  });
}

function requirePoiStatusPayload(input: unknown) {
  const payload = input as Record<string, unknown>;
  const isActive = Boolean(payload.isActive);
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.flatMap((item) => {
    const value = item as Record<string, unknown>;
    const id = Number(value.id);
    const kind = value.kind === "custom" ? "custom" : value.kind === "standard" ? "standard" : null;

    if (!Number.isInteger(id) || id <= 0 || !kind) {
      return [];
    }

    return [{ id, kind }] as const;
  });

  if (items.length === 0) {
    throw new Error("At least one POI is required");
  }

  return {
    isActive,
    items,
  };
}

async function buildStandardPoiScores(app: AppState, apartment: Apartment) {
  if (apartment.latitude === null || apartment.longitude === null) {
    return STANDARD_CATEGORIES.map((category) => buildDefaultStandardPoiScore(category));
  }

  const origin = {
    latitude: apartment.latitude,
    longitude: apartment.longitude,
  };

  const ubahnCandidates = await ensurePoisForCategory(
    app.database,
    app.config,
    "ubahn",
    origin,
  );

  const scores: StandardPoiScore[] = [];
  for (const category of STANDARD_CATEGORIES) {
    const candidates =
      category === "ubahn"
        ? ubahnCandidates
        : await ensurePoisForCategory(app.database, app.config, category, origin);

    const bestCandidate = candidates[0];
    if (!bestCandidate) {
      scores.push(buildDefaultStandardPoiScore(category));
      continue;
    }

    const destination = {
      latitude: bestCandidate.latitude,
      longitude: bestCandidate.longitude,
    };

    const walking = await routeWalking(app.config, origin, destination);
    const transit = await routeTransit(app.config, origin, destination, ubahnCandidates);

    scores.push({
      category,
      label: CATEGORY_LABELS[category],
      poiName: bestCandidate.name,
      poiAddress: bestCandidate.address,
      latitude: bestCandidate.latitude,
      longitude: bestCandidate.longitude,
      walking,
      transit,
      score: combineWalkAndTransitScore(walking, transit),
    });
  }

  return scores;
}

async function buildCustomPoiScores(app: AppState, apartment: Apartment, customPois: CustomPoi[]) {
  if (apartment.latitude === null || apartment.longitude === null) {
    return customPois.map(buildCustomPoiScore);
  }

  const origin = {
    latitude: apartment.latitude,
    longitude: apartment.longitude,
  };

  const ubahnCandidates = await ensurePoisForCategory(
    app.database,
    app.config,
    "ubahn",
    origin,
  );

  const scores = [];
  for (const customPoi of customPois) {
    if (customPoi.latitude === null || customPoi.longitude === null) {
      scores.push(buildCustomPoiScore(customPoi));
      continue;
    }

    const destination = {
      latitude: customPoi.latitude,
      longitude: customPoi.longitude,
    };

    const walking = await routeWalking(app.config, origin, destination);
    const transit = await routeTransit(app.config, origin, destination, ubahnCandidates);

    scores.push({
      customPoiId: customPoi.id,
      name: customPoi.name,
      address: customPoi.address,
      latitude: customPoi.latitude,
      longitude: customPoi.longitude,
      walking,
      transit,
      score: combineCustomPoiScore(walking, transit),
    });
  }

  return scores;
}

async function rescoreApartment(app: AppState, apartmentId: number) {
  const apartment = getApartmentById(app.database, apartmentId);
  if (!apartment) {
    throw new Error("Apartment not found");
  }

  let refreshedApartment = apartment;
  if (apartment.latitude === null || apartment.longitude === null) {
    try {
      const coordinates = await geocodeAddress(app.config, apartment.address);
      updateApartmentCoordinates(
        app.database,
        apartmentId,
        coordinates.latitude,
        coordinates.longitude,
      );
      refreshedApartment = getApartmentById(app.database, apartmentId)!;
    } catch (error) {
      console.warn("Apartment geocoding failed, keeping score partial", error);
    }
  }

  const standardPoiScores = await buildStandardPoiScores(app, refreshedApartment);
  const customPoiScores = await buildCustomPoiScores(
    app,
    refreshedApartment,
    getActiveCustomPois(app.database),
  );
  const weights = getWeightSettings(app.database);
  const pricePerSqmValue = calculatePricePerSqm(refreshedApartment);
  const pricePerSqmScore = scorePricePerSqm(pricePerSqmValue);
  const roomScore = scoreRooms(refreshedApartment.roomCount);
  const totalScore = calculateTotalScore(
    pricePerSqmScore,
    roomScore,
    standardPoiScores,
    customPoiScores,
    weights,
  );

  const scoring: ApartmentScoreSnapshot = {
    pricePerSqm: pricePerSqmScore,
    roomScore,
    pricePerSqmValue,
    standardPoiScores,
    customPoiScores,
    totalScore,
    updatedAt: new Date().toISOString(),
  };

  replaceApartmentPoiScores(app.database, apartmentId, standardPoiScores);
  replaceApartmentCustomPoiScores(app.database, apartmentId, customPoiScores);
  setApartmentScoring(app.database, apartmentId, scoring);

  return getApartmentById(app.database, apartmentId)!;
}

async function rescoreAllApartments(app: AppState) {
  const apartments = listApartments(app.database);
  for (const apartment of apartments) {
    await rescoreApartment(app, apartment.id);
  }
}

function buildMapConfig(app: AppState): MapConfig {
  return {
    tileUrl: "/api/map-tiles/{z}/{x}/{y}{r}.png",
    attribution: app.config.jawgApiKey
      ? '&copy; <a href="https://www.jawg.io" target="_blank" rel="noopener noreferrer">Jawg</a> &copy; OpenStreetMap contributors'
      : "&copy; OpenStreetMap contributors",
    maxZoom: app.config.jawgApiKey ? 22 : 19,
  };
}

function tileCacheKey(z: string, x: string, y: string, retina: boolean) {
  return `${z}/${x}/${y}${retina ? "@2x" : ""}`;
}

function buildTileUpstreamUrl(app: AppState, z: string, x: string, y: string, retina: boolean) {
  if (app.config.jawgApiKey) {
    return `https://tile.jawg.io/jawg-streets/${z}/${x}/${y}${
      retina ? "@2x" : ""
    }.png?access-token=${app.config.jawgApiKey}`;
  }

  const subdomain = ["a", "b", "c"][(Number(x) + Number(y)) % 3];
  return `https://${subdomain}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function evictOldestTileCacheEntry() {
  const oldestKey = tileCache.keys().next().value;
  if (oldestKey) {
    tileCache.delete(oldestKey);
  }
}

export async function serveMapTile(
  app: AppState,
  z: string,
  x: string,
  y: string,
  retina: boolean,
) {
  const key = tileCacheKey(z, x, y, retina);
  const now = Date.now();
  const cached = tileCache.get(key);

  if (cached && cached.expiresAt > now) {
    return new Response(cached.body.slice(0), {
      headers: {
        "Content-Type": cached.contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Rokum-Tile-Cache": "HIT",
      },
    });
  }

  let inflight = tileInflight.get(key);
  if (!inflight) {
    inflight = (async () => {
      const upstreamResponse = await fetch(buildTileUpstreamUrl(app, z, x, y, retina), {
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });

      if (!upstreamResponse.ok) {
        throw new Error(`Tile upstream request failed: ${upstreamResponse.status}`);
      }

      return {
        body: await upstreamResponse.arrayBuffer(),
        contentType: upstreamResponse.headers.get("content-type") ?? "image/png",
      };
    })();

    tileInflight.set(key, inflight);
  }

  try {
    const { body, contentType } = await inflight;

    tileCache.delete(key);
    tileCache.set(key, {
      body,
      contentType,
      expiresAt: now + TILE_CACHE_TTL_MS,
    });

    while (tileCache.size > TILE_CACHE_MAX_ENTRIES) {
      evictOldestTileCacheEntry();
    }

    return new Response(body.slice(0), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "X-Rokum-Tile-Cache": "MISS",
      },
    });
  } catch (error) {
    if (cached) {
      return new Response(cached.body.slice(0), {
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=300, stale-while-revalidate=604800",
          "X-Rokum-Tile-Cache": "STALE",
        },
      });
    }

    console.warn("Map tile fetch failed", error);
    return new Response("Tile unavailable", { status: 502 });
  } finally {
    tileInflight.delete(key);
  }
}

export async function initApp() {
  const config = loadConfig();
  const database = createDatabase(config);
  await seedSportStudios(database);

  return {
    config,
    database,
    serveUpload(pathname: string) {
      const storageKey = pathname.replace(/^\/uploads\//, "");
      const filePath = join(config.uploadDirectory, storageKey);
      return new Response(Bun.file(filePath));
    },
  };
}

export function getBootstrapPayload(app: AppState): BootstrapPayload {
  return {
    apartments: listApartments(app.database),
    customPois: listCustomPois(app.database),
    settings: getWeightSettings(app.database),
    mapConfig: buildMapConfig(app),
  };
}

export function getSettings(app: AppState) {
  return getWeightSettings(app.database);
}

export function getPoiManagementPayload(app: AppState): PoiManagementPayload {
  return {
    pois: buildManagedPois(app),
  };
}

export async function updateSettings(app: AppState, payload: unknown) {
  const next = mergeWeightSettings(payload, getWeightSettings(app.database));
  saveWeightSettings(app.database, next);
  await rescoreAllApartments(app);
  return {
    settings: next,
    apartments: listApartments(app.database),
  };
}

export async function createApartment(app: AppState, payload: unknown) {
  const apartmentId = insertApartment(app.database, requireApartmentInput(payload));
  return await rescoreApartment(app, apartmentId);
}

export async function updateApartment(
  app: AppState,
  apartmentId: number,
  payload: unknown,
) {
  const input = requireApartmentInput(payload);
  updateApartmentRecord(app.database, apartmentId, input);
  try {
    const coordinates = await geocodeAddress(app.config, input.address);
    updateApartmentCoordinates(
      app.database,
      apartmentId,
      coordinates.latitude,
      coordinates.longitude,
    );
  } catch (error) {
    console.warn("Apartment geocoding failed during update", error);
  }
  return await rescoreApartment(app, apartmentId);
}

export async function deleteApartment(app: AppState, apartmentId: number) {
  const apartment = getApartmentById(app.database, apartmentId);
  if (!apartment) {
    return;
  }

  for (const photo of apartment.photos) {
    const filePath = join(app.config.uploadDirectory, photo.storageKey);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }

  deleteApartmentRecord(app.database, apartmentId);
}

export async function refreshApartmentScores(app: AppState, apartmentId: number) {
  return await rescoreApartment(app, apartmentId);
}

export async function uploadApartmentPhotos(
  app: AppState,
  apartmentId: number,
  formData: { getAll(name: string): unknown[] },
) {
  await storeUploadedPhotos(app.database, app.config, apartmentId, formData);
  return getApartmentById(app.database, apartmentId);
}

export async function deleteApartmentPhoto(
  app: AppState,
  apartmentId: number,
  photoId: number,
) {
  const photo = getApartmentPhoto(app.database, apartmentId, photoId);
  if (!photo) {
    return;
  }

  const storageKey = String(photo.storage_key);
  const filePath = join(app.config.uploadDirectory, storageKey);
  if (existsSync(filePath)) {
    rmSync(filePath);
  }

  deleteApartmentPhotoRecord(app.database, apartmentId, photoId);
}

export async function createCustomPoi(app: AppState, payload: unknown) {
  const customPoiId = insertCustomPoi(app.database, requireCustomPoiInput(payload));
  const customPoi = getCustomPoiById(app.database, customPoiId)!;
  try {
    const coordinates = await geocodeAddress(app.config, customPoi.address);
    updateCustomPoiCoordinates(
      app.database,
      customPoiId,
      coordinates.latitude,
      coordinates.longitude,
    );
  } catch (error) {
    console.warn("Custom POI geocoding failed", error);
  }
  await rescoreAllApartments(app);
  return getCustomPoiById(app.database, customPoiId);
}

export async function updateCustomPoi(
  app: AppState,
  customPoiId: number,
  payload: unknown,
) {
  const input = requireCustomPoiInput(payload);
  updateCustomPoiRecord(app.database, customPoiId, input);
  try {
    const coordinates = await geocodeAddress(app.config, input.address);
    updateCustomPoiCoordinates(
      app.database,
      customPoiId,
      coordinates.latitude,
      coordinates.longitude,
    );
  } catch (error) {
    console.warn("Custom POI geocoding failed during update", error);
  }
  await rescoreAllApartments(app);
  return getCustomPoiById(app.database, customPoiId);
}

export async function deleteCustomPoi(app: AppState, customPoiId: number) {
  deleteCustomPoiRecord(app.database, customPoiId);
  await rescoreAllApartments(app);
}

export async function updatePoiStatuses(app: AppState, payload: unknown) {
  const next = requirePoiStatusPayload(payload);
  bulkUpdatePoiActiveState(app.database, {
    standardPoiIds: next.items
      .filter((item) => item.kind === "standard")
      .map((item) => item.id),
    customPoiIds: next.items
      .filter((item) => item.kind === "custom")
      .map((item) => item.id),
    isActive: next.isActive,
  });
  await rescoreAllApartments(app);
  return getPoiManagementPayload(app);
}

export async function getApartmentMapData(
  app: AppState,
  apartmentId: number,
): Promise<MapPayload> {
  const apartment = getApartmentById(app.database, apartmentId);
  if (!apartment) {
    throw new Error("Apartment not found");
  }

  const scoring = apartment.scoring;
  const nearbyPois =
    apartment.latitude !== null && apartment.longitude !== null
      ? listNearbyMapPois(app.database, {
          latitude: apartment.latitude,
          longitude: apartment.longitude,
        })
      : [];
  const sportStudioTags = Array.from(
    new Set(
      nearbyPois
        .filter((poi) => poi.category === "sport_studio")
        .flatMap((poi) => poi.tags),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const transitOverlay =
    apartment.latitude !== null && apartment.longitude !== null
      ? await fetchTransitMapOverlay(app.config, {
          latitude: apartment.latitude,
          longitude: apartment.longitude,
        })
      : { transitStops: [], ubahnRoutes: [] };
  const fallbackTransitStops =
    transitOverlay.transitStops.length > 0
      ? transitOverlay.transitStops
      : [
          ...nearbyPois
            .filter((poi) => poi.category === "ubahn")
            .map((poi) => ({
              id: `poi-${poi.id}`,
              name: poi.name,
              latitude: poi.latitude,
              longitude: poi.longitude,
              modes: ["U-Bahn"],
            })),
          ...scoring.standardPoiScores
            .filter((score) => score.category === "ubahn")
            .map((score) => ({
              id: `score-${score.category}-${score.poiName}`,
              name: score.poiName,
              latitude: score.latitude,
              longitude: score.longitude,
              modes: ["U-Bahn"],
            })),
        ].filter(
          (stop, index, allStops) =>
            allStops.findIndex((candidate) => candidate.id === stop.id) === index,
        );

  return {
    apartment,
    standardPoiScores: scoring.standardPoiScores,
    customPoiScores: scoring.customPoiScores,
    nearbyPois,
    sportStudioTags,
    transitStops: fallbackTransitStops,
    ubahnRoutes: transitOverlay.ubahnRoutes,
  };
}
