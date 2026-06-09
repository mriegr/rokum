import { expect, test } from "bun:test";
import {
  filterIndexedManagedPois,
  existingPoiSubcategories,
  indexManagedPois,
  managedPoiKey,
  managedPoiSubcategoryKey,
  summarizePoiCategories,
  summarizePoiSubcategories,
  type PoiFilterOptions,
} from "./poiFilters";
import type { ManagedPoi, PoiCategory } from "../shared/types";

function poi(overrides: Partial<ManagedPoi> & Pick<ManagedPoi, "id" | "kind" | "category" | "name">): ManagedPoi {
  return {
    id: overrides.id,
    kind: overrides.kind,
    category: overrides.category,
    categoryLabel: overrides.categoryLabel ?? overrides.category,
    subcategory: overrides.subcategory ?? "",
    name: overrides.name,
    address: overrides.address ?? "",
    isActive: overrides.isActive ?? true,
    notes: overrides.notes ?? "",
    source: overrides.source ?? null,
    tags: overrides.tags ?? [],
    latitude: overrides.latitude ?? null,
    longitude: overrides.longitude ?? null,
    createdAt: overrides.createdAt ?? "",
    updatedAt: overrides.updatedAt ?? null,
  };
}

function allCategories(visible = true): Record<PoiCategory, boolean> {
  return {
    supermarket: visible,
    sport_studio: visible,
    custom: visible,
  };
}

function filter(pois: ManagedPoi[], overrides: Partial<PoiFilterOptions> = {}) {
  return filterIndexedManagedPois(indexManagedPois(pois), {
    search: "",
    status: "all",
    visibleCategories: allCategories(),
    selectedSubcategories: [],
    ...overrides,
  }).map(({ poi }) => poi.name);
}

test("search matches indexed poi fields", () => {
  const pois = [
    poi({
      id: 1,
      kind: "standard",
      category: "sport_studio",
      categoryLabel: "Sport studio",
      name: "Morning Flow",
      address: "Schwanthalerstrasse 1",
      source: ["urbansportsclub"],
      tags: ["Yoga"],
    }),
    poi({
      id: 2,
      kind: "custom",
      category: "custom",
      categoryLabel: "Custom",
      name: "Office",
      notes: "near lunch route",
    }),
  ];

  expect(filter(pois, { search: "yoga" })).toEqual(["Morning Flow"]);
  expect(filter(pois, { search: "custom" })).toEqual(["Office"]);
  expect(filter(pois, { search: "lunch" })).toEqual(["Office"]);
  expect(filter(pois, { search: "schwanthaler" })).toEqual(["Morning Flow"]);
});

test("category, sport tag, and status filters combine", () => {
  const pois = [
    poi({
      id: 1,
      kind: "standard",
      category: "sport_studio",
      name: "Yoga Studio",
      tags: ["Yoga"],
    }),
    poi({
      id: 2,
      kind: "standard",
      category: "sport_studio",
      name: "Box Studio",
      tags: ["Boxing"],
      isActive: false,
    }),
    poi({ id: 3, kind: "standard", category: "supermarket", name: "Market" }),
    poi({ id: 4, kind: "custom", category: "custom", name: "Doctor" }),
  ];

  expect(
    filter(pois, {
      visibleCategories: {
        ...allCategories(false),
        sport_studio: true,
      },
      selectedSubcategories: [managedPoiSubcategoryKey("sport_studio", "Boxing")],
      status: "inactive",
    }),
  ).toEqual(["Box Studio"]);
});

test("visible bulk keys resolve only filtered pois", () => {
  const pois = [
    poi({ id: 1, kind: "standard", category: "supermarket", name: "Active Market" }),
    poi({
      id: 2,
      kind: "standard",
      category: "supermarket",
      name: "Inactive Market",
      isActive: false,
    }),
    poi({ id: 3, kind: "custom", category: "custom", name: "Gym" }),
  ];

  const keys = filterIndexedManagedPois(indexManagedPois(pois), {
    search: "market",
    status: "active",
    visibleCategories: allCategories(),
    selectedSubcategories: [],
  }).map(({ poi }) => managedPoiKey(poi));

  expect(keys).toEqual(["standard:1"]);
});

test("category and subcategory summaries include totals and active counts", () => {
  const pois = [
    poi({ id: 1, kind: "standard", category: "sport_studio", name: "Yoga", tags: ["Yoga"] }),
    poi({
      id: 2,
      kind: "standard",
      category: "sport_studio",
      name: "Pilates",
      tags: ["Yoga", "Pilates"],
      isActive: false,
    }),
    poi({ id: 3, kind: "custom", category: "custom", name: "Office" }),
  ];

  expect(summarizePoiCategories(pois).get("sport_studio")).toEqual({ total: 2, active: 1 });
  expect(summarizePoiCategories(pois).get("custom")).toEqual({ total: 1, active: 1 });
  expect(summarizePoiSubcategories(pois).get("sport_studio:Yoga")).toEqual({
    category: "sport_studio",
    label: "Yoga",
    total: 2,
    active: 1,
  });
  expect(summarizePoiSubcategories(pois).get("sport_studio:Pilates")).toEqual({
    category: "sport_studio",
    label: "Pilates",
    total: 1,
    active: 0,
  });
  expect(summarizePoiSubcategories(pois).get("custom:")).toEqual({
    category: "custom",
    label: "",
    total: 1,
    active: 1,
  });
});

test("subcategory selections narrow the inventory to matching POIs", () => {
  const pois = [
    poi({ id: 1, kind: "standard", category: "sport_studio", name: "Yoga", tags: ["Yoga"] }),
    poi({ id: 2, kind: "standard", category: "sport_studio", name: "Boxing", tags: ["Boxing"] }),
    poi({ id: 3, kind: "standard", category: "supermarket", name: "Market", subcategory: "edeka" }),
  ];

  expect(
    filter(pois, {
      selectedSubcategories: [managedPoiSubcategoryKey("sport_studio", "Yoga")],
    }),
  ).toEqual(["Yoga"]);
});

test("no subcategory selections match only uncategorized POIs in that category", () => {
  const pois = [
    poi({ id: 1, kind: "standard", category: "supermarket", name: "General Market" }),
    poi({ id: 2, kind: "standard", category: "supermarket", name: "Edeka", subcategory: "edeka" }),
    poi({ id: 3, kind: "standard", category: "sport_studio", name: "General Gym" }),
  ];

  expect(
    filter(pois, {
      selectedSubcategories: [managedPoiSubcategoryKey("supermarket", "")],
    }),
  ).toEqual(["General Market"]);
});

test("existing subcategories are distinct and scoped to their category", () => {
  const pois = [
    poi({ id: 1, kind: "standard", category: "supermarket", name: "Edeka", subcategory: "edeka" }),
    poi({ id: 2, kind: "standard", category: "supermarket", name: "Another Edeka", subcategory: "edeka" }),
    poi({ id: 3, kind: "standard", category: "sport_studio", name: "Studio", tags: ["Yoga", "Pilates"] }),
  ];

  expect(existingPoiSubcategories(pois, "supermarket")).toEqual(["edeka"]);
  expect(existingPoiSubcategories(pois, "sport_studio")).toEqual(["Pilates", "Yoga"]);
});
