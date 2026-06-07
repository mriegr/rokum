import type { ManagedPoi, PoiCategory } from "../shared/types";

export type PoiStatusFilter = "all" | "active" | "inactive";

export type IndexedManagedPoi = {
  poi: ManagedPoi;
  key: string;
  searchText: string;
};

export type PoiFilterOptions = {
  search: string;
  status: PoiStatusFilter;
  visibleCategories: Record<PoiCategory, boolean>;
  selectedSportTags: string[];
};

export function managedPoiKey(poi: ManagedPoi) {
  return `${poi.kind}:${poi.id}`;
}

export function normalizePoiSearch(value: string) {
  return value.trim().toLocaleLowerCase("de-DE");
}

export function indexManagedPois(pois: ManagedPoi[]) {
  return pois.map((poi) => ({
    poi,
    key: managedPoiKey(poi),
    searchText: [
      poi.name,
      poi.address,
      poi.categoryLabel,
      poi.kind,
      poi.notes,
      poi.source ?? "",
      poi.tags.join(" "),
    ]
      .join(" ")
      .toLocaleLowerCase("de-DE"),
  }));
}

export function filterIndexedManagedPois(
  indexedPois: IndexedManagedPoi[],
  options: PoiFilterOptions,
) {
  const search = normalizePoiSearch(options.search);
  const selectedSportTags = new Set(options.selectedSportTags);

  return indexedPois.filter(({ poi, searchText }) => {
    if (options.status === "active" && !poi.isActive) {
      return false;
    }

    if (options.status === "inactive" && poi.isActive) {
      return false;
    }

    if (!options.visibleCategories[poi.category]) {
      return false;
    }

    if (
      poi.category === "sport_studio" &&
      selectedSportTags.size > 0 &&
      !poi.tags.some((tag) => selectedSportTags.has(tag))
    ) {
      return false;
    }

    return !search || searchText.includes(search);
  });
}

export function summarizePoiCategories(pois: ManagedPoi[]) {
  const summaries = new Map<PoiCategory, { total: number; active: number }>();

  for (const poi of pois) {
    const current = summaries.get(poi.category) ?? { total: 0, active: 0 };
    current.total += 1;
    current.active += poi.isActive ? 1 : 0;
    summaries.set(poi.category, current);
  }

  return summaries;
}

export function summarizeSportTags(pois: ManagedPoi[]) {
  const summaries = new Map<string, { total: number; active: number }>();

  for (const poi of pois) {
    if (poi.category !== "sport_studio") {
      continue;
    }

    for (const tag of poi.tags) {
      const current = summaries.get(tag) ?? { total: 0, active: 0 };
      current.total += 1;
      current.active += poi.isActive ? 1 : 0;
      summaries.set(tag, current);
    }
  }

  return summaries;
}
