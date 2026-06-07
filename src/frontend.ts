import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature, type Popup } from "maplibre-gl";
import type {
  Apartment,
  BootstrapPayload,
  CustomPoi,
  ManagedPoi,
  MapConfig,
  PoiRecord,
  MapPayload,
  PoiManagementPayload,
  PoiCategory,
  StandardPoiCategory,
  WeightSettings,
} from "./types";
import {
  filterIndexedManagedPois,
  indexManagedPois,
  managedPoiKey,
  summarizePoiCategories,
  summarizeSportTags,
  type IndexedManagedPoi,
  type PoiStatusFilter,
} from "./poiFilters";

type EditorMode = "create" | "edit";
type PanelView = "apartment" | "custom-poi" | "settings";
type SortMode = "score" | "warmmiete" | "pricePerSqm" | "rooms" | "newest";
type MainView = "list" | "map" | "pois";

type AppState = BootstrapPayload & {
  activeView: MainView;
  selectedApartmentId: number | null;
  panelView: PanelView;
  apartmentEditorMode: EditorMode;
  editingApartmentId: number | null;
  editingCustomPoiId: number | null;
  sortMode: SortMode;
  mapPayload: MapPayload | null;
  visiblePoiCategories: Record<StandardPoiCategory, boolean>;
  showPoiList: boolean;
  selectedSportTags: string[];
  showTransitStops: boolean;
  showUbahnRoutes: boolean;
  pois: ManagedPoi[];
  indexedPois: IndexedManagedPoi[];
  poisLoaded: boolean;
  poiSearch: string;
  poiStatusFilter: PoiStatusFilter;
  visibleManagedPoiCategories: Record<PoiCategory, boolean>;
  selectedManagedSportTags: string[];
  selectedManagedPoiKeys: string[];
};

const rootElement = document.querySelector("#app");
if (!rootElement) {
  throw new Error("App root not found");
}
const root = rootElement as HTMLDivElement;

const initialView: MainView =
  window.location.pathname === "/map"
    ? "map"
    : window.location.pathname === "/pois"
      ? "pois"
      : "list";

const state: AppState = {
  apartments: [],
  customPois: [],
  settings: {
    pricePerSqm: 1.3,
    rooms: 0.9,
    supermarket: 1,
    sportStudio: 1,
    ubahn: 1.2,
    cafe: 0.7,
    parkOrRiver: 0.8,
    customPoi: 1.1,
  },
  mapConfig: {
    available: false,
    unavailableReason: "Map API configuration is missing.",
    styleUrl: null,
  },
  activeView: initialView,
  selectedApartmentId: null,
  panelView: "apartment",
  apartmentEditorMode: "create",
  editingApartmentId: null,
  editingCustomPoiId: null,
  sortMode: "score",
  mapPayload: null,
  visiblePoiCategories: {
    supermarket: true,
    sport_studio: true,
    ubahn: true,
    cafe: true,
    park_or_river: true,
  },
  showPoiList: true,
  selectedSportTags: [],
  showTransitStops: true,
  showUbahnRoutes: true,
  pois: [],
  indexedPois: [],
  poisLoaded: false,
  poiSearch: "",
  poiStatusFilter: "all",
  visibleManagedPoiCategories: {
    supermarket: true,
    sport_studio: true,
    ubahn: true,
    cafe: true,
    park_or_river: true,
    custom: true,
  },
  selectedManagedSportTags: [],
  selectedManagedPoiKeys: [],
};

type LngLatTuple = [number, number];
type MapFeatureProperties = Record<string, string | number | boolean | null>;
type FeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry:
      | { type: "Point"; coordinates: LngLatTuple }
      | { type: "LineString"; coordinates: LngLatTuple[] };
    properties: MapFeatureProperties;
  }>;
};

let map: maplibregl.Map | null = null;
let popup: Popup | null = null;
let mapReady = false;

const EMPTY_FEATURE_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const APARTMENT_SOURCE_ID = "apartment";
const POI_SOURCE_ID = "nearby-pois";
const CUSTOM_POI_SOURCE_ID = "custom-pois";
const TRANSIT_SOURCE_ID = "transit-stops";
const UBAHN_SOURCE_ID = "ubahn-routes";

const APARTMENT_LAYER_ID = "apartment-layer";
const POI_LAYER_ID = "poi-layer";
const CUSTOM_POI_LAYER_ID = "custom-poi-layer";
const TRANSIT_LAYER_ID = "transit-layer";
const UBAHN_LAYER_ID = "ubahn-layer";

const POI_LABELS: Record<StandardPoiCategory, string> = {
  supermarket: "Supermarkets",
  sport_studio: "Sport studios",
  ubahn: "U-Bahn",
  cafe: "Cafes",
  park_or_river: "Parks / river",
};

const MANAGED_POI_CATEGORY_ORDER: PoiCategory[] = [
  "sport_studio",
  "supermarket",
  "custom",
  "ubahn",
  "cafe",
  "park_or_river",
];

const MANAGED_POI_LABELS: Record<PoiCategory, string> = {
  supermarket: "Supermarkets",
  sport_studio: "Sport studios",
  ubahn: "U-Bahn",
  cafe: "Cafes",
  park_or_river: "Parks / river",
  custom: "Custom POIs",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatScore(value: number) {
  return `${value.toFixed(1)}/10`;
}

function scoreTone(value: number) {
  if (value >= 8) return "high";
  if (value >= 5) return "medium";
  return "low";
}

function currentApartment() {
  return state.apartments.find((apartment) => apartment.id === state.selectedApartmentId) ?? null;
}

let poiSearchUpdateTimer: number | null = null;

function currentPoiFilters() {
  return {
    search: state.poiSearch,
    status: state.poiStatusFilter,
    visibleCategories: state.visibleManagedPoiCategories,
    selectedSportTags: state.selectedManagedSportTags,
  };
}

function filteredManagedPoiEntries() {
  return filterIndexedManagedPois(state.indexedPois, currentPoiFilters());
}

function filteredManagedPois() {
  return filteredManagedPoiEntries().map(({ poi }) => poi);
}

function selectedManagedPois() {
  const keys = new Set(state.selectedManagedPoiKeys);
  return filteredManagedPoiEntries()
    .filter((entry) => keys.has(entry.key))
    .map(({ poi }) => poi);
}

function visibleManagedPoiSelectionState() {
  const visibleKeys = filteredManagedPoiEntries().map(({ key }) => key);
  const selectedKeys = new Set(state.selectedManagedPoiKeys);
  const selectedCount = visibleKeys.filter((key) => selectedKeys.has(key)).length;

  return {
    total: visibleKeys.length,
    selected: selectedCount,
    allSelected: visibleKeys.length > 0 && selectedCount === visibleKeys.length,
  };
}

function visibleNearbyPois() {
  const payload = state.mapPayload;
  if (!payload) {
    return [] as PoiRecord[];
  }

  return payload.nearbyPois.filter((poi) => {
    if (!state.visiblePoiCategories[poi.category]) {
      return false;
    }

    if (poi.category === "sport_studio" && state.selectedSportTags.length > 0) {
      return poi.tags.some((tag) => state.selectedSportTags.includes(tag));
    }

    return true;
  });
}

function groupedVisiblePois() {
  const grouped = new Map<StandardPoiCategory, PoiRecord[]>();
  for (const poi of visibleNearbyPois()) {
    const bucket = grouped.get(poi.category) ?? [];
    bucket.push(poi);
    grouped.set(poi.category, bucket);
  }
  return grouped;
}

function destroyMap() {
  if (map) {
    popup?.remove();
    popup = null;
    map.remove();
    map = null;
    mapReady = false;
  }
}

function mapIsAvailable(config: MapConfig): config is Extract<MapConfig, { available: true }> {
  return config.available;
}

function emptyFeatureCollection(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

function popupHtml(title: string, lines: string[]) {
  return [`<strong>${escapeHtml(title)}</strong>`, ...lines.map((line) => escapeHtml(line))]
    .join("<br />");
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

function apartmentFeatureCollection() {
  const apartment = state.mapPayload?.apartment;
  if (!apartment || apartment.latitude === null || apartment.longitude === null) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: `apartment:${apartment.id}`,
        geometry: {
          type: "Point",
          coordinates: [apartment.longitude, apartment.latitude],
        },
        properties: {
          popupHtml: popupHtml(apartment.address, []),
        },
      },
    ],
  } satisfies FeatureCollection;
}

function nearbyPoiFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: visibleNearbyPois().map((poi) => ({
      type: "Feature" as const,
      id: `poi:${poi.id}`,
      geometry: {
        type: "Point" as const,
        coordinates: [poi.longitude, poi.latitude] as LngLatTuple,
      },
      properties: {
        category: poi.category,
        popupHtml: popupHtml(poi.name, [
          POI_LABELS[poi.category],
          poi.address || "Address unavailable",
          poi.tags.length ? poi.tags.join(", ") : "",
        ].filter(Boolean)),
      },
    })),
  } satisfies FeatureCollection;
}

function transitStopFeatureCollection() {
  if (!state.showTransitStops || !state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: state.mapPayload.transitStops.map((stop) => ({
      type: "Feature" as const,
      id: `stop:${stop.id}`,
      geometry: {
        type: "Point" as const,
        coordinates: [stop.longitude, stop.latitude] as LngLatTuple,
      },
      properties: {
        popupHtml: popupHtml(stop.name, [stop.modes.join(", ")]),
      },
    })),
  } satisfies FeatureCollection;
}

function customPoiFeatureCollection() {
  if (!state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: state.mapPayload.customPoiScores.map((score) => ({
      type: "Feature" as const,
      id: `custom:${score.customPoiId}`,
      geometry: {
        type: "Point" as const,
        coordinates: [score.longitude, score.latitude] as LngLatTuple,
      },
      properties: {
        popupHtml: popupHtml(score.name, [
          `Walk ${score.walking.durationMinutes ?? "n/a"} min`,
          `Transit ${score.transit.durationMinutes ?? "n/a"} min`,
        ]),
      },
    })),
  } satisfies FeatureCollection;
}

function ubahnRouteFeatureCollection() {
  if (!state.showUbahnRoutes || !state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: state.mapPayload.ubahnRoutes.flatMap((route) =>
      route.paths
        .filter((path) => path.length >= 2)
        .map((path, index) => ({
          type: "Feature" as const,
          id: `ubahn:${route.id}:${index}`,
          geometry: {
            type: "LineString" as const,
            coordinates: path.map((point) => [point.longitude, point.latitude] as LngLatTuple),
          },
          properties: {
            color: normalizeMapColor(route.color) || "#0056b8",
            popupHtml: popupHtml(route.ref || route.name, [route.name]),
          },
        })),
    ),
  } satisfies FeatureCollection;
}

function setSourceData(sourceId: string, data: FeatureCollection) {
  const source = map?.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

function applyLayerVisibility(layerId: string, visible: boolean) {
  if (!map?.getLayer(layerId)) {
    return;
  }

  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function resizeMapSoon() {
  window.setTimeout(() => map?.resize(), 0);
}

function fitMapToPayload() {
  const coordinates: LngLatTuple[] = [];
  const apartment = state.mapPayload?.apartment;
  if (
    apartment &&
    apartment.latitude !== null &&
    apartment.longitude !== null
  ) {
    coordinates.push([apartment.longitude, apartment.latitude]);
  }

  for (const poi of visibleNearbyPois()) {
    coordinates.push([poi.longitude, poi.latitude]);
  }

  if (state.showTransitStops) {
    for (const stop of state.mapPayload?.transitStops ?? []) {
      coordinates.push([stop.longitude, stop.latitude]);
    }
  }

  for (const score of state.mapPayload?.customPoiScores ?? []) {
    coordinates.push([score.longitude, score.latitude]);
  }

  if (state.showUbahnRoutes) {
    for (const route of state.mapPayload?.ubahnRoutes ?? []) {
      for (const path of route.paths) {
        for (const point of path) {
          coordinates.push([point.longitude, point.latitude]);
        }
      }
    }
  }

  if (coordinates.length === 0) {
    if (mapIsAvailable(state.mapConfig)) {
      map?.jumpTo({
        center: state.mapConfig.center,
        zoom: 11,
      });
    }
    return;
  }

  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  map?.fitBounds(bounds, {
    padding: 56,
    maxZoom: 15,
    duration: 0,
  });
}

function syncMapSources(options?: { preserveViewport?: boolean }) {
  if (!mapReady) {
    return;
  }

  setSourceData(APARTMENT_SOURCE_ID, apartmentFeatureCollection());
  setSourceData(POI_SOURCE_ID, nearbyPoiFeatureCollection());
  setSourceData(CUSTOM_POI_SOURCE_ID, customPoiFeatureCollection());
  setSourceData(TRANSIT_SOURCE_ID, transitStopFeatureCollection());
  setSourceData(UBAHN_SOURCE_ID, ubahnRouteFeatureCollection());

  applyLayerVisibility(TRANSIT_LAYER_ID, state.showTransitStops);
  applyLayerVisibility(UBAHN_LAYER_ID, state.showUbahnRoutes);

  if (!options?.preserveViewport) {
    fitMapToPayload();
  }

  resizeMapSoon();
}

function showMapPopup(feature: MapGeoJSONFeature) {
  const coordinates = feature.geometry.type === "Point"
    ? [...feature.geometry.coordinates]
    : feature.geometry.coordinates[0]
      ? [...feature.geometry.coordinates[0]]
      : null;

  if (!coordinates) {
    return;
  }

  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 12 })
    .setLngLat(coordinates as [number, number])
    .setHTML(String(feature.properties?.popupHtml ?? ""))
    .addTo(map!);
}

function bindMapInteractions() {
  if (!map) {
    return;
  }

  for (const layerId of [
    APARTMENT_LAYER_ID,
    POI_LAYER_ID,
    CUSTOM_POI_LAYER_ID,
    TRANSIT_LAYER_ID,
    UBAHN_LAYER_ID,
  ]) {
    map.on("click", layerId, (event) => {
      const feature = event.features?.[0];
      if (feature) {
        showMapPopup(feature);
      }
    });
    map.on("mouseenter", layerId, () => {
      map?.getCanvas().style.setProperty("cursor", "pointer");
    });
    map.on("mouseleave", layerId, () => {
      map?.getCanvas().style.removeProperty("cursor");
    });
  }
}

function addMapSourcesAndLayers() {
  if (!map || mapReady) {
    return;
  }

  map.addSource(APARTMENT_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(POI_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(CUSTOM_POI_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(TRANSIT_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(UBAHN_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });

  map.addLayer({
    id: UBAHN_LAYER_ID,
    type: "line",
    source: UBAHN_SOURCE_ID,
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#0056b8"],
      "line-width": 4,
      "line-opacity": 0.65,
    },
  });
  map.addLayer({
    id: POI_LAYER_ID,
    type: "circle",
    source: POI_SOURCE_ID,
    paint: {
      "circle-radius": [
        "case",
        ["==", ["get", "category"], "sport_studio"],
        7,
        6,
      ],
      "circle-color": [
        "case",
        ["==", ["get", "category"], "sport_studio"],
        "#7ad3b0",
        "#b7d5ea",
      ],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "category"], "sport_studio"],
        "#0f6b57",
        "#275d8a",
      ],
      "circle-stroke-width": 2,
      "circle-opacity": 0.92,
    },
  });
  map.addLayer({
    id: TRANSIT_LAYER_ID,
    type: "circle",
    source: TRANSIT_SOURCE_ID,
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffe55c",
      "circle-stroke-color": "#101820",
      "circle-stroke-width": 2,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: CUSTOM_POI_LAYER_ID,
    type: "circle",
    source: CUSTOM_POI_SOURCE_ID,
    paint: {
      "circle-radius": 8,
      "circle-color": "#7dc4de",
      "circle-stroke-color": "#25556e",
      "circle-stroke-width": 2,
      "circle-opacity": 0.9,
    },
  });
  map.addLayer({
    id: APARTMENT_LAYER_ID,
    type: "circle",
    source: APARTMENT_SOURCE_ID,
    paint: {
      "circle-radius": 9,
      "circle-color": "#f06b4f",
      "circle-stroke-color": "#18201f",
      "circle-stroke-width": 3,
    },
  });

  bindMapInteractions();
  mapReady = true;
}

function sortedApartments() {
  const apartments = [...state.apartments];
  apartments.sort((left, right) => {
    switch (state.sortMode) {
      case "warmmiete":
        return left.warmmiete - right.warmmiete;
      case "pricePerSqm":
        return (
          (left.scoring.pricePerSqmValue ?? Number.POSITIVE_INFINITY) -
          (right.scoring.pricePerSqmValue ?? Number.POSITIVE_INFINITY)
        );
      case "rooms":
        return right.roomCount - left.roomCount;
      case "newest":
        return right.createdAt.localeCompare(left.createdAt);
      case "score":
      default:
        return right.totalScore - left.totalScore;
    }
  });
  return apartments;
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function loadBootstrap() {
  const payload = await requestJson<BootstrapPayload>("/api/bootstrap");
  state.apartments = payload.apartments;
  state.customPois = payload.customPois;
  state.settings = payload.settings;
  state.mapConfig = payload.mapConfig;
  state.selectedApartmentId = payload.apartments[0]?.id ?? null;
  render();
  if (state.activeView === "map" && state.selectedApartmentId && mapIsAvailable(state.mapConfig)) {
    await loadMapPayload(state.selectedApartmentId);
  }
}

async function loadPoiManagement(force = false) {
  if (state.poisLoaded && !force) {
    return;
  }

  const payload = await requestJson<PoiManagementPayload>("/api/pois");
  state.pois = payload.pois;
  state.indexedPois = indexManagedPois(payload.pois);
  state.poisLoaded = true;
  state.selectedManagedPoiKeys = state.selectedManagedPoiKeys.filter((key) =>
    payload.pois.some((poi) => managedPoiKey(poi) === key),
  );
}

async function refreshAppData(options?: { refreshMap?: boolean; refreshPois?: boolean }) {
  const bootstrap = await requestJson<BootstrapPayload>("/api/bootstrap");
  state.apartments = bootstrap.apartments;
  state.customPois = bootstrap.customPois;
  state.settings = bootstrap.settings;
  state.mapConfig = bootstrap.mapConfig;
  state.selectedApartmentId =
    state.selectedApartmentId && bootstrap.apartments.some((item) => item.id === state.selectedApartmentId)
      ? state.selectedApartmentId
      : bootstrap.apartments[0]?.id ?? null;

  if (options?.refreshPois) {
    await loadPoiManagement(true);
  }

  if (options?.refreshMap && state.activeView === "map" && state.selectedApartmentId) {
    if (!mapIsAvailable(state.mapConfig)) {
      state.mapPayload = null;
      render();
      return;
    }
    await loadMapPayload(state.selectedApartmentId);
    return;
  }

  render();
}

async function loadMapPayload(apartmentId: number) {
  if (!mapIsAvailable(state.mapConfig)) {
    state.mapPayload = null;
    state.selectedApartmentId = apartmentId;
    render();
    return;
  }

  state.mapPayload = await requestJson<MapPayload>(`/api/apartments/${apartmentId}/map`);
  state.selectedApartmentId = apartmentId;
  if (state.activeView === "map" && document.querySelector(".map-sidebar")) {
    updateMapSidebar();
    queueMicrotask(() => renderMap());
    return;
  }

  render();
  queueMicrotask(() => renderMap());
}

function apartmentFormDefaults() {
  const apartment =
    state.editingApartmentId === null
      ? null
      : state.apartments.find((item) => item.id === state.editingApartmentId) ?? null;

  return {
    address: apartment?.address ?? "",
    squareMeters: apartment?.squareMeters ?? 65,
    kaltmiete: apartment?.kaltmiete ?? 1200,
    warmmiete: apartment?.warmmiete ?? 1450,
    floorLevel: apartment?.floorLevel ?? "",
    roomCount: apartment?.roomCount ?? 2.5,
    description: apartment?.description ?? "",
  };
}

function customPoiDefaults() {
  const poi =
    state.editingCustomPoiId === null
      ? null
      : state.customPois.find((item) => item.id === state.editingCustomPoiId) ?? null;

  return {
    name: poi?.name ?? "",
    address: poi?.address ?? "",
    notes: poi?.notes ?? "",
    isActive: poi?.isActive ?? true,
  };
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark">R</span>
        <div>
          <p class="eyebrow">Munich rental board</p>
          <h1>Rokum</h1>
        </div>
      </div>
      <nav class="tabs">
        <button class="tab ${state.activeView === "list" ? "is-active" : ""}" data-action="switch-view" data-view="list">List</button>
        <button class="tab ${state.activeView === "map" ? "is-active" : ""}" data-action="switch-view" data-view="map">Map</button>
        <button class="tab ${state.activeView === "pois" ? "is-active" : ""}" data-action="switch-view" data-view="pois">POIs</button>
      </nav>
    </header>
  `;
}

function renderScorePills(apartment: Apartment) {
  const breakdown = apartment.scoring;
  const standardPills = breakdown.standardPoiScores
    .map(
      (score) => `
        <div class="score-pill tone-${scoreTone(score.score)}">
          <span>${escapeHtml(score.label)}</span>
          <strong>${formatScore(score.score)}</strong>
        </div>
      `,
    )
    .join("");

  const customPills = breakdown.customPoiScores
    .map(
      (score) => `
        <div class="score-pill tone-${scoreTone(score.score)}">
          <span>${escapeHtml(score.name)}</span>
          <strong>${formatScore(score.score)}</strong>
        </div>
      `,
    )
    .join("");

  return standardPills + customPills;
}

function renderApartmentCard(apartment: Apartment) {
  const hero = apartment.photos[0]?.url;
  const pricePerSqm = apartment.scoring.pricePerSqmValue;

  return `
    <article class="apartment-card">
      <div class="card-media ${hero ? "" : "is-empty"}">
        ${
          hero
            ? `<img src="${hero}" alt="Apartment photo for ${escapeHtml(apartment.address)}" />`
            : `<div class="media-fallback">No photos yet</div>`
        }
      </div>
      <div class="card-body">
        <div class="card-head">
          <div>
            <p class="card-address">${escapeHtml(apartment.address)}</p>
            <p class="card-meta">
              ${apartment.squareMeters} m² · ${apartment.roomCount} rooms · Floor ${escapeHtml(
                apartment.floorLevel || "n/a",
              )}
            </p>
          </div>
          <div class="total-score">
            <span>Total</span>
            <strong>${formatScore(apartment.totalScore)}</strong>
          </div>
        </div>
        <div class="price-grid">
          <div><span>Warm rent</span><strong>${formatCurrency(apartment.warmmiete)}</strong></div>
          <div><span>Cold rent</span><strong>${formatCurrency(apartment.kaltmiete)}</strong></div>
          <div><span>€/m²</span><strong>${pricePerSqm ? pricePerSqm.toFixed(1) : "n/a"}</strong></div>
        </div>
        <p class="description">${escapeHtml(apartment.description || "No description added yet.")}</p>
        <div class="score-pills">
          ${renderScorePills(apartment)}
        </div>
        <div class="card-actions">
          <button class="ghost-button" data-action="open-map" data-id="${apartment.id}">Map</button>
          <button class="ghost-button" data-action="edit-apartment" data-id="${apartment.id}">Edit</button>
          <button class="ghost-button" data-action="refresh-score" data-id="${apartment.id}">Refresh</button>
          <button class="ghost-button danger" data-action="delete-apartment" data-id="${apartment.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function renderApartmentForm() {
  const defaults = apartmentFormDefaults();
  const editingApartment =
    state.editingApartmentId === null
      ? null
      : state.apartments.find((item) => item.id === state.editingApartmentId) ?? null;

  const existingPhotos = editingApartment
    ? editingApartment.photos
        .map(
          (photo) => `
            <div class="photo-chip">
              <img src="${photo.url}" alt="" />
              <button type="button" class="icon-button" data-action="delete-photo" data-apartment-id="${editingApartment.id}" data-photo-id="${photo.id}">×</button>
            </div>
          `,
        )
        .join("")
    : "";

  return `
    <section class="panel-shell ${state.panelView === "apartment" ? "" : "is-hidden"}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Listing editor</p>
          <h2>${state.apartmentEditorMode === "create" ? "Add apartment" : "Edit apartment"}</h2>
        </div>
        <button class="icon-button" data-action="prepare-create-apartment">+</button>
      </div>
      <form id="apartment-form" class="stack">
        <label>
          Address
          <input name="address" type="text" value="${escapeHtml(defaults.address)}" required />
        </label>
        <div class="two-up">
          <label>
            Square meters
            <input name="squareMeters" type="number" min="1" step="0.5" value="${defaults.squareMeters}" required />
          </label>
          <label>
            Rooms
            <input name="roomCount" type="number" min="0.5" step="0.5" value="${defaults.roomCount}" required />
          </label>
        </div>
        <div class="two-up">
          <label>
            Kaltmiete
            <input name="kaltmiete" type="number" min="0" step="1" value="${defaults.kaltmiete}" required />
          </label>
          <label>
            Warmmiete
            <input name="warmmiete" type="number" min="0" step="1" value="${defaults.warmmiete}" required />
          </label>
        </div>
        <label>
          Floor level
          <input name="floorLevel" type="text" value="${escapeHtml(defaults.floorLevel)}" />
        </label>
        <label>
          Description
          <textarea name="description" rows="4">${escapeHtml(defaults.description)}</textarea>
        </label>
        <label>
          Photos
          <input name="photos" type="file" accept="image/*" multiple />
        </label>
        ${existingPhotos ? `<div class="photo-strip">${existingPhotos}</div>` : ""}
        <button class="primary-button" type="submit">${
          state.apartmentEditorMode === "create" ? "Save apartment" : "Update apartment"
        }</button>
      </form>
    </section>
  `;
}

function renderCustomPoiForm() {
  const defaults = customPoiDefaults();
  return `
    <section class="panel-shell ${state.panelView === "custom-poi" ? "" : "is-hidden"}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Reusable destinations</p>
          <h2>${state.editingCustomPoiId === null ? "Add custom place" : "Edit custom place"}</h2>
        </div>
        <button class="icon-button" data-action="prepare-create-custom-poi">+</button>
      </div>
      <form id="custom-poi-form" class="stack">
        <label>
          Name
          <input name="name" type="text" value="${escapeHtml(defaults.name)}" required />
        </label>
        <label>
          Address
          <input name="address" type="text" value="${escapeHtml(defaults.address)}" required />
        </label>
        <label>
          Notes
          <textarea name="notes" rows="3">${escapeHtml(defaults.notes)}</textarea>
        </label>
        <label class="toggle-row">
          <input name="isActive" type="checkbox" ${defaults.isActive ? "checked" : ""} />
          <span>Include in every apartment score</span>
        </label>
        <button class="primary-button" type="submit">${
          state.editingCustomPoiId === null ? "Save custom place" : "Update custom place"
        }</button>
      </form>
      <div class="stack compact">
        ${state.customPois
          .map(
            (poi) => `
              <article class="mini-card">
                <div>
                  <strong>${escapeHtml(poi.name)}</strong>
                  <p>${escapeHtml(poi.address)}</p>
                </div>
                <div class="mini-actions">
                  <button class="ghost-button" data-action="edit-custom-poi" data-id="${poi.id}">Edit</button>
                  <button class="ghost-button danger" data-action="delete-custom-poi" data-id="${poi.id}">Delete</button>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSettingsForm() {
  return `
    <section class="panel-shell ${state.panelView === "settings" ? "" : "is-hidden"}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Global weights</p>
          <h2>Scoring balance</h2>
        </div>
      </div>
      <form id="settings-form" class="stack">
        ${[
          ["pricePerSqm", "Price per m²"],
          ["rooms", "Rooms"],
          ["supermarket", "Supermarket"],
          ["sportStudio", "Sport studio"],
          ["ubahn", "U-Bahn"],
          ["cafe", "Cafes"],
          ["parkOrRiver", "Park or river"],
          ["customPoi", "Custom places"],
        ]
          .map(
            ([key, label]) => `
              <label>
                ${label}
                <input name="${key}" type="number" min="0" step="0.1" value="${
                  state.settings[key as keyof WeightSettings]
                }" />
              </label>
            `,
          )
          .join("")}
        <button class="primary-button" type="submit">Save weights</button>
      </form>
    </section>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="sidebar-tabs">
        <button class="tab ${state.panelView === "apartment" ? "is-active" : ""}" data-action="show-panel" data-panel="apartment">Apartment</button>
        <button class="tab ${state.panelView === "custom-poi" ? "is-active" : ""}" data-action="show-panel" data-panel="custom-poi">Custom places</button>
        <button class="tab ${state.panelView === "settings" ? "is-active" : ""}" data-action="show-panel" data-panel="settings">Weights</button>
      </div>
      ${renderApartmentForm()}
      ${renderCustomPoiForm()}
      ${renderSettingsForm()}
    </aside>
  `;
}

function renderListView() {
  return `
    <section class="content-shell">
      <div class="toolbar">
        <div>
          <p class="toolbar-label">Saved apartments</p>
          <strong>${state.apartments.length}</strong>
        </div>
        <label class="sorter">
          Sort by
          <select id="sort-mode">
            <option value="score" ${state.sortMode === "score" ? "selected" : ""}>Total score</option>
            <option value="warmmiete" ${state.sortMode === "warmmiete" ? "selected" : ""}>Warm rent</option>
            <option value="pricePerSqm" ${state.sortMode === "pricePerSqm" ? "selected" : ""}>€/m²</option>
            <option value="rooms" ${state.sortMode === "rooms" ? "selected" : ""}>Rooms</option>
            <option value="newest" ${state.sortMode === "newest" ? "selected" : ""}>Newest</option>
          </select>
        </label>
      </div>
      <div class="list-layout">
        <div class="apartment-feed">
          ${
            state.apartments.length
              ? sortedApartments().map(renderApartmentCard).join("")
              : `<div class="empty-state"><h2>No apartments saved yet</h2><p>Use the apartment panel to add the first listing, upload photos, and let the app calculate walking and transit scores.</p></div>`
          }
        </div>
        ${renderSidebar()}
      </div>
    </section>
  `;
}

function renderPoiStats() {
  const activeCount = state.pois.filter((poi) => poi.isActive).length;
  const inactiveCount = state.pois.length - activeCount;
  const standardCount = state.pois.filter((poi) => poi.kind === "standard").length;
  const customCount = state.pois.length - standardCount;

  return `
    <div class="poi-stat-grid">
      <article class="poi-stat-card">
        <span class="eyebrow">Total</span>
        <strong>${state.pois.length}</strong>
        <p>All cached and custom POIs</p>
      </article>
      <article class="poi-stat-card">
        <span class="eyebrow">Active</span>
        <strong>${activeCount}</strong>
        <p>${inactiveCount} currently excluded</p>
      </article>
      <article class="poi-stat-card">
        <span class="eyebrow">Standard</span>
        <strong>${standardCount}</strong>
        <p>Map and routing candidates</p>
      </article>
      <article class="poi-stat-card">
        <span class="eyebrow">Custom</span>
        <strong>${customCount}</strong>
        <p>User-managed scoring destinations</p>
      </article>
    </div>
  `;
}

function renderPoiToolbar() {
  const pois = filteredManagedPois();
  const selection = visibleManagedPoiSelectionState();

  return `
    <div class="toolbar poi-toolbar">
      <div>
        <p class="toolbar-label">POI management</p>
        <strong>${pois.length}</strong>
        <span class="toolbar-meta">visible after current filters</span>
      </div>
      <div class="bulk-actions">
        <button
          class="ghost-button"
          data-action="bulk-poi-status"
          data-status="active"
          ${selection.selected ? "" : "disabled"}
        >
          Enable selected
        </button>
        <button
          class="ghost-button danger"
          data-action="bulk-poi-status"
          data-status="inactive"
          ${selection.selected ? "" : "disabled"}
        >
          Disable selected
        </button>
        <button
          class="ghost-button"
          data-action="bulk-visible-poi-status"
          data-status="active"
          ${selection.total ? "" : "disabled"}
        >
          Enable all visible
        </button>
        <button
          class="ghost-button danger"
          data-action="bulk-visible-poi-status"
          data-status="inactive"
          ${selection.total ? "" : "disabled"}
        >
          Disable all visible
        </button>
      </div>
    </div>
  `;
}

function renderPoiCategoryFilters() {
  const summaries = summarizePoiCategories(state.pois);

  return `
    <div class="poi-filter-section">
      <div class="poi-filter-head">
        <strong>Categories</strong>
        <div class="mini-actions">
          <button type="button" class="ghost-button compact-button" data-action="select-all-poi-categories">All</button>
          <button type="button" class="ghost-button compact-button" data-action="clear-poi-categories">None</button>
        </div>
      </div>
      <div class="toggle-grid">
        ${MANAGED_POI_CATEGORY_ORDER.map((category) => {
          const summary = summaries.get(category) ?? { total: 0, active: 0 };
          return `
            <label class="filter-toggle">
              <input
                type="checkbox"
                data-action="toggle-managed-poi-category"
                data-category="${category}"
                ${state.visibleManagedPoiCategories[category] ? "checked" : ""}
                ${summary.total ? "" : "disabled"}
              />
              <span>${MANAGED_POI_LABELS[category]} (${summary.active}/${summary.total})</span>
            </label>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderPoiSportTagFilters() {
  const tagSummaries = Array.from(summarizeSportTags(state.pois).entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (tagSummaries.length === 0) {
    return "";
  }

  return `
    <div class="poi-filter-section">
      <div class="poi-filter-head">
        <strong>Sport studio subcategories</strong>
        <div class="mini-actions">
          <button type="button" class="ghost-button compact-button" data-action="select-all-managed-sport-tags">All</button>
        </div>
      </div>
      <div class="tag-grid">
        ${tagSummaries
          .map(([tag, summary]) => {
            const isActive = state.selectedManagedSportTags.includes(tag);
            return `
              <button
                type="button"
                class="tag-chip ${isActive ? "is-active" : ""}"
                data-action="toggle-managed-sport-tag"
                data-tag="${escapeHtml(tag)}"
              >
                ${escapeHtml(tag)} (${summary.active}/${summary.total})
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderPoiControls() {
  return `
    <div class="poi-admin-controls">
      <label class="poi-search">
        Search POIs
        <input
          id="poi-search"
          type="search"
          value="${escapeHtml(state.poiSearch)}"
          placeholder="Name, address, category, source or tag"
          autocomplete="off"
        />
      </label>
      <label class="sorter">
        Status
        <select id="poi-status-filter">
          <option value="all" ${state.poiStatusFilter === "all" ? "selected" : ""}>All</option>
          <option value="active" ${state.poiStatusFilter === "active" ? "selected" : ""}>Active only</option>
          <option value="inactive" ${state.poiStatusFilter === "inactive" ? "selected" : ""}>Inactive only</option>
        </select>
      </label>
      <button type="button" class="ghost-button" data-action="reset-poi-filters">Clear filters</button>
    </div>
    <div class="poi-filter-grid">
      ${renderPoiCategoryFilters()}
      ${renderPoiSportTagFilters()}
    </div>
  `;
}

function renderPoiRow(poi: ManagedPoi, selectedKeys: Set<string>) {
  const key = managedPoiKey(poi);
  return `
    <article class="poi-admin-row ${poi.isActive ? "" : "is-inactive"}">
      <label class="poi-select-cell">
        <input
          type="checkbox"
          data-action="toggle-managed-poi"
          data-key="${key}"
          ${selectedKeys.has(key) ? "checked" : ""}
        />
      </label>
      <div class="poi-main-cell">
        <div class="poi-row-head">
          <strong>${escapeHtml(poi.name)}</strong>
          <div class="poi-badges">
            <span class="pill-badge">${escapeHtml(poi.categoryLabel)}</span>
            <span class="pill-badge ${poi.kind === "custom" ? "custom" : ""}">${
              poi.kind === "custom" ? "Custom" : "Standard"
            }</span>
            <span class="status-dot ${poi.isActive ? "active" : "inactive"}">${
              poi.isActive ? "Active" : "Inactive"
            }</span>
          </div>
        </div>
        <p>${escapeHtml(poi.address || "Address unavailable")}</p>
        ${
          poi.tags.length
            ? `<div class="poi-tags">${poi.tags
                .slice(0, 4)
                .map((tag) => `<span class="mini-tag">${escapeHtml(tag)}</span>`)
                .join("")}</div>`
            : ""
        }
        ${poi.notes ? `<p class="poi-notes">${escapeHtml(poi.notes)}</p>` : ""}
      </div>
      <div class="poi-meta-cell">
        <p>${escapeHtml(poi.source ?? "n/a")}</p>
        <p>${poi.latitude !== null && poi.longitude !== null ? `${poi.latitude.toFixed(5)}, ${poi.longitude.toFixed(5)}` : "No coordinates"}</p>
      </div>
      <div class="poi-actions-cell">
        <button
          class="ghost-button compact-button ${poi.isActive ? "danger" : ""}"
          data-action="set-single-poi-status"
          data-key="${key}"
          data-status="${poi.isActive ? "inactive" : "active"}"
        >
          ${poi.isActive ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  `;
}

function renderPoiTable() {
  const pois = filteredManagedPois();
  const selection = visibleManagedPoiSelectionState();
  const selectedKeys = new Set(state.selectedManagedPoiKeys);

  return `
    <div class="poi-table-header">
      <label class="select-all-toggle">
        <input
          id="poi-select-all"
          type="checkbox"
          ${selection.allSelected ? "checked" : ""}
          ${selection.total ? "" : "disabled"}
        />
        <span>Select visible</span>
      </label>
      <p>${selection.selected} selected · ${selection.total} visible</p>
    </div>
    <div class="poi-table">
      ${
        pois.length
          ? pois.map((poi) => renderPoiRow(poi, selectedKeys)).join("")
          : `<div class="empty-state"><h2>No POIs match these filters</h2><p>Try a broader search or enable more categories.</p></div>`
      }
    </div>
  `;
}

function renderPoisView() {
  return `
    <section class="content-shell poi-admin-shell">
      <div id="poi-toolbar-region">${renderPoiToolbar()}</div>
      <div id="poi-stats-region">${renderPoiStats()}</div>
      <section class="poi-admin-panel">
        <div id="poi-controls-region">${renderPoiControls()}</div>
        <div id="poi-table-region">${renderPoiTable()}</div>
      </section>
    </section>
  `;
}

function renderMapLegend() {
  const payload = state.mapPayload;
  if (!payload) {
    return `
      <div class="map-legend stack compact">
        <div class="selector-block">
          <label>
            Apartment focus
            <select id="map-apartment-selector" ${state.apartments.length ? "" : "disabled"}>
              ${
                state.apartments.length
                  ? state.apartments
                      .map(
                        (apartment) => `
                          <option value="${apartment.id}" ${
                            apartment.id === state.selectedApartmentId ? "selected" : ""
                          }>
                            ${escapeHtml(apartment.address)}
                          </option>
                        `,
                      )
                      .join("")
                  : `<option>No apartments yet</option>`
              }
            </select>
          </label>
        </div>
        <div class="empty-state compact">
          <h2>No map focus yet</h2>
          <p>Add an apartment or select one from the list to see nearby POIs.</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="map-legend stack compact">
      <div class="map-controls stack">
        <div class="panel-block">
          <div class="panel-block-head">
            <strong>POIs on map</strong>
            <button class="ghost-button compact-button" data-action="toggle-poi-list">
              ${state.showPoiList ? "Hide list" : "Show list"}
            </button>
          </div>
          <div class="toggle-grid">
            ${(
              Object.keys(POI_LABELS) as StandardPoiCategory[]
            ).map(
              (category) => `
                <label class="filter-toggle">
                  <input
                    type="checkbox"
                    data-action="toggle-poi-category"
                    data-category="${category}"
                    ${state.visiblePoiCategories[category] ? "checked" : ""}
                  />
                  <span>${POI_LABELS[category]}</span>
                </label>
              `,
            ).join("")}
          </div>
        </div>
        <div class="panel-block">
          <div class="panel-block-head">
            <strong>Transit overlay</strong>
          </div>
          <div class="toggle-grid">
            <label class="filter-toggle">
              <input
                type="checkbox"
                data-action="toggle-transit-stops"
                ${state.showTransitStops ? "checked" : ""}
              />
              <span>Haltestellen</span>
            </label>
            <label class="filter-toggle">
              <input
                type="checkbox"
                data-action="toggle-ubahn-routes"
                ${state.showUbahnRoutes ? "checked" : ""}
              />
              <span>U-Bahn routes</span>
            </label>
          </div>
        </div>
        ${
          payload.sportStudioTags.length
            ? `
              <div class="panel-block">
                <div class="panel-block-head">
                  <strong>Sport studio types</strong>
                  <button class="ghost-button compact-button" data-action="clear-sport-tags">All</button>
                </div>
                <div class="tag-grid">
                  ${payload.sportStudioTags
                    .map(
                      (tag) => `
                        <button
                          class="tag-chip ${state.selectedSportTags.includes(tag) ? "is-active" : ""}"
                          data-action="toggle-sport-tag"
                          data-tag="${escapeHtml(tag)}"
                        >
                          ${escapeHtml(tag)}
                        </button>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      </div>
      <div class="selector-block">
        <label>
          Apartment focus
          <select id="map-apartment-selector">
            ${state.apartments
              .map(
                (apartment) => `
                  <option value="${apartment.id}" ${
                    apartment.id === state.selectedApartmentId ? "selected" : ""
                  }>
                    ${escapeHtml(apartment.address)}
                  </option>
                `,
              )
              .join("")}
          </select>
        </label>
      </div>
      <article class="focus-card">
        <p class="eyebrow">Selected apartment</p>
        <h2>${escapeHtml(payload.apartment.address)}</h2>
        <p>${payload.apartment.squareMeters} m² · ${payload.apartment.roomCount} rooms · ${formatCurrency(
          payload.apartment.warmmiete,
        )}</p>
      </article>
      <div class="score-table">
        ${payload.standardPoiScores
          .map(
            (score) => `
              <div class="score-row">
                <div>
                  <strong>${escapeHtml(score.label)}</strong>
                  <p>${escapeHtml(score.poiName)}</p>
                </div>
                <div>
                  <p>Walk ${score.walking.durationMinutes ?? "n/a"} min</p>
                  <p>Transit ${score.transit.durationMinutes ?? "n/a"} min</p>
                  <strong>${formatScore(score.score)}</strong>
                </div>
              </div>
            `,
          )
          .join("")}
        ${payload.customPoiScores
          .map(
            (score) => `
              <div class="score-row custom">
                <div>
                  <strong>${escapeHtml(score.name)}</strong>
                  <p>${escapeHtml(score.address)}</p>
                </div>
                <div>
                  <p>Walk ${score.walking.durationMinutes ?? "n/a"} min</p>
                  <p>Transit ${score.transit.durationMinutes ?? "n/a"} min</p>
                  <strong>${formatScore(score.score)}</strong>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
      ${
        state.showPoiList
          ? `
            <div class="poi-list-block">
              <div class="panel-block-head">
                <strong>Visible POIs</strong>
                <span>${visibleNearbyPois().length}</span>
              </div>
              <div class="poi-list">
                ${
                  visibleNearbyPois().length
                    ? Array.from(groupedVisiblePois().entries())
                        .map(
                          ([category, pois]) => `
                            <section class="poi-group">
                              <h3>${POI_LABELS[category]}</h3>
                              ${pois
                                .map(
                                  (poi) => `
                                    <article class="poi-row">
                                      <div>
                                        <strong>${escapeHtml(poi.name)}</strong>
                                        <p>${escapeHtml(poi.address || "Address unavailable")}</p>
                                      </div>
                                      ${
                                        poi.category === "sport_studio" && poi.tags.length
                                          ? `<div class="poi-tags">${poi.tags
                                              .slice(0, 3)
                                              .map(
                                                (tag) =>
                                                  `<span class="mini-tag">${escapeHtml(tag)}</span>`,
                                              )
                                              .join("")}</div>`
                                          : ""
                                      }
                                    </article>
                                  `,
                                )
                                .join("")}
                            </section>
                          `,
                        )
                        .join("")
                    : `<div class="empty-state compact"><p>No POIs match the current filters.</p></div>`
                }
              </div>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderMapView() {
  const disabledState =
    !mapIsAvailable(state.mapConfig)
      ? `<div class="map-fallback"><div class="panel-block"><strong>Map disabled</strong><p>${escapeHtml(
          state.mapConfig.unavailableReason,
        )}</p></div></div>`
      : "";
  return `
    <section class="map-layout">
      <div id="map-canvas" class="map-canvas">${disabledState}</div>
      <aside class="map-sidebar"></aside>
    </section>
  `;
}

function render() {
  if (state.activeView !== "map" && map) {
    destroyMap();
  }

  root.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${
        state.activeView === "list"
          ? renderListView()
          : state.activeView === "map"
            ? renderMapView()
            : renderPoisView()
      }
    </div>
  `;

  bindEvents();

  if (state.activeView === "map") {
    updateMapSidebar();
    queueMicrotask(() => renderMap());
  }
}

function updateMapSidebar() {
  const sidebar = document.querySelector<HTMLElement>(".map-sidebar");
  if (!sidebar || state.activeView !== "map") {
    return;
  }

  sidebar.innerHTML = renderMapLegend();
  bindMapSidebarEvents(sidebar);
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const target = event.currentTarget as HTMLElement;
      if (target.closest(".map-sidebar")) {
        return;
      }
      if (target.closest(".poi-admin-shell")) {
        return;
      }
      const action = target.dataset.action;
      if (!action) return;

      if (action === "switch-view") {
        const view =
          target.dataset.view === "map"
            ? "map"
            : target.dataset.view === "pois"
              ? "pois"
              : "list";
        state.activeView = view;
        window.history.replaceState(
          {},
          "",
          view === "map" ? "/map" : view === "pois" ? "/pois" : "/",
        );
        if (view === "pois") {
          await loadPoiManagement();
        }
        render();
        if (view === "map" && state.selectedApartmentId) {
          await loadMapPayload(state.selectedApartmentId);
        }
      }

      if (action === "show-panel") {
        state.panelView = target.dataset.panel as PanelView;
        render();
      }

      if (action === "prepare-create-apartment") {
        state.panelView = "apartment";
        state.apartmentEditorMode = "create";
        state.editingApartmentId = null;
        render();
      }

      if (action === "prepare-create-custom-poi") {
        state.panelView = "custom-poi";
        state.editingCustomPoiId = null;
        render();
      }

      if (action === "edit-apartment") {
        state.panelView = "apartment";
        state.apartmentEditorMode = "edit";
        state.editingApartmentId = Number(target.dataset.id);
        render();
      }

      if (action === "edit-custom-poi") {
        state.panelView = "custom-poi";
        state.editingCustomPoiId = Number(target.dataset.id);
        render();
      }

      if (action === "open-map") {
        const apartmentId = Number(target.dataset.id);
        state.activeView = "map";
        window.history.replaceState({}, "", "/map");
        await loadMapPayload(apartmentId);
      }

      if (action === "refresh-score") {
        const apartmentId = Number(target.dataset.id);
        const apartment = await requestJson<Apartment>(
          `/api/apartments/${apartmentId}/refresh-score`,
          { method: "POST" },
        );
        state.apartments = state.apartments.map((item) =>
          item.id === apartment.id ? apartment : item,
        );
        if (state.selectedApartmentId === apartment.id && state.activeView === "map") {
          await loadMapPayload(apartment.id);
        } else {
          render();
        }
      }

      if (action === "delete-apartment") {
        const apartmentId = Number(target.dataset.id);
        if (!window.confirm("Delete this apartment listing?")) return;
        await requestJson(`/api/apartments/${apartmentId}`, { method: "DELETE" });
        state.apartments = state.apartments.filter((item) => item.id !== apartmentId);
        if (state.selectedApartmentId === apartmentId) {
          state.selectedApartmentId = state.apartments[0]?.id ?? null;
        }
        render();
      }

      if (action === "delete-custom-poi") {
        const customPoiId = Number(target.dataset.id);
        if (!window.confirm("Delete this custom place?")) return;
        await requestJson(`/api/custom-pois/${customPoiId}`, { method: "DELETE" });
        state.customPois = state.customPois.filter((item) => item.id !== customPoiId);
        await refreshAppData({ refreshMap: true, refreshPois: state.poisLoaded });
      }

      if (action === "delete-photo") {
        const apartmentId = Number(target.dataset.apartmentId);
        const photoId = Number(target.dataset.photoId);
        await requestJson(`/api/apartments/${apartmentId}/photos/${photoId}`, {
          method: "DELETE",
        });
        const refreshed = await requestJson<Apartment>(`/api/apartments/${apartmentId}/refresh-score`, {
          method: "POST",
        });
        state.apartments = state.apartments.map((item) =>
          item.id === refreshed.id ? refreshed : item,
        );
        state.editingApartmentId = apartmentId;
        state.apartmentEditorMode = "edit";
        render();
      }

    });
  });

  const apartmentForm = document.querySelector<HTMLFormElement>("#apartment-form");
  apartmentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(apartmentForm);
    const payload = {
      address: String(formData.get("address") ?? ""),
      squareMeters: Number(formData.get("squareMeters") ?? 0),
      kaltmiete: Number(formData.get("kaltmiete") ?? 0),
      warmmiete: Number(formData.get("warmmiete") ?? 0),
      floorLevel: String(formData.get("floorLevel") ?? ""),
      roomCount: Number(formData.get("roomCount") ?? 0),
      description: String(formData.get("description") ?? ""),
    };

    const apartment =
      state.apartmentEditorMode === "create"
        ? await requestJson<Apartment>("/api/apartments", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : await requestJson<Apartment>(`/api/apartments/${state.editingApartmentId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

    const files = apartmentForm.querySelector<HTMLInputElement>('input[name="photos"]')?.files;
    if (files && files.length > 0) {
      const photoForm = new FormData();
      Array.from(files).forEach((file) => photoForm.append("photos", file));
      const uploadedApartment = await fetch(`/api/apartments/${apartment.id}/photos`, {
        method: "POST",
        body: photoForm,
      }).then((response) => response.json() as Promise<Apartment>);
      state.apartments = state.apartments.filter((item) => item.id !== apartment.id);
      state.apartments.unshift(uploadedApartment);
    } else {
      state.apartments = state.apartments.filter((item) => item.id !== apartment.id);
      state.apartments.unshift(apartment);
    }

    state.selectedApartmentId = apartment.id;
    state.apartmentEditorMode = "edit";
    state.editingApartmentId = apartment.id;
    render();
  });

  const customPoiForm = document.querySelector<HTMLFormElement>("#custom-poi-form");
  customPoiForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(customPoiForm);
    const payload = {
      name: String(formData.get("name") ?? ""),
      address: String(formData.get("address") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      isActive: formData.get("isActive") === "on",
    };

    const poi =
      state.editingCustomPoiId === null
        ? await requestJson<CustomPoi>("/api/custom-pois", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : await requestJson<CustomPoi>(`/api/custom-pois/${state.editingCustomPoiId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

    state.customPois = state.customPois.filter((item) => item.id !== poi.id);
    state.customPois.push(poi);
    state.editingCustomPoiId = poi.id;
    await refreshAppData({ refreshMap: true, refreshPois: state.poisLoaded });
  });

  const settingsForm = document.querySelector<HTMLFormElement>("#settings-form");
  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(settingsForm);
    const payload = Object.fromEntries(formData.entries());
    const response = await requestJson<{ settings: WeightSettings; apartments: Apartment[] }>(
      "/api/settings",
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
    state.settings = response.settings;
    state.apartments = response.apartments;
    render();
  });

  const sortSelect = document.querySelector<HTMLSelectElement>("#sort-mode");
  sortSelect?.addEventListener("change", () => {
    state.sortMode = sortSelect.value as SortMode;
    render();
  });

  bindPoiAdminEvents();
}

function updatePoiRegions(options?: { controls?: boolean }) {
  if (state.activeView !== "pois") {
    return;
  }

  const toolbarRegion = document.querySelector<HTMLElement>("#poi-toolbar-region");
  if (toolbarRegion) {
    toolbarRegion.innerHTML = renderPoiToolbar();
  }

  const statsRegion = document.querySelector<HTMLElement>("#poi-stats-region");
  if (statsRegion) {
    statsRegion.innerHTML = renderPoiStats();
  }

  if (options?.controls) {
    const controlsRegion = document.querySelector<HTMLElement>("#poi-controls-region");
    if (controlsRegion) {
      controlsRegion.innerHTML = renderPoiControls();
    }
  }

  const tableRegion = document.querySelector<HTMLElement>("#poi-table-region");
  if (tableRegion) {
    tableRegion.innerHTML = renderPoiTable();
  }
}

function schedulePoiSearchUpdate() {
  if (poiSearchUpdateTimer !== null) {
    window.clearTimeout(poiSearchUpdateTimer);
  }

  poiSearchUpdateTimer = window.setTimeout(() => {
    poiSearchUpdateTimer = null;
    updatePoiRegions();
  }, 120);
}

function visibleManagedPoiKeys() {
  return filteredManagedPoiEntries().map(({ key }) => key);
}

function poiStatusItemsFromKeys(keys: string[]) {
  return keys.flatMap((key) => {
    const [kind, rawId] = key.split(":");
    const id = Number(rawId);

    if ((kind !== "standard" && kind !== "custom") || !Number.isInteger(id) || id <= 0) {
      return [];
    }

    return [{ kind, id }];
  });
}

async function updateManagedPoiStatuses(keys: string[], isActive: boolean) {
  const items = poiStatusItemsFromKeys(keys);
  if (items.length === 0) {
    return;
  }

  await requestJson<PoiManagementPayload>("/api/pois/status", {
    method: "PUT",
    body: JSON.stringify({
      isActive,
      items,
    }),
  });
  state.selectedManagedPoiKeys = [];
  await refreshAppData({ refreshMap: true, refreshPois: true });
}

function bindPoiAdminEvents() {
  const shell = document.querySelector<HTMLElement>(".poi-admin-shell");
  if (!shell) {
    return;
  }

  shell.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.id !== "poi-search") {
      return;
    }

    state.poiSearch = input.value;
    schedulePoiSearchUpdate();
  });

  shell.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!input) {
      return;
    }

    if (input.id === "poi-status-filter") {
      state.poiStatusFilter = input.value as PoiStatusFilter;
      updatePoiRegions();
      return;
    }

    if (input.id === "poi-select-all" && input instanceof HTMLInputElement) {
      const visibleKeys = visibleManagedPoiKeys();
      const selectedKeys = new Set(state.selectedManagedPoiKeys);

      if (input.checked) {
        for (const key of visibleKeys) {
          selectedKeys.add(key);
        }
      } else {
        for (const key of visibleKeys) {
          selectedKeys.delete(key);
        }
      }

      state.selectedManagedPoiKeys = Array.from(selectedKeys);
      updatePoiRegions();
      return;
    }

    if (input.dataset.action === "toggle-managed-poi" && input instanceof HTMLInputElement) {
      const key = input.dataset.key;
      if (!key) {
        return;
      }

      state.selectedManagedPoiKeys = input.checked
        ? [...new Set([...state.selectedManagedPoiKeys, key])]
        : state.selectedManagedPoiKeys.filter((value) => value !== key);
      updatePoiRegions();
      return;
    }

    if (input.dataset.action === "toggle-managed-poi-category" && input instanceof HTMLInputElement) {
      const category = input.dataset.category as PoiCategory | undefined;
      if (!category) {
        return;
      }

      state.visibleManagedPoiCategories[category] = input.checked;
      updatePoiRegions();
    }
  });

  shell.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;

    if (action === "set-single-poi-status") {
      const key = target.dataset.key;
      if (!key) {
        return;
      }

      await updateManagedPoiStatuses([key], target.dataset.status === "active");
      return;
    }

    if (action === "bulk-poi-status") {
      await updateManagedPoiStatuses(
        selectedManagedPois().map(managedPoiKey),
        target.dataset.status === "active",
      );
      return;
    }

    if (action === "bulk-visible-poi-status") {
      await updateManagedPoiStatuses(visibleManagedPoiKeys(), target.dataset.status === "active");
      return;
    }

    if (action === "reset-poi-filters") {
      state.poiSearch = "";
      state.poiStatusFilter = "all";
      state.visibleManagedPoiCategories = {
        supermarket: true,
        sport_studio: true,
        ubahn: true,
        cafe: true,
        park_or_river: true,
        custom: true,
      };
      state.selectedManagedSportTags = [];
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "select-all-poi-categories" || action === "clear-poi-categories") {
      const isVisible = action === "select-all-poi-categories";
      for (const category of MANAGED_POI_CATEGORY_ORDER) {
        state.visibleManagedPoiCategories[category] = isVisible;
      }
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "toggle-managed-sport-tag") {
      const tag = target.dataset.tag;
      if (!tag) {
        return;
      }

      state.selectedManagedSportTags = state.selectedManagedSportTags.includes(tag)
        ? state.selectedManagedSportTags.filter((value) => value !== tag)
        : [...state.selectedManagedSportTags, tag];
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "select-all-managed-sport-tags") {
      state.selectedManagedSportTags = [];
      updatePoiRegions({ controls: true });
    }
  });
}

function bindMapSidebarEvents(sidebar: HTMLElement) {
  sidebar.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const target = event.currentTarget as HTMLElement;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "toggle-poi-list") {
        state.showPoiList = !state.showPoiList;
        updateMapSidebar();
        renderMap({ preserveViewport: true });
      }

      if (action === "toggle-transit-stops") {
        state.showTransitStops = !state.showTransitStops;
        updateMapSidebar();
        renderMap({ preserveViewport: true });
      }

      if (action === "toggle-ubahn-routes") {
        state.showUbahnRoutes = !state.showUbahnRoutes;
        updateMapSidebar();
        renderMap({ preserveViewport: true });
      }

      if (action === "clear-sport-tags") {
        state.selectedSportTags = [];
        updateMapSidebar();
        renderMap({ preserveViewport: true });
      }

      if (action === "toggle-sport-tag") {
        const tag = target.dataset.tag;
        if (!tag) return;
        state.selectedSportTags = state.selectedSportTags.includes(tag)
          ? state.selectedSportTags.filter((value) => value !== tag)
          : [...state.selectedSportTags, tag];
        updateMapSidebar();
        renderMap({ preserveViewport: true });
      }
    });
  });

  sidebar
    .querySelectorAll<HTMLInputElement>('input[data-action="toggle-poi-category"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        const category = input.dataset.category as StandardPoiCategory | undefined;
        if (!category) return;
        state.visiblePoiCategories[category] = input.checked;
        updateMapSidebar();
        renderMap({ preserveViewport: true });
      });
    });

  const mapApartmentSelector = sidebar.querySelector<HTMLSelectElement>("#map-apartment-selector");
  mapApartmentSelector?.addEventListener("change", async () => {
    const apartmentId = Number(mapApartmentSelector.value);
    await loadMapPayload(apartmentId);
  });
}

function renderMap(options?: { preserveViewport?: boolean }) {
  if (state.activeView !== "map") {
    return;
  }

  const mapElement = document.querySelector<HTMLElement>("#map-canvas");
  if (!mapElement) {
    return;
  }

  if (!mapIsAvailable(state.mapConfig)) {
    destroyMap();
    return;
  }

  if (map && map.getContainer() !== mapElement) {
    destroyMap();
  }

  if (!map) {
    map = new maplibregl.Map({
      container: mapElement,
      style: state.mapConfig.styleUrl,
      center: state.mapConfig.center,
      zoom: 11,
      minZoom: state.mapConfig.minZoom,
      maxZoom: state.mapConfig.maxZoom,
      maxBounds: state.mapConfig.bounds,
      renderWorldCopies: false,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: state.mapConfig.attribution,
      }),
      "bottom-right",
    );
    map.on("load", () => {
      addMapSourcesAndLayers();
      syncMapSources(options);
    });
    map.on("error", (event) => {
      console.error("MapLibre error", event.error ?? event);
    });
    resizeMapSoon();
    return;
  }

  syncMapSources(options);
}

async function boot() {
  await loadBootstrap();
  if (state.activeView === "pois") {
    await loadPoiManagement();
    render();
  }
}

boot().catch((error) => {
  root.innerHTML = `<div class="fatal-error"><h1>App failed to load</h1><p>${escapeHtml(
    error instanceof Error ? error.message : "Unknown error",
  )}</p></div>`;
});
