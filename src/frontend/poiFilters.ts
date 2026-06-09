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
  selectedSubcategories: string[];
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
      poi.subcategory,
      poi.kind,
      poi.notes,
      poi.source?.join(" ") ?? "",
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
  const selectedSubcategories = new Set(options.selectedSubcategories);

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

    const subcategories = managedPoiSubcategories(poi);
    const matchesSubcategory = subcategories.length
      ? subcategories.some((value) =>
          selectedSubcategories.has(managedPoiSubcategoryKey(poi.category, value)),
        )
      : selectedSubcategories.has(managedPoiSubcategoryKey(poi.category, ""));

    if (selectedSubcategories.size > 0 && !matchesSubcategory) {
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

export function managedPoiSubcategories(poi: ManagedPoi) {
  return Array.from(new Set([poi.subcategory, ...poi.tags].filter(Boolean)));
}

export function managedPoiSubcategoryKey(category: string, subcategory: string) {
  return `${category}:${subcategory}`;
}

export function existingPoiSubcategories(pois: ManagedPoi[], category: PoiCategory) {
  return Array.from(
    new Set(
      pois
        .filter((poi) => poi.category === category)
        .flatMap(managedPoiSubcategories),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

export function summarizePoiSubcategories(pois: ManagedPoi[]) {
  const summaries = new Map<string, { category: PoiCategory; label: string; total: number; active: number }>();

  for (const poi of pois) {
    const subcategories = managedPoiSubcategories(poi);
    for (const subcategory of subcategories.length ? subcategories : [""]) {
      const key = managedPoiSubcategoryKey(poi.category, subcategory);
      const current = summaries.get(key) ?? {
        category: poi.category,
        label: subcategory,
        total: 0,
        active: 0,
      };
      current.total += 1;
      current.active += poi.isActive ? 1 : 0;
      summaries.set(key, current);
    }
  }

  return summaries;
}
