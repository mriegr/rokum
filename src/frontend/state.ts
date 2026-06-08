import type {
  Apartment,
  BootstrapPayload,
  CustomPoi,
  ManagedPoi,
  MapConfig,
  MapPayload,
  PoiCategory,
  PoiCategoryLabelRecord,
  PoiCategoryManagementPayload,
  PoiIconRecord,
  PoiManagementPayload,
  PoiRecord,
  StandardPoiCategory,
  WeightSettings,
} from "../shared/types";
import {
  filterIndexedManagedPois,
  indexManagedPois,
  managedPoiKey,
  type IndexedManagedPoi,
  type PoiStatusFilter,
} from "./poiFilters";

export type EditorMode = "create" | "edit";
export type PanelView = "apartment" | "custom-poi" | "settings";
export type SortMode = "score" | "warmmiete" | "pricePerSqm" | "rooms" | "newest";
export type MainView = "list" | "map" | "pois" | "categories";

export type AppState = BootstrapPayload & {
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
  showUbahnRoutes: boolean;
  pois: ManagedPoi[];
  indexedPois: IndexedManagedPoi[];
  poisLoaded: boolean;
  poiSearch: string;
  poiStatusFilter: PoiStatusFilter;
  visibleManagedPoiCategories: Record<PoiCategory, boolean>;
  selectedManagedSportTags: string[];
  selectedManagedPoiKeys: string[];
  managedPoiIcons: Map<string, string>;
  poiCategoryLabelMap: Map<string, string>;
  categoriesLoaded: boolean;
  categoryManagement: PoiCategoryManagementPayload | null;
  expandedCategoryKeys: string[];
  editingCategoryKey: string | null;
};

export type LngLatTuple = [number, number];
export type MapFeatureProperties = Record<string, string | number | boolean | null>;
export type FeatureCollection = {
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

const rootElement = document.querySelector("#app");
if (!rootElement) {
  throw new Error("App root not found");
}
export const root = rootElement as HTMLDivElement;

export const initialView: MainView =
  window.location.pathname === "/map"
    ? "map"
    : window.location.pathname === "/pois"
      ? "pois"
      : window.location.pathname === "/categories"
        ? "categories"
      : "list";

export const state: AppState = {
  apartments: [],
  customPois: [],
  settings: {
    pricePerSqm: 1.3,
    rooms: 0.9,
    supermarket: 1,
    sportStudio: 1,
    customPoi: 1.1,
  },
  mapConfig: {
    available: false,
    unavailableReason: "Map API configuration is missing.",
    styleUrl: null,
  },
  poiCategoryLabels: [],
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
  },
  showPoiList: true,
  selectedSportTags: [],
  showUbahnRoutes: true,
  pois: [],
  indexedPois: [],
  poisLoaded: false,
  poiSearch: "",
  poiStatusFilter: "all",
  visibleManagedPoiCategories: {
    supermarket: true,
    sport_studio: true,
    custom: true,
  },
  selectedManagedSportTags: [],
  selectedManagedPoiKeys: [],
  managedPoiIcons: new Map(),
  poiCategoryLabelMap: new Map(),
  categoriesLoaded: false,
  categoryManagement: null,
  expandedCategoryKeys: [],
  editingCategoryKey: null,
};

export const EMPTY_FEATURE_COLLECTION: FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export const APARTMENT_SOURCE_ID = "apartment";
export const POI_SOURCE_ID = "nearby-pois";
export const POI_SPIDER_LEG_SOURCE_ID = "nearby-poi-spider-legs";
export const UBAHN_STATION_SOURCE_ID = "ubahn-stations";
export const UBAHN_SOURCE_ID = "ubahn-routes";

export const APARTMENT_LAYER_ID = "apartment-layer";
export const POI_SPIDER_LEG_LAYER_ID = "poi-spider-leg-layer";
export const POI_LAYER_ID = "poi-layer";
export const UBAHN_STATION_LAYER_ID = "ubahn-station-layer";
export const UBAHN_LAYER_ID = "ubahn-layer";

export const POI_LABELS: Record<StandardPoiCategory, string> = {
  supermarket: "Supermarkets",
  sport_studio: "Sport studios",
};

export const MANAGED_POI_CATEGORY_ORDER: PoiCategory[] = [
  "sport_studio",
  "supermarket",
  "custom",
];

export const MANAGED_POI_LABELS: Record<PoiCategory, string> = {
  supermarket: "Supermarkets",
  sport_studio: "Sport studios",
  custom: "Custom POIs",
};

export function setPoiCategoryLabels(records: PoiCategoryLabelRecord[]) {
  state.poiCategoryLabelMap = new Map(
    records.map((record) => [poiIconKey(record.category, record.subcategory), record.label]),
  );
}

export function standardPoiLabel(category: StandardPoiCategory) {
  return state.poiCategoryLabelMap.get(poiIconKey(category, "")) ?? POI_LABELS[category] ?? category;
}

export function managedPoiCategoryLabel(category: PoiCategory) {
  if (category === "custom") {
    return MANAGED_POI_LABELS.custom;
  }

  return standardPoiLabel(category);
}

export function categoryDisplayLabel(category: string, subcategory: string, fallback: string) {
  return state.poiCategoryLabelMap.get(poiIconKey(category, subcategory)) ?? fallback;
}

export function currentApartment() {
  return state.apartments.find((apartment) => apartment.id === state.selectedApartmentId) ?? null;
}

export function currentPoiFilters() {
  return {
    search: state.poiSearch,
    status: state.poiStatusFilter,
    visibleCategories: state.visibleManagedPoiCategories,
    selectedSportTags: state.selectedManagedSportTags,
  };
}

export function filteredManagedPoiEntries() {
  return filterIndexedManagedPois(state.indexedPois, currentPoiFilters());
}

export function filteredManagedPois() {
  return filteredManagedPoiEntries().map(({ poi }) => poi);
}

export function selectedManagedPois() {
  const keys = new Set(state.selectedManagedPoiKeys);
  return filteredManagedPoiEntries()
    .filter((entry) => keys.has(entry.key))
    .map(({ poi }) => poi);
}

export function visibleManagedPoiSelectionState() {
  const visibleKeys = filteredManagedPoiEntries().map(({ key }) => key);
  const selectedKeys = new Set(state.selectedManagedPoiKeys);
  const selectedCount = visibleKeys.filter((key) => selectedKeys.has(key)).length;

  return {
    total: visibleKeys.length,
    selected: selectedCount,
    allSelected: visibleKeys.length > 0 && selectedCount === visibleKeys.length,
  };
}

export function visibleNearbyPois() {
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

export function groupedVisiblePois() {
  const grouped = new Map<StandardPoiCategory, PoiRecord[]>();
  for (const poi of visibleNearbyPois()) {
    const bucket = grouped.get(poi.category) ?? [];
    bucket.push(poi);
    grouped.set(poi.category, bucket);
  }
  return grouped;
}

export function sortedApartments() {
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

export function visibleManagedPoiKeys() {
  return filteredManagedPoiEntries().map(({ key }) => key);
}

export function poiIconKey(category: string, subcategory: string) {
  return `${category}:${subcategory}`;
}

export function isCategoryExpanded(category: string) {
  return state.expandedCategoryKeys.includes(poiIconKey(category, ""));
}

export function getPoiIconUrl(category: string, subcategory: string): string | null {
  return state.managedPoiIcons.get(poiIconKey(category, subcategory)) ?? null;
}

export function getSubcategoriesForCategory(category: string): string[] {
  return (
    state.categoryManagement?.categories
      .find((entry) => entry.category === category)?.subcategories.map((entry) => entry.subcategory) ?? []
  );
}
