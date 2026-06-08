import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  bulkUpdatePoiActiveState,
  createDatabase,
  insertCustomPoi,
  insertOrIgnorePoi,
  listActivePois,
  listActivePoisByCategory,
  listCustomPois,
  listPoiCategoryLabels,
  upsertPoiCategoryLabel,
} from "./db";
import type { AppConfig } from "../shared/types";

const databasePaths: string[] = [];

afterEach(() => {
  for (const path of databasePaths.splice(0)) {
    rmSync(path, { force: true });
  }
});

function createTestConfig(): AppConfig {
  const databasePath = join("/tmp", `rokum-${randomUUID()}.sqlite`);
  databasePaths.push(databasePath);
  return {
    port: 0,
    city: "Munich",
    databasePath,
    uploadDirectory: "/tmp",
    nominatimBaseUrl: "https://example.test",
    overpassBaseUrl: "https://example.test",
    walkingBaseUrl: "https://example.test",
    transitBaseUrl: null,
    transitMode: "heuristic",
    jawgApiKey: null,
    jawgStyleId: "jawg-streets",
  };
}

test("inactive standard pois are excluded from active poi queries", () => {
  const database = createDatabase(createTestConfig());

  insertOrIgnorePoi(database, {
    category: "supermarket",
    subcategory: "",
    name: "Active market",
    address: "Street 1",
    isActive: true,
    latitude: 48.1,
    longitude: 11.5,
    source: "test",
    externalId: null,
    tags: [],
    note: "",
  });
  insertOrIgnorePoi(database, {
    category: "supermarket",
    subcategory: "",
    name: "Inactive market",
    address: "Street 2",
    isActive: true,
    latitude: 48.2,
    longitude: 11.6,
    source: "test",
    externalId: null,
    tags: [],
    note: "",
  });

  const allSupermarkets = listActivePoisByCategory(database, "supermarket");
  expect(allSupermarkets).toHaveLength(2);

  bulkUpdatePoiActiveState(database, {
    standardPoiIds: [allSupermarkets[1]!.id],
    customPoiIds: [],
    isActive: false,
  });

  const activeSupermarkets = listActivePoisByCategory(database, "supermarket");
  expect(activeSupermarkets).toHaveLength(1);
  expect(activeSupermarkets[0]?.name).toBe("Active market");

  const activePois = listActivePois(database);
  expect(activePois.map((poi) => poi.name)).toEqual(["Active market"]);
});

test("bulk poi activation also applies to custom pois", () => {
  const database = createDatabase(createTestConfig());

  const customPoiId = insertCustomPoi(database, {
    name: "Climbing gym",
    address: "Street 3",
    notes: "",
    isActive: true,
  });

  bulkUpdatePoiActiveState(database, {
    standardPoiIds: [],
    customPoiIds: [customPoiId],
    isActive: false,
  });

  expect(listCustomPois(database)[0]?.isActive).toBe(false);
});

test("category labels can be stored for categories and subcategories", () => {
  const database = createDatabase(createTestConfig());

  upsertPoiCategoryLabel(database, "supermarket", "", "Groceries");
  upsertPoiCategoryLabel(database, "supermarket", "edeka", "EDEKA stores");

  expect(listPoiCategoryLabels(database)).toEqual([
    { category: "supermarket", subcategory: "", label: "Groceries" },
    { category: "supermarket", subcategory: "edeka", label: "EDEKA stores" },
  ]);
});
