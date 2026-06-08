#!/usr/bin/env bun
/**
 * Reads the cleaned supermarkets JSON file (produced by merge-poi-sources.ts)
 * and replaces all supermarket POIs in the database with the cleaned data.
 * source is stored as a JSON array to track which origins contributed.
 */

import { createDatabase } from "../src/backend/db";
import { loadConfig } from "../src/shared/config";
import type { StandardPoiCategory } from "../src/shared/types";

const config = loadConfig();
const database = createDatabase(config);

const SOURCE_PATH = "data/sources/supermarkets-cleaned.json";

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

const file = Bun.file(SOURCE_PATH);
if (!(await file.exists())) {
  console.error(`File not found: ${SOURCE_PATH}`);
  console.error("Run `bun scripts/merge-poi-sources.ts` first to generate it.");
  process.exit(1);
}

const data = await file.json();
const supermarkets: CleanedEntry[] = data.supermarkets;

if (!supermarkets?.length) {
  console.error("No supermarkets found in the cleaned file.");
  process.exit(1);
}

const deleteCount = database
  .query("DELETE FROM pois WHERE category = 'supermarket'")
  .run();
console.log(`Deleted ${deleteCount.changes} existing supermarkets`);

const stmt = database.query(`
  INSERT INTO pois (
    category, subcategory, name, address, is_active, latitude, longitude,
    source, external_id, tags_json, note, created_at
  ) VALUES ('supermarket', ?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, '[]', ?8, ?9)
`);

const now = new Date().toISOString();
let imported = 0;

for (const s of supermarkets) {
  const subcategory = s.chain;
  const name = s.name;
  const address = s.address;
  const sourceJson = JSON.stringify(s.sources);
  const externalId = s.externalIds.length > 0 ? s.externalIds.join(",") : null;
  const note = s.externalIds.length > 0 ? s.externalIds.join(",") : "";

  stmt.run(subcategory, name, address, s.latitude, s.longitude, sourceJson, externalId, note, now);
  imported++;
}

console.log(`Imported ${imported} cleaned supermarkets`);

// Rescore all apartments since coordinates may have shifted
console.log("Rescoring all apartments...");
const apartmentIds = database
  .query("SELECT id FROM apartments")
  .all() as Array<{ id: number }>;
for (const { id } of apartmentIds) {
  database
    .query("UPDATE apartments SET scoring_payload = NULL, total_score = 0, updated_at = ?1 WHERE id = ?2")
    .run(now, id);
}
console.log(`Invalidated scores for ${apartmentIds.length} apartments (will be rescored on next load)`);
