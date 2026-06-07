#!/usr/bin/env bun

import { existsSync, rmSync } from "node:fs";
import { Database } from "bun:sqlite";
import { loadConfig } from "../src/shared/config";
import { createDatabase, insertOrIgnorePoi } from "../src/backend/db";
import { MUNICH_GREATER_AREA_BOUNDS } from "../src/shared/munich";
import { getTransitOverlayCachePath } from "../src/backend/transitOverlayCache";
import type { StandardPoiCategory } from "../src/shared/types";

const USER_AGENT = "rokum-apartment-shortlist/1.0";
const OVERPASS_BASE = "https://overpass-api.de/api/interpreter";

type CliArgs = {
  refresh: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { refresh: false };
  for (const arg of argv) {
    if (arg === "--refresh" || arg === "-r") result.refresh = true;
    if (arg === "--help" || arg === "-h") printHelpAndExit();
  }
  return result;
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun scripts/cache-munich-data.ts [options]

Options:
  -r, --refresh      Delete existing caches before seeding
  -h, --help         Show this help

Examples:
  bun scripts/cache-munich-data.ts
  bun scripts/cache-munich-data.ts --refresh
`.trim());
  process.exit(0);
}

async function fetchOverpassJson<T>(query: string): Promise<T> {
  const response = await fetch(OVERPASS_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: query,
  });
  if (!response.ok) {
    throw new Error(`Overpass request failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

function categoryFromTags(
  tags: Record<string, string>,
): StandardPoiCategory | null {
  if (tags.shop === "supermarket") return "supermarket";
  if (tags.amenity === "cafe") return "cafe";
  if (
    (tags.railway === "station" && tags.station === "subway") ||
    tags.subway === "yes"
  ) {
    return "ubahn";
  }
  if (
    tags.leisure === "park" ||
    tags.natural === "water" ||
    tags.waterway === "riverbank"
  ) {
    return "park_or_river";
  }
  return null;
}

type OverpassElement = {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

async function seedPois(database: Database) {
  const [[west, south], [east, north]] = MUNICH_GREATER_AREA_BOUNDS;

  console.log("Fetching all standard POIs across Munich from Overpass...");
  const payload = await fetchOverpassJson<{ elements: OverpassElement[] }>(`
[out:json][timeout:60];
(
  node["shop"="supermarket"](${south},${west},${north},${east});
  way["shop"="supermarket"](${south},${west},${north},${east});
  node["amenity"="cafe"](${south},${west},${north},${east});
  way["amenity"="cafe"](${south},${west},${north},${east});
  node["railway"="station"]["station"="subway"](${south},${west},${north},${east});
  node["public_transport"="station"]["subway"="yes"](${south},${west},${north},${east});
  way["railway"="station"]["station"="subway"](${south},${west},${north},${east});
  node["leisure"="park"](${south},${west},${north},${east});
  way["leisure"="park"](${south},${west},${north},${east});
  way["natural"="water"](${south},${west},${north},${east});
  way["waterway"="riverbank"](${south},${west},${north},${east});
);
out center tags;
`.trim());

  const categoryCounts: Record<string, number> = {};
  let inserted = 0;

  for (const element of payload.elements) {
    const tags = element.tags ?? {};
    const category = categoryFromTags(tags);
    if (!category) continue;

    const latitude = element.lat ?? element.center?.lat;
    const longitude = element.lon ?? element.center?.lon;
    if (latitude === undefined || longitude === undefined) continue;

    const name =
      tags.name ||
      (category === "park_or_river" ? "Park or river access" : "Unnamed POI");
    const address = [
      tags["addr:street"],
      tags["addr:housenumber"],
      tags["addr:postcode"],
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    insertOrIgnorePoi(database, {
      category,
      name,
      address,
      isActive: true,
      latitude,
      longitude,
      source: "overpass",
      externalId: `${element.id}`,
      tags: [],
    });

    const existing = categoryCounts[category] ?? 0;
    categoryCounts[category] = existing + 1;
    inserted++;
  }

  console.log("POI seeding complete:");
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`  ${cat}: ${count}`);
  }
  console.log(`  Total inserted: ${inserted}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const database = createDatabase(config);

  if (args.refresh) {
    const transitCachePath = getTransitOverlayCachePath(config);
    if (existsSync(transitCachePath)) {
      rmSync(transitCachePath, { force: true });
      console.log(`Removed transit overlay cache: ${transitCachePath}`);
    }
  }

  await seedPois(database);

  console.log("\nDone. POIs are seeded in the database.");
  console.log("The runtime will now use local data instead of querying Overpass per apartment.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
