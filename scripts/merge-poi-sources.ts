#!/usr/bin/env bun
/**
 * Reads supermarket POIs from the database, merges duplicate entries
 * that represent the same store at the same location.
 *
 * Merge strategy:
 *  - Groups by normalized address + coordinate proximity (< 100m)
 *  - Within each group, further splits by name similarity
 *    (case-insensitive substring match — "REWE Center" ≈ "Rewe")
 *  - Prefers google-grid data when available (address, coords, name)
 *  - Expands abbreviations: "Str." → "Straße", "Pl." → "Platz"
 *  - Merges source arrays to track provenance
 *
 * Outputs a cleaned JSON file for use by seed-supermarkets.ts.
 */

import { createDatabase } from "../src/backend/db";
import { loadConfig } from "../src/shared/config";
import type { PoiRecord, StandardPoiCategory } from "../src/shared/types";

const config = loadConfig();
const database = createDatabase(config);

const OUTPUT_PATH = "data/sources/supermarkets-cleaned.json";

type CleanedEntry = {
  name: string;
  chain: string;
  address: string;
  latitude: number;
  longitude: number;
  sources: string[];
  externalIds: string[];
  placeId: string | null;
};

function normalizeAndExpand(addr: string): string {
  let result = addr.toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_~\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Match "str" or "pl" at end of word (followed by space, number, or end)
  result = result.replace(/(\w*?)str(?=\s|$)/g, "$1straße");
  result = result.replace(/(\w*?)pl(?=\s|$)/g, "$1platz");
  return result;
}

function expandAbbreviations(addr: string): string {
  let result = addr;
  // Match "str." or "Str." in compound words: "Rosenkavalierstr." → "Rosenkavalierstraße"
  result = result.replace(/(\w*?)str\./gi, "$1straße");
  // Match standalone "str" or "Str" not part of "straße" already
  result = result.replace(/(\w*?)str(?=\s|$)/gi, "$1straße");
  // Match "pl." or "Pl." in compound words: "Rosenkavalierpl." → "Rosenkavalierplatz"
  result = result.replace(/(\w*?)pl\./gi, "$1platz");
  // Match standalone "pl" or "Pl" not part of "platz"
  result = result.replace(/(\w*?)pl(?=\s|$)/gi, "$1platz");
  // Capitalize first letter of each word (Unicode-safe)
  result = result.replace(/(^|\s)(\p{L})/gu, (_, space, letter) => space + letter.toLocaleUpperCase());
  return result;
}

function coordDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 111320;
  const dlat = lat1 - lat2;
  const dlng = (lng1 - lng2) * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
  return R * Math.sqrt(dlat * dlat + dlng * dlng);
}

/** Returns true if two store names likely refer to the same brand. */
function isSameBrand(nameA: string, nameB: string): boolean {
  if (!nameA || !nameB) return false;
  const a = nameA.toLowerCase();
  const b = nameB.toLowerCase();
  if (a === b) return true;
  return a.includes(b) || b.includes(a);
}

type MergeGroup = {
  entries: PoiRecord[];
  bestName: string;
  bestAddress: string;
  bestLat: number;
  bestLng: number;
  mergedSources: string[];
  mergedExternalIds: string[];
};

function buildMergeGroup(entries: PoiRecord[]): MergeGroup {
  const hasGoogleGrid = entries.some((e) => e.source.includes("google-grid"));

  const bySource = (sourcePart: string) =>
    entries.filter((e) => e.source.includes(sourcePart));

  const preferred = hasGoogleGrid ? bySource("google-grid") : [];
  const fallback = hasGoogleGrid
    ? entries.filter((e) => !e.source.includes("google-grid"))
    : entries;

  const pick = <T>(getter: (e: PoiRecord) => T): T => {
    for (const pool of [preferred, fallback]) {
      for (const e of pool) {
        const val = getter(e);
        if (val !== null && val !== undefined && val !== "") return val;
      }
    }
    return getter(entries[0]!);
  };

  const bestName = pick((e) => e.name);
  const bestAddress = pick((e) => {
    if (!e.address) return "";
    return expandAbbreviations(e.address);
  });

  let bestLat: number;
  let bestLng: number;
  if (preferred.length > 0) {
    bestLat = preferred[0]!.latitude;
    bestLng = preferred[0]!.longitude;
  } else {
    bestLat = fallback[0]!.latitude;
    bestLng = fallback[0]!.longitude;
  }

  const mergedSources = [...new Set(entries.flatMap((e) => e.source))].sort();
  const mergedExternalIds = [
    ...new Set(
      entries.map((e) => e.externalId).filter((id): id is string => id !== null),
    ),
  ].sort();

  return { entries, bestName, bestAddress, bestLat, bestLng, mergedSources, mergedExternalIds };
}

function main() {
  const rows = database
    .query("SELECT * FROM pois WHERE category = 'supermarket'")
    .all() as Record<string, unknown>[];

  const pois: PoiRecord[] = rows.map((r) => ({
    id: Number(r.id),
    category: String(r.category) as StandardPoiCategory,
    subcategory: String(r.subcategory ?? ""),
    name: String(r.name),
    address: String(r.address),
    isActive: Boolean(r.is_active),
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    source: JSON.parse(String(r.source)),
    externalId: r.external_id === null ? null : String(r.external_id),
    tags: JSON.parse(String(r.tags_json ?? "[]")),
    note: String(r.note ?? ""),
  }));

  console.log(`Read ${pois.length} supermarket POIs from DB`);

  // ── Step 1: Group by lowercased name ──
  const nameGroups = new Map<string, PoiRecord[]>();
  for (const poi of pois) {
    const key = poi.name.toLowerCase();
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key)!.push(poi);
  }

  // ── Step 2: Within each name group, cluster by coordinate proximity (< 100m) ──
  // This catches cases where one entry has an address and another doesn't
  const nameClusters: PoiRecord[][] = [];
  for (const [, group] of nameGroups) {
    const remaining = [...group];
    while (remaining.length > 0) {
      const seed = remaining.shift()!;
      const cluster = [seed];
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (coordDistance(seed.latitude, seed.longitude, remaining[i]!.latitude, remaining[i]!.longitude) < 100) {
          cluster.push(remaining[i]!);
          remaining.splice(i, 1);
        }
      }
      nameClusters.push(cluster);
    }
  }

  // ── Step 3: Cross-name merging — merge same-location clusters
  //            with similar names (e.g. "Rewe" + "REWE City")
  //            Group all nameClusters by coordinate proximity first ──
  const locationGroups: PoiRecord[][] = [];
  const remainingClusters = [...nameClusters];
  while (remainingClusters.length > 0) {
    const seed = remainingClusters.shift()!;
    const group = [...seed];
    for (let i = remainingClusters.length - 1; i >= 0; i--) {
      if (
        coordDistance(
          seed[0]!.latitude, seed[0]!.longitude,
          remainingClusters[i]![0]!.latitude, remainingClusters[i]![0]!.longitude,
        ) < 100 &&
        isSameBrand(seed[0]!.name, remainingClusters[i]![0]!.name)
      ) {
        group.push(...remainingClusters[i]!);
        remainingClusters.splice(i, 1);
      }
    }
    locationGroups.push(group);
  }

  const mergedClusters: PoiRecord[][] = [];
  for (const group of locationGroups) {
    // Check if any pair within this group are close enough to be the same store
    // If all entries are < 100m from each other, merge all
    if (group.length <= 1) {
      mergedClusters.push(group);
      continue;
    }
    // Use single-linkage clustering: merge entries one by one within 100m
    const entries = [...group];
    const done = new Set<number>();
    const merged: PoiRecord[] = [];
    while (entries.length > 0) {
      const seed = entries.shift()!;
      if (done.has(seed.id)) continue;
      const cluster = [seed];
      done.add(seed.id);
      for (let i = entries.length - 1; i >= 0; i--) {
        if (
          !done.has(entries[i]!.id) &&
          coordDistance(seed.latitude, seed.longitude, entries[i]!.latitude, entries[i]!.longitude) < 100
        ) {
          cluster.push(entries[i]!);
          done.add(entries[i]!.id);
          entries.splice(i, 1);
        }
      }
      // Re-merge any remaining entries against the expanded cluster
      for (let i = entries.length - 1; i >= 0; i--) {
        for (const ref of cluster) {
          if (
            !done.has(entries[i]!.id) &&
            coordDistance(ref.latitude, ref.longitude, entries[i]!.latitude, entries[i]!.longitude) < 100
          ) {
            cluster.push(entries[i]!);
            done.add(entries[i]!.id);
            entries.splice(i, 1);
            break;
          }
        }
      }
      merged.push(...cluster);
    }
    mergedClusters.push(merged);
  }

  console.log(
    `Found ${mergedClusters.length} unique stores (${pois.length - mergedClusters.length} entries merged away)`,
  );

  // ── Step 4: Build output ──
  const merged: CleanedEntry[] = [];
  let mergedCount = 0;
  let standaloneCount = 0;

  for (const cluster of mergedClusters) {
    if (cluster.length === 1) {
      const poi = cluster[0]!;
      merged.push({
        name: poi.name,
        chain: poi.subcategory || poi.name,
        address: expandAbbreviations(poi.address),
        latitude: poi.latitude,
        longitude: poi.longitude,
        sources: poi.source,
        externalIds: poi.externalId ? [poi.externalId] : [],
        placeId: null,
      });
      standaloneCount++;
    } else {
      const group = buildMergeGroup(cluster);
      merged.push({
        name: group.bestName,
        chain: group.entries[0]!.subcategory || group.bestName,
        address: group.bestAddress,
        latitude: group.bestLat,
        longitude: group.bestLng,
        sources: group.mergedSources,
        externalIds: group.mergedExternalIds,
        placeId: null,
      });
      mergedCount++;
      console.log(
        `  Merged ${group.entries.length} → "${group.bestName}" @ ${group.bestAddress}` +
        ` [${group.mergedSources.join(", ")}]` +
        ` ext_ids: ${group.mergedExternalIds.join(", ") || "none"}`,
      );
    }
  }

  const payload = {
    location: "Munich, Germany",
    source: "merged",
    scrapedAt: new Date().toISOString(),
    count: merged.length,
    supermarkets: merged,
  };

  Bun.write(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${merged.length} entries to ${OUTPUT_PATH}`);
  console.log(`  Standalone: ${standaloneCount}`);
  console.log(`  Merged: ${mergedCount}`);
}

main();
