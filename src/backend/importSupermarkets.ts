#!/usr/bin/env bun
/**
 * Replaces supermarket POIs with cleaned, deduplicated data.
 *
 * This script delegates to the canonical seed file.
 * Run the merge script first if you need to regenerate the cleaned data from
 * the current database:
 *   bun scripts/merge-poi-sources.ts
 *
 * Then seed:
 *   bun src/backend/importSupermarkets.ts
 */

import { $ } from "bun";

const seedScript = import.meta.dirname?.includes("scripts")
  ? "./seed-supermarkets.ts"
  : "../scripts/seed-supermarkets.ts";

console.log("Seeding cleaned supermarket data...");
await $`bun ${seedScript}`.text();
