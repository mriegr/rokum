import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
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
  CustomPoiInput,
  MapPayload,
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
  };
}

export function getSettings(app: AppState) {
  return getWeightSettings(app.database);
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
