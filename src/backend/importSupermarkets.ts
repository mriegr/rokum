import { createDatabase } from "./db";
import { loadConfig } from "../shared/config";

const config = loadConfig();
const database = createDatabase(config);

const jsonPath = "data/sources/supermarkets.json";
const file = Bun.file(jsonPath);
if (!(await file.exists())) {
  console.error(`File not found: ${jsonPath}`);
  process.exit(1);
}

const data = await file.json();
const supermarkets: Array<{
  name: string | null;
  chain: string;
  address: string | null;
  latitude: number;
  longitude: number;
  placeId: null;
  osmId: string | null;
  source: string;
}> = data.supermarkets;

const deleteCount = database
  .query("DELETE FROM pois WHERE category = 'supermarket'")
  .run();
console.log(`Deleted ${deleteCount.changes} existing supermarkets`);

const stmt = database.query(`
  INSERT OR IGNORE INTO pois (
    category, subcategory, name, address, is_active, latitude, longitude, source, external_id, tags_json, note, created_at
  ) VALUES ('supermarket', ?1, ?2, ?3, 1, ?4, ?5, ?6, ?7, '[]', ?8, ?9)
`);

let imported = 0;
let skipped = 0;
const now = new Date().toISOString();

for (const s of supermarkets) {
  const subcategory = s.chain;
  const name = s.name ?? "";
  const address = s.address ?? "";
  const source = s.source ?? "unknown";
  const externalId = s.osmId ?? null;
  const note = s.osmId ?? "";

  const result = stmt.run(subcategory, name, address, s.latitude, s.longitude, source, externalId, note, now);
  if (result.changes > 0) {
    imported++;
  } else {
    skipped++;
  }
}

console.log(`Imported ${imported} supermarkets${skipped > 0 ? `, skipped ${skipped} duplicates` : ""}`);
