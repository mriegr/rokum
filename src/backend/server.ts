import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  bulkUpdatePoiActiveState,
  createDatabase,
  deleteApartmentPhotoRecord,
  deleteApartmentRecord,
  deleteCustomPoiRecord,
  listPoiCategoryLabels,
  deletePoiIcon,
  getApartmentById,
  getApartmentPhoto,
  getCustomPoiById,
  getWeightSettings,
  insertApartment,
  insertCustomPoi,
  listActivePois,
  listAllPois,
  listApartments,
  listCustomPois,
  listPoiIcons,
  upsertPoiCategoryLabel,
  upsertPoiIcon,
  replaceApartmentCustomPoiScores,
  replaceApartmentPoiScores,
  saveWeightSettings,
  setApartmentScoring,
  updateApartmentCoordinates,
  updateApartmentRecord,
  updateCustomPoiCoordinates,
  updateCustomPoiRecord,
} from "./db";
import { badRequest, notFound } from "./httpErrors";
import { loadConfig } from "../shared/config";
import { MUNICH_CITY_CENTER, MUNICH_GREATER_AREA_BOUNDS } from "../shared/munich";
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
  routeTransit,
  routeWalking,
  seedSportStudioIcons,
  seedSportStudios,
  storeUploadedPhotos,
} from "./services";
import type {
  Apartment,
  ApartmentInput,
  ApartmentScoreSnapshot,
  BootstrapPayload,
  AppConfig,
  CustomPoi,
  MapConfig,
  CustomPoiInput,
  ManagedPoi,
  PoiCategoryLabelRecord,
  PoiCategoryManagementPayload,
  MapPayload,
  PoiIconMapping,
  PoiManagementPayload,
  StandardPoiCategory,
  StandardPoiScore,
  WeightSettings,
} from "../shared/types";
import { STANDARD_POI_CATEGORIES } from "../shared/types";
import { resolveWithinDirectory, sanitizePathSegment } from "./storagePaths";

const STANDARD_CATEGORIES = [...STANDARD_POI_CATEGORIES];
const JAWG_ALLOWED_HOSTS = new Set(["api.jawg.io", "tile.jawg.io"]);
const MAX_APARTMENT_PHOTO_BYTES = 15 * 1024 * 1024;
const MAX_POI_ICON_BYTES = 2 * 1024 * 1024;
const ALLOWED_POI_ICON_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
]);
const ALLOWED_POI_ICON_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "svg"]);

type MapAssetKind = "tile" | "glyph" | "sprite" | "source";
type MapAssetManifestEntry = {
  kind: MapAssetKind;
  url: string;
};

type MapProxyResponse = {
  body: ArrayBuffer;
  headers: HeadersInit;
  status: number;
};

const mapAssetManifest = new Map<string, MapAssetManifestEntry>();
const mapResourceInflight = new Map<string, Promise<MapProxyResponse>>();

type AppState = {
  config: AppConfig;
  database: ReturnType<typeof createDatabase>;
  serveUpload(pathname: string): Response;
};

function requireApartmentInput(input: unknown): ApartmentInput {
  const payload = input as Record<string, unknown>;
  const address = String(payload.address ?? "").trim();
  if (!address) {
    throw badRequest("Address is required");
  }

  return {
    address,
    squareMeters: requireFiniteNumber(payload.squareMeters, "Square meters"),
    kaltmiete: requireFiniteNumber(payload.kaltmiete, "Kaltmiete"),
    warmmiete: requireFiniteNumber(payload.warmmiete, "Warmmiete"),
    floorLevel: String(payload.floorLevel ?? ""),
    roomCount: requireFiniteNumber(payload.roomCount, "Rooms"),
    description: String(payload.description ?? ""),
  };
}

function requireCustomPoiInput(input: unknown): CustomPoiInput {
  const payload = input as Record<string, unknown>;
  const name = String(payload.name ?? "").trim();
  const address = String(payload.address ?? "").trim();
  if (!name || !address) {
    throw badRequest("Custom POI name and address are required");
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
    pricePerSqm: requireFiniteNumber(payload.pricePerSqm ?? current.pricePerSqm, "Price per m²"),
    rooms: requireFiniteNumber(payload.rooms ?? current.rooms, "Rooms"),
    supermarket: requireFiniteNumber(payload.supermarket ?? current.supermarket, "Supermarket"),
    sportStudio: requireFiniteNumber(payload.sportStudio ?? current.sportStudio, "Sport studio"),
    customPoi: requireFiniteNumber(payload.customPoi ?? current.customPoi, "Custom places"),
  };
}

function requireFiniteNumber(value: unknown, field: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw badRequest(`${field} must be a number`);
  }

  return number;
}

function categoryLabel(category: StandardPoiCategory | "custom") {
  switch (category) {
    case "supermarket":
      return "Supermarket";
    case "sport_studio":
      return "Sport studio";
    case "custom":
      return "Custom";
  }
}

function defaultCategoryLabel(category: StandardPoiCategory) {
  return categoryLabel(category);
}

function subcategoryLabelFallback(subcategory: string) {
  return subcategory
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildCategoryLabelMap(app: AppState) {
  const labels = new Map<string, string>();
  for (const record of listPoiCategoryLabels(app.database)) {
    labels.set(`${record.category}:${record.subcategory}`, record.label);
  }
  return labels;
}

function resolveCategoryLabel(
  labels: Map<string, string>,
  category: StandardPoiCategory,
  subcategory = "",
) {
  return (
    labels.get(`${category}:${subcategory}`) ??
    (subcategory ? subcategoryLabelFallback(subcategory) : defaultCategoryLabel(category))
  );
}

function buildManagedPois(app: AppState): ManagedPoi[] {
  const labels = buildCategoryLabelMap(app);
  const validCategories = new Set<string>(STANDARD_POI_CATEGORIES);
  const standardPois = listAllPois(app.database)
    .filter((poi) => validCategories.has(poi.category))
    .map(
    (poi): ManagedPoi => ({
      id: poi.id,
      kind: "standard",
      category: poi.category,
      categoryLabel: resolveCategoryLabel(labels, poi.category),
      name: poi.name,
      address: poi.address,
      isActive: poi.isActive,
      notes: poi.note,
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
      source: ["custom"],
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
    throw badRequest("At least one POI is required");
  }

  return {
    isActive,
    items,
  };
}

export function serveUploadFile(config: AppConfig, pathname: string): Response {
  const storageKey = pathname.replace(/^\/uploads\/+/, "");
  const filePath = resolveWithinDirectory(config.uploadDirectory, storageKey);
  if (!filePath || !existsSync(filePath)) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(Bun.file(filePath));
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
    const candidates = await ensurePoisForCategory(app.database, app.config, category, origin);

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
    throw notFound("Apartment not found");
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
  if (!app.config.jawgApiKey) {
    return {
      available: false,
      unavailableReason: "Map API configuration is missing.",
      styleUrl: null,
    };
  }

  return {
    available: true,
    styleUrl: `/api/map/style.json?style=${encodeURIComponent(app.config.jawgStyleId)}`,
    attribution:
      '&copy; <a href="https://www.jawg.io" target="_blank" rel="noopener noreferrer">Jawg</a> &copy; OpenStreetMap contributors',
    center: MUNICH_CITY_CENTER,
    bounds: MUNICH_GREATER_AREA_BOUNDS,
    minZoom: 8,
    maxZoom: 22,
  };
}

function requireJawgApiKey(app: AppState) {
  if (!app.config.jawgApiKey) {
    throw new Error("Map API configuration is missing.");
  }

  return app.config.jawgApiKey;
}

function isAllowedJawgUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && JAWG_ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function sanitizeJawgUrl(value: string) {
  const url = new URL(value);
  url.searchParams.delete("access-token");
  return url
    .toString()
    .replaceAll("%7B", "{")
    .replaceAll("%7D", "}");
}

function registerMapAsset(kind: MapAssetKind, url: string) {
  const sanitizedUrl = sanitizeJawgUrl(url);
  const assetId = createHash("sha1").update(`${kind}:${sanitizedUrl}`).digest("hex");
  mapAssetManifest.set(assetId, {
    kind,
    url: sanitizedUrl,
  });
  return assetId;
}

function withJawgToken(urlString: string, apiKey: string) {
  const url = new URL(urlString);
  url.searchParams.set("access-token", apiKey);
  return url.toString();
}

function forwardMapHeaders(upstreamHeaders: Headers) {
  const headers = new Headers();
  for (const key of ["content-type", "cache-control", "etag", "last-modified"]) {
    const value = upstreamHeaders.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  return headers;
}

function forwardJsonHeaders(upstreamHeaders: Headers) {
  const headers = new Headers();
  for (const key of ["cache-control", "etag", "last-modified"]) {
    const value = upstreamHeaders.get(key);
    if (value) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function fetchMapBinary(app: AppState, url: string, inflightKey: string) {
  let inflight = mapResourceInflight.get(inflightKey);
  if (!inflight) {
    inflight = (async (): Promise<MapProxyResponse> => {
      const upstreamUrl = withJawgToken(url, requireJawgApiKey(app));
      const upstream = await fetch(upstreamUrl);
      if (!upstream.ok) {
        const status = upstream.status === 404 ? 404 : 502;
        return {
          body: new TextEncoder().encode("Map resource unavailable").buffer,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
          },
          status,
        };
      }

      return {
        body: await upstream.arrayBuffer(),
        headers: forwardMapHeaders(upstream.headers),
        status: upstream.status,
      };
    })();
    mapResourceInflight.set(inflightKey, inflight);
  }

  try {
    const payload = await inflight;
    return new Response(payload.body.slice(0), {
      status: payload.status,
      headers: payload.headers,
    });
  } finally {
    mapResourceInflight.delete(inflightKey);
  }
}

function rewriteTileTemplate(template: string, origin: string) {
  const assetId = registerMapAsset("tile", template);
  return `${origin}/api/map/tiles/${assetId}/{z}/{x}/{y}.pbf`;
}

function rewriteSourceUrl(url: string, origin: string) {
  const assetId = registerMapAsset("source", url);
  return `${origin}/api/map/sources/${assetId}.json`;
}

function rewriteGlyphTemplate(template: string, origin: string) {
  const assetId = registerMapAsset("glyph", template);
  return `${origin}/api/map/glyphs/${assetId}/{fontstack}/{range}.pbf`;
}

function rewriteSpriteBase(url: string, origin: string) {
  const assetId = registerMapAsset("sprite", url);
  return `${origin}/api/map/sprites/${assetId}`;
}

async function resolveJawgSource(source: Record<string, unknown>, app: AppState, origin: string) {
  if (Array.isArray(source.tiles)) {
    source.tiles = source.tiles.map((value) =>
      typeof value === "string" && isAllowedJawgUrl(value)
        ? rewriteTileTemplate(value, origin)
        : value,
    );
    return source;
  }

  if (typeof source.url !== "string" || !isAllowedJawgUrl(source.url)) {
    return source;
  }

  const upstream = await fetch(withJawgToken(source.url, requireJawgApiKey(app)));
  if (!upstream.ok) {
    throw new Error(`Map source request failed: ${upstream.status}`);
  }

  const payload = (await upstream.json()) as Record<string, unknown>;
  source.tiles = Array.isArray(payload.tiles)
    ? payload.tiles.map((value) =>
        typeof value === "string" && isAllowedJawgUrl(value)
          ? rewriteTileTemplate(value, origin)
          : value,
      )
    : source.tiles;

  for (const key of ["minzoom", "maxzoom", "bounds", "attribution", "scheme", "tileSize"]) {
    if (payload[key] !== undefined && source[key] === undefined) {
      source[key] = payload[key];
    }
  }

  delete source.url;
  return source;
}

async function rewriteStylePayload(style: Record<string, unknown>, app: AppState, origin: string) {
  if (style.sources && typeof style.sources === "object") {
    const entries = Object.entries(style.sources as Record<string, Record<string, unknown>>);
    const resolved = await Promise.all(
      entries.map(async ([sourceId, source]) => [
        sourceId,
        await resolveJawgSource(source, app, origin),
      ]),
    );
    style.sources = Object.fromEntries(resolved);
  }

  if (typeof style.glyphs === "string" && isAllowedJawgUrl(style.glyphs)) {
    style.glyphs = rewriteGlyphTemplate(style.glyphs, origin);
  }

  if (typeof style.sprite === "string" && isAllowedJawgUrl(style.sprite)) {
    style.sprite = rewriteSpriteBase(style.sprite, origin);
  }

  if (Array.isArray(style.sprite)) {
    style.sprite = style.sprite.map((value) =>
      typeof value === "string" && isAllowedJawgUrl(value)
        ? rewriteSpriteBase(value, origin)
        : value,
    );
  }

  if (style.metadata && typeof style.metadata === "object") {
    for (const [key, value] of Object.entries(style.metadata as Record<string, unknown>)) {
      if (typeof value === "string" && isAllowedJawgUrl(value)) {
        (style.metadata as Record<string, unknown>)[key] = rewriteSourceUrl(value, origin);
      }
    }
  }

  return style;
}

export async function serveMapStyle(app: AppState, requestUrl: string) {
  if (!app.config.jawgApiKey) {
    return new Response("Map API configuration is missing.", { status: 503 });
  }

  const upstreamUrl = `https://api.jawg.io/styles/${encodeURIComponent(
    app.config.jawgStyleId,
  )}.json`;
  const upstream = await fetch(withJawgToken(upstreamUrl, app.config.jawgApiKey));
  if (!upstream.ok) {
    return new Response("Map style unavailable", { status: 502 });
  }

  const payload = (await upstream.json()) as Record<string, unknown>;
  const rewritten = await rewriteStylePayload(payload, app, new URL(requestUrl).origin);

  return Response.json(rewritten, {
    headers: forwardJsonHeaders(upstream.headers),
  });
}

export async function serveMapTile(
  app: AppState,
  assetId: string,
  z: string,
  x: string,
  y: string,
) {
  const entry = mapAssetManifest.get(assetId);
  if (!entry || entry.kind !== "tile") {
    return new Response("Map resource not found", { status: 404 });
  }

  const upstreamUrl = entry.url
    .replace("{z}", z)
    .replace("{x}", x)
    .replace("{y}", y);

  return fetchMapBinary(app, upstreamUrl, `tile:${assetId}:${z}:${x}:${y}`);
}

export async function serveMapGlyph(
  app: AppState,
  assetId: string,
  fontstack: string,
  range: string,
) {
  const entry = mapAssetManifest.get(assetId);
  if (!entry || entry.kind !== "glyph") {
    return new Response("Map resource not found", { status: 404 });
  }

  const upstreamUrl = entry.url
    .replace("{fontstack}", encodeURIComponent(fontstack))
    .replace("{range}", range);

  return fetchMapBinary(app, upstreamUrl, `glyph:${assetId}:${fontstack}:${range}`);
}

export async function serveMapSprite(
  app: AppState,
  assetId: string,
  suffix: ".json" | ".png" | "@2x.json" | "@2x.png",
) {
  const entry = mapAssetManifest.get(assetId);
  if (!entry || entry.kind !== "sprite") {
    return new Response("Map resource not found", { status: 404 });
  }

  return fetchMapBinary(app, `${entry.url}${suffix}`, `sprite:${assetId}:${suffix}`);
}

export async function serveMapSource(app: AppState, assetId: string) {
  const entry = mapAssetManifest.get(assetId);
  if (!entry || entry.kind !== "source") {
    return new Response("Map resource not found", { status: 404 });
  }

  return fetchMapBinary(app, entry.url, `source:${assetId}`);
}

export async function initApp(): Promise<AppState> {
  const config = loadConfig();
  const database = createDatabase(config);
  await seedSportStudios(database);
  mkdirSync(join(config.uploadDirectory, "icons"), { recursive: true });
  seedSportStudioIcons(database, join(config.uploadDirectory, "icons"));

  return {
    config,
    database,
    serveUpload(pathname: string) {
      return serveUploadFile(config, pathname);
    },
  };
}

export function getBootstrapPayload(app: AppState): BootstrapPayload {
  return {
    apartments: listApartments(app.database),
    customPois: listCustomPois(app.database),
    settings: getWeightSettings(app.database),
    mapConfig: buildMapConfig(app),
    poiCategoryLabels: listPoiCategoryLabels(app.database),
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

export function getPoiCategoryManagementPayload(app: AppState): PoiCategoryManagementPayload {
  const labelMap = buildCategoryLabelMap(app);
  const iconMap = new Map(
    listPoiIcons(app.database).map((icon) => [`${icon.category}:${icon.subcategory}`, icon.iconPath]),
  );
  const counts = app.database
    .query(
      `
      SELECT category, subcategory, COUNT(*) AS item_count, SUM(is_active) AS active_item_count
      FROM pois
      GROUP BY category, subcategory
    `,
    )
    .all() as Array<{
    category: string;
    subcategory: string;
    item_count: number;
    active_item_count: number | null;
  }>;
  const countMap = new Map(
    counts.map((row) => [
      `${row.category}:${row.subcategory}`,
      {
        itemCount: Number(row.item_count),
        activeItemCount: Number(row.active_item_count ?? 0),
      },
    ]),
  );

  return {
    categories: STANDARD_CATEGORIES.map((category) => {
      const topLevelCounts = counts
        .filter((row) => row.category === category)
        .reduce(
          (totals, row) => ({
            itemCount: totals.itemCount + Number(row.item_count),
            activeItemCount: totals.activeItemCount + Number(row.active_item_count ?? 0),
          }),
          { itemCount: 0, activeItemCount: 0 },
        );
      const subcategories = counts
        .filter((row) => row.category === category && row.subcategory)
        .map((row) => ({
          category,
          subcategory: row.subcategory,
          label: resolveCategoryLabel(labelMap, category, row.subcategory),
          itemCount: Number(row.item_count),
          activeItemCount: Number(row.active_item_count ?? 0),
          iconPath: iconMap.get(`${category}:${row.subcategory}`) ?? null,
        }));

      if (category === "sport_studio") {
        const sportTagCounts = app.database
          .query(
            `
            SELECT json_each.value AS tag, COUNT(*) AS item_count, SUM(is_active) AS active_item_count
            FROM pois, json_each(tags_json)
            WHERE category = 'sport_studio' AND json_each.value != ''
            GROUP BY json_each.value
          `,
          )
          .all() as Array<{
          tag: string;
          item_count: number;
          active_item_count: number | null;
        }>;
        for (const row of sportTagCounts) {
          subcategories.push({
            category,
            subcategory: row.tag,
            label: resolveCategoryLabel(labelMap, category, row.tag),
            itemCount: Number(row.item_count),
            activeItemCount: Number(row.active_item_count ?? 0),
            iconPath: iconMap.get(`${category}:${row.tag}`) ?? null,
          });
        }
      }

      subcategories.sort((left, right) => left.subcategory.localeCompare(right.subcategory));

      return {
        category,
        label: resolveCategoryLabel(labelMap, category),
        itemCount: topLevelCounts.itemCount,
        activeItemCount: topLevelCounts.activeItemCount,
        iconPath: iconMap.get(`${category}:`) ?? null,
        subcategories,
      };
    }),
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
    const filePath = resolveWithinDirectory(app.config.uploadDirectory, photo.storageKey);
    if (filePath && existsSync(filePath)) {
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
  const filePath = resolveWithinDirectory(app.config.uploadDirectory, storageKey);
  if (filePath && existsSync(filePath)) {
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

export function getPoiIcons(app: AppState): PoiIconMapping {
  return { icons: listPoiIcons(app.database) };
}

export function updatePoiCategoryLabel(
  app: AppState,
  payload: unknown,
): PoiCategoryLabelRecord {
  const value = payload as Record<string, unknown>;
  const category = String(value.category ?? "").trim();
  const subcategory = String(value.subcategory ?? "").trim();
  const label = String(value.label ?? "").trim();

  if (!category || !label) {
    throw badRequest("Category and label are required");
  }

  upsertPoiCategoryLabel(app.database, category, subcategory, label);
  return { category, subcategory, label };
}

export async function uploadPoiIcon(
  app: AppState,
  category: string,
  subcategory: string,
  file: File,
) {
  if (file.size === 0) {
    throw badRequest("Icon file cannot be empty");
  }
  if (file.size > MAX_POI_ICON_BYTES) {
    throw badRequest("Icon file is too large");
  }

  const mimeType = file.type.toLowerCase();
  if (mimeType && !ALLOWED_POI_ICON_MIME_TYPES.has(mimeType)) {
    throw badRequest("Icon file must be a PNG, JPEG, WebP, or SVG image");
  }

  const buffer = await file.arrayBuffer();
  const iconStem = sanitizePathSegment(
    `${category}${subcategory ? "-" + subcategory : ""}`,
    "icon",
  );
  const safeName = sanitizePathSegment(file.name || "icon.png", "icon.png");
  const extensionFromName = safeName.includes(".")
    ? safeName.split(".").pop()?.toLowerCase() ?? ""
    : "";
  const extensionFromFileName = ALLOWED_POI_ICON_EXTENSIONS.has(extensionFromName)
    ? extensionFromName
    : "";
  const extensionFromMime =
    mimeType === "image/svg+xml"
      ? "svg"
      : mimeType === "image/jpeg"
        ? "jpg"
        : mimeType === "image/webp"
          ? "webp"
          : mimeType === "image/png"
            ? "png"
            : "";
  const extension = extensionFromFileName || extensionFromMime || "png";
  const filename = `${iconStem}.${extension}`;
  const iconDir = join(app.config.uploadDirectory, "icons");
  const targetPath = join(iconDir, filename);

  await Bun.write(targetPath, buffer);
  upsertPoiIcon(app.database, category, subcategory, `/uploads/icons/${filename}`);
  return getPoiIcons(app);
}

export function deletePoiIconHandler(
  app: AppState,
  category: string,
  subcategory: string,
) {
  const existing = listPoiIcons(app.database).find(
    (icon) => icon.category === category && icon.subcategory === subcategory,
  );
  if (existing) {
    const filename = existing.iconPath.split("/").pop()!;
    const filePath = resolveWithinDirectory(join(app.config.uploadDirectory, "icons"), filename);
    if (filePath && existsSync(filePath)) {
      rmSync(filePath);
    }
    deletePoiIcon(app.database, category, subcategory);
  }
  return getPoiIcons(app);
}

export async function getApartmentMapData(
  app: AppState,
  apartmentId: number,
): Promise<MapPayload> {
  const apartment = getApartmentById(app.database, apartmentId);
  if (!apartment) {
    throw notFound("Apartment not found");
  }

  const scoring = apartment.scoring;
  const nearbyPois = listActivePois(app.database);
  const sportStudioTags = Array.from(
    new Set(
      nearbyPois
        .filter((poi) => poi.category === "sport_studio")
        .flatMap((poi) => poi.tags),
    ),
  ).sort((left, right) => left.localeCompare(right));
  const transitOverlay =
    apartment.latitude !== null && apartment.longitude !== null
      ? await fetchTransitMapOverlay(app.config)
      : { ubahnStations: [], ubahnRoutes: [] };

  return {
    apartment,
    standardPoiScores: scoring.standardPoiScores,
    customPoiScores: scoring.customPoiScores,
    nearbyPois,
    sportStudioTags,
    ubahnStations: transitOverlay.ubahnStations,
    ubahnRoutes: transitOverlay.ubahnRoutes,
  };
}
