#!/usr/bin/env bun

import { existsSync, rmSync } from "node:fs";
import { loadConfig } from "../src/config";
import { createDatabase } from "../src/db";
import { fetchMunichUbahnRoutes } from "../src/services";
import { getTransitOverlayCachePath } from "../src/transitOverlayCache";

type CliArgs = {
  refresh: boolean;
};

function parseArgs(argv: string[]) {
  const result: CliArgs = {
    refresh: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--refresh" || arg === "-r") {
      result.refresh = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  return result;
}

function printHelpAndExit(): never {
  console.log(`
Usage:
  bun scripts/cache-transit-overlay.ts [options]

Options:
  -r, --refresh              Delete the local cache file before warming
  -h, --help                 Show this help

Examples:
  bun scripts/cache-transit-overlay.ts
  bun scripts/cache-transit-overlay.ts --refresh
`.trim());
  process.exit(0);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const database = createDatabase(config);
  const cachePath = getTransitOverlayCachePath(config);

  if (args.refresh && existsSync(cachePath)) {
    rmSync(cachePath, { force: true });
  }

  console.log(`Warming Munich U-Bahn route cache at ${cachePath}`);
  const routes = await fetchMunichUbahnRoutes(config);

  console.log(`Cached ${routes.length} U-Bahn routes at ${cachePath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
