#!/usr/bin/env bun

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ChainConfig = {
  osmShop: string;
  searchTerm: string;
};

const POI_CHAINS: Record<string, ChainConfig> = {
  // Lidl: { osmShop: "supermarket", searchTerm: "supermarket" },
  // Rewe: { osmShop: "supermarket", searchTergem: "supermarket" },
  // Aldi: { osmShop: "supermarket", searchTerm: "supermarket" },
  // Penny: { osmShop: "supermarket", searchTerm: "supermarket" },
  // Netto: { osmShop: "supermarket", searchTerm: "supermarket" },
  // Kaufland: { osmShop: "supermarket", searchTerm: "supermarket" },
  // Edeka: { osmShop: "supermarket", searchTerm: "supermarket" },
  dm: { osmShop: "chemist", searchTerm: "drugstore" },
  Rossmann: { osmShop: "chemist", searchTerm: "drugstore" },
};

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const NOMINATIM_ENDPOINT = "https://nominatim.openstreetmap.org/search";

type Source = "osm" | "google-grid" | "both";

type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

type PoiRecord = {
  name: string | null;
  chain: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  osmId: string | null;
  source: string;
};

type CliArgs = {
  location: string;
  output: string;
  source: Source;
  headless: boolean;
  grid: number;
  chain: string | null;
};

const DEFAULT_LOCATION = "Munich, Germany";
const DEFAULT_OUTPUT = "supermarkets.json";
const DEFAULT_SOURCE: Source = "both";
const DEFAULT_GRID = 3;

function parseArgs(argv: string[]) {
  const result: CliArgs = {
    location: DEFAULT_LOCATION,
    output: DEFAULT_OUTPUT,
    source: DEFAULT_SOURCE,
    headless: false,
    grid: DEFAULT_GRID,
    chain: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--location" || arg === "-l") {
      result.location = argv[++i];
      if (!result.location) throw new Error(`Missing value for ${arg}`);
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      result.output = argv[++i];
      if (!result.output) throw new Error(`Missing value for ${arg}`);
      continue;
    }
    if (arg === "--source" || arg === "-s") {
      const value = argv[++i];
      if (!value || !["osm", "google-grid", "both"].includes(value)) {
        throw new Error(
          `Invalid source: ${value}. Must be: osm, google-grid, both`,
        );
      }
      result.source = value as Source;
      continue;
    }
    if (arg === "--grid") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${arg}`);
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 6) {
        throw new Error(
          `Invalid grid size: ${value}. Must be between 1 and 6.`,
        );
      }
      result.grid = Math.floor(parsed);
      continue;
    }
    if (arg === "--chain" || arg === "-c") {
      result.chain = argv[++i];
      if (!result.chain) throw new Error(`Missing value for ${arg}`);
      const normalized = result.chain.toLowerCase();
      const matched = Object.keys(POI_CHAINS).find(
        (k) => k.toLowerCase() === normalized,
      );
      if (!matched) {
        throw new Error(
          `Unknown chain: "${result.chain}". Available: ${Object.keys(POI_CHAINS).join(", ")}`,
        );
      }
      result.chain = matched;
      continue;
    }
    if (arg === "--headless") {
      result.headless = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit();
    }
  }

  return result;
}

function printHelpAndExit(): never {
  const chains = Object.keys(POI_CHAINS).join(", ");
  console.log(
    `
Usage:
  bun scripts/get-supermarkets.ts [options]

Collects POI locations (supermarkets, drugstores, etc.) from
OpenStreetMap (Overpass API) and/or Google Maps (Playwright grid search).
Results are merged and deduplicated.

Sources:
  osm         Query OSM Overpass API (fast, no browser needed)
  google-grid Grid-based Google Maps scrape via Playwright (slower, more complete)
  both        Run OSM first, then supplement with Google Maps grid (default)

Options:
  -l, --location <text>   City and country (default: "Munich, Germany")
  -o, --output <path>     Output JSON file path (default: "supermarkets.json")
  -s, --source <mode>     Data source: osm, google-grid, both (default: both)
      --grid <n>          Grid size for Google Maps search (default: 3, gives n×n cells)
  -c, --chain <name>      Only search for this chain (default: all). Case-insensitive.
      --headless          Run Playwright headless
  -h, --help              Show this help

Supported chains: ${chains}

Examples:
  bun scripts/get-supermarkets.ts
  bun scripts/get-supermarkets.ts -l "Berlin, Germany" -o berlin.json
  bun scripts/get-supermarkets.ts -s osm -l "Hamburg, Germany"
  bun scripts/get-supermarkets.ts -c Rossmann -s osm -o rossmann.json
  bun scripts/get-supermarkets.ts -c dm -s osm -o dm.json
`.trim(),
  );
  process.exit(0);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(minMs = 600, maxMs = 2000) {
  await sleep(randomInt(minMs, maxMs));
}

function getActiveChains(chainFilter: string | null): string[] {
  const all = Object.keys(POI_CHAINS);
  if (!chainFilter) return all;
  const normalized = chainFilter.toLowerCase();
  const match = all.find((k) => k.toLowerCase() === normalized);
  return match ? [match] : [];
}

function detectChain(
  name: string | null,
  chainFilter: string | null,
): string | null {
  if (!name) return null;
  const upper = name.toUpperCase();
  const active = getActiveChains(chainFilter);
  for (const chain of active) {
    if (upper.includes(chain.toUpperCase())) return chain;
  }
  return null;
}

function getViewport(): { width: number; height: number } {
  const sizes = [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ];
  return sizes[randomInt(0, sizes.length - 1)];
}

function deduplicateByCoord(records: PoiRecord[], precision = 5): PoiRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    if (r.latitude == null || r.longitude == null) return true;
    const key = `${r.latitude.toFixed(precision)},${r.longitude.toFixed(precision)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Nominatim geocoding ────────────────────────────────────────────

async function geocodeLocation(location: string): Promise<BoundingBox> {
  console.log(`Geocoding "${location}" via Nominatim...`);

  const url = `${NOMINATIM_ENDPOINT}?q=${encodeURIComponent(location)}&format=json&limit=1&addressdetails=0`;
  const response = await fetch(url, {
    headers: { "User-Agent": "rokum-supermarket-scraper/1.0" },
  });

  if (!response.ok) throw new Error(`Nominatim HTTP ${response.status}`);

  const data = (await response.json()) as Array<{ boundingbox: string[] }>;
  if (!data.length)
    throw new Error(`Could not geocode location: "${location}"`);

  const bb = data[0]!.boundingbox;
  const bbox: BoundingBox = {
    minLat: parseFloat(bb[0]!),
    maxLat: parseFloat(bb[1]!),
    minLng: parseFloat(bb[2]!),
    maxLng: parseFloat(bb[3]!),
  };

  console.log(
    `  Bounding box: ${bbox.minLat.toFixed(4)},${bbox.minLng.toFixed(4)} → ${bbox.maxLat.toFixed(4)},${bbox.maxLng.toFixed(4)}`,
  );
  return bbox;
}

// ─── OSM Overpass collection ────────────────────────────────────────

function buildOverpassQuery(
  bbox: BoundingBox,
  chainFilter: string | null,
): string {
  const active = getActiveChains(chainFilter);

  // Group chain names by their OSM shop tag
  const byTag = new Map<string, string[]>();
  for (const chain of active) {
    const config = POI_CHAINS[chain]!;
    const existing = byTag.get(config.osmShop) ?? [];
    existing.push(chain);
    byTag.set(config.osmShop, existing);
  }

  let lines: string[] = [];
  for (const [shopTag, chains] of byTag) {
    const pattern = chains.join("|");
    lines.push(
      `  nwr["shop"="${shopTag}"]["brand"~"${pattern}",i](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});`,
    );
    lines.push(
      `  nwr["shop"="${shopTag}"]["operator"~"${pattern}",i](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});`,
    );
    lines.push(
      `  nwr["shop"="${shopTag}"]["name"~"${pattern}",i](${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng});`,
    );
  }

  return `[out:json][timeout:60];\n(\n${lines.join("\n")}\n);\nout center;`;
}

async function queryOverpass(
  query: string,
  maxRetries = 5,
): Promise<PoiRecord[]> {
  console.log("  Querying Overpass API...");

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      const waitMs = Math.min(5000 * 2 ** attempt, 60000);
      console.log(
        `  Rate limited, retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`,
      );
      await sleep(waitMs + randomInt(0, 3000));
    }

    const response = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
    });

    if (response.ok) {
      const json = (await response.json()) as {
        elements: Array<{
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          center?: { lat: number; lon: number };
          tags?: Record<string, string>;
        }>;
      };

      const records: PoiRecord[] = [];
      const seenIds = new Set<number>();

      for (const el of json.elements) {
        if (seenIds.has(el.id)) continue;
        seenIds.add(el.id);

        const tags = el.tags ?? {};
        const name = tags.name ?? null;
        const chainName =
          detectChain(name, null) ??
          detectChain(tags.brand ?? tags.operator ?? null, null) ??
          null;
        if (!chainName) continue;

        const lat = el.lat ?? el.center?.lat ?? null;
        const lon = el.lon ?? el.center?.lon ?? null;

        const street = tags["addr:street"] ?? null;
        const housenumber = tags["addr:housenumber"] ?? null;
        let address = null;
        if (street && housenumber) address = `${street} ${housenumber}`;
        else if (street) address = street;

        records.push({
          name,
          chain: chainName,
          address,
          latitude: lat,
          longitude: lon,
          placeId: null,
          osmId: `${el.type}/${el.id}`,
          source: "osm",
        });
      }

      return records;
    }

    if (response.status === 429) {
      lastError = new Error("Rate limited");
      continue;
    }

    const text = await response.text().catch(() => "");
    throw new Error(
      `Overpass HTTP ${response.status}: ${text.substring(0, 200)}`,
    );
  }

  throw lastError ?? new Error("Overpass query failed after retries");
}

async function collectFromOsm(
  bbox: BoundingBox,
  chainFilter: string | null,
): Promise<PoiRecord[]> {
  console.log("\n── OSM Overpass ──");

  const query = buildOverpassQuery(bbox, chainFilter);
  const records = await queryOverpass(query);
  console.log(`  Found ${records.length} chain POIs`);

  return records;
}

// ─── Google Maps grid collection ────────────────────────────────────

function buildGridCells(
  bbox: BoundingBox,
  grid: number,
): Array<{ lat: number; lng: number }> {
  const cells: Array<{ lat: number; lng: number }> = [];
  const latStep = (bbox.maxLat - bbox.minLat) / grid;
  const lngStep = (bbox.maxLng - bbox.minLng) / grid;

  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      cells.push({
        lat: bbox.minLat + latStep * (row + 0.5),
        lng: bbox.minLng + lngStep * (col + 0.5),
      });
    }
  }

  return cells;
}

async function handleConsentPage(page: any) {
  const currentUrl = page.url();
  if (!currentUrl.includes("consent.google.com")) return false;

  console.log("  Consent page detected, accepting...");
  await page.waitForTimeout(randomInt(1000, 2500));

  const acceptAll = page
    .getByRole("button", { name: /Accept all|Alle akzeptieren/i })
    .first();
  if (await acceptAll.isVisible().catch(() => false)) {
    await humanDelay(500, 1200);
    await acceptAll.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(randomInt(3000, 5000));
    console.log("  Consent accepted");
    return true;
  }

  return false;
}

async function ensureOnMapsPage(page: any) {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!page.url().includes("consent.google.com")) return;
    await handleConsentPage(page);
    await page.waitForTimeout(randomInt(2000, 4000));
  }
  if (page.url().includes("consent.google.com")) {
    throw new Error("Could not bypass Google consent page");
  }
}

async function searchCell(
  page: any,
  center: { lat: number; lng: number },
  searchTerm: string,
  chainFilter: string | null,
): Promise<PoiRecord[]> {
  const query = `${searchTerm}+near+${center.lat.toFixed(4)},${center.lng.toFixed(4)}`;
  const searchUrl = `https://www.google.com/maps/search/${query}/@${center.lat.toFixed(6)},${center.lng.toFixed(6)},13z`;
  console.log(
    `  Cell ${center.lat.toFixed(4)},${center.lng.toFixed(4)} [${searchTerm}]`,
  );

  await humanDelay(1500, 3500);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(randomInt(2500, 4500));

  await ensureOnMapsPage(page);

  const results: PoiRecord[] = [];
  const seenIds = new Set<string>();
  let staleRounds = 0;
  let previousCount = 0;

  const feed = page.locator('div[role="feed"]');
  try {
    await feed.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  } catch {}

  if (await feed.isVisible().catch(() => false)) {
    await feed.evaluate((el: Element) => {
      (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
    });
    await humanDelay(2000, 4000);
  }

  while (staleRounds < 5) {
    const cards = page.locator(".Nv2PK");
    const cardCount = await cards.count();

    for (let i = 0; i < cardCount; i++) {
      const cardData = await cards.nth(i).evaluate((card: Element) => {
        const link = card.querySelector<HTMLAnchorElement>("a.hfpxzc");
        const href = link?.href ?? "";

        const name =
          card.querySelector<HTMLElement>(".qBF1Pd")?.textContent?.trim() ??
          card.querySelector<HTMLElement>(".NrDZNb")?.textContent?.trim() ??
          link?.getAttribute("aria-label") ??
          null;

        const placeIdMatch = href.match(/!19s([^!?&]+)/);
        const placeId = placeIdMatch
          ? decodeURIComponent(placeIdMatch[1]!)
          : null;

        const coordMatch = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
        const latitude = coordMatch ? parseFloat(coordMatch[1]!) : null;
        const longitude = coordMatch ? parseFloat(coordMatch[2]!) : null;

        let address: string | null = null;
        const groups = card.querySelectorAll<HTMLElement>(".W4Efsd");
        for (const group of groups) {
          const text = group.textContent ?? "";
          if (/\d+\.\d+\(/.test(text)) continue;
          if (/Open|Closed|Closes|Opens/i.test(text)) continue;
          const spans = group.querySelectorAll("span span");
          for (const span of spans) {
            const t = span.textContent?.trim() ?? "";
            if (
              t.length > 5 &&
              /[A-Za-z]/.test(t) &&
              /[\d,]/.test(t) &&
              !/·/.test(t) &&
              !/^\d+$/.test(t)
            ) {
              address = t;
              break;
            }
          }
          if (address) break;
        }

        return { name, href, placeId, latitude, longitude, address };
      });

      if (!cardData.placeId || seenIds.has(cardData.placeId)) continue;
      seenIds.add(cardData.placeId);

      const chain = detectChain(cardData.name, chainFilter);
      if (!chain) continue;

      results.push({
        name: cardData.name,
        chain,
        address: cardData.address,
        latitude: cardData.latitude,
        longitude: cardData.longitude,
        placeId: cardData.placeId,
        osmId: null,
        source: "google-grid",
      });
    }

    if (results.length === previousCount) {
      staleRounds++;
    } else {
      staleRounds = 0;
    }
    previousCount = results.length;

    if (staleRounds >= 5) break;

    if (await feed.isVisible().catch(() => false)) {
      await feed.evaluate((el: Element) => {
        (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight;
      });
      await humanDelay(1500, 3000);
    }
  }

  console.log(`    → ${results.length} chain POIs`);
  return results;
}

async function collectFromGoogleGrid(
  bbox: BoundingBox,
  headless: boolean,
  grid: number,
  chainFilter: string | null,
): Promise<PoiRecord[]> {
  console.log("\n── Google Maps Grid ──");

  const cells = buildGridCells(bbox, grid);
  console.log(`  Grid: ${grid}×${grid} = ${cells.length} cells`);

  // Collect unique search terms from active chains
  const active = getActiveChains(chainFilter);
  const searchTerms = new Set<string>();
  for (const chain of active) {
    searchTerms.add(POI_CHAINS[chain]!.searchTerm);
  }
  const terms = [...searchTerms];
  console.log(`  Search terms: ${terms.join(", ")}`);

  let chromium: any;
  try {
    ({ chromium } = (await import("playwright")) as any);
  } catch {
    throw new Error("Playwright is not installed. Run `bun add playwright`.");
  }

  const runtimeDir = mkdtempSync(join(tmpdir(), "gmaps-grid-"));
  const homeDir = join(runtimeDir, "home");
  const cacheDir = join(runtimeDir, "cache");
  const configDir = join(runtimeDir, "config");
  const dataDir = join(runtimeDir, "data");

  for (const dir of [homeDir, cacheDir, configDir, dataDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const viewport = getViewport();
  const browser = await chromium.launch({
    headless,
    chromiumSandbox: false,
    env: {
      ...process.env,
      HOME: homeDir,
      XDG_CACHE_HOME: cacheDir,
      XDG_CONFIG_HOME: configDir,
      XDG_DATA_HOME: dataDir,
    },
    args: [
      "--disable-crash-reporter",
      "--disable-crashpad",
      "--noerrdialogs",
      `--window-size=${viewport.width},${viewport.height}`,
    ],
  });

  try {
    const context = await browser.newContext({
      viewport,
      locale: "en-GB",
      timezoneId: "Europe/Berlin",
      permissions: ["geolocation"],
      geolocation: {
        latitude: (bbox.minLat + bbox.maxLat) / 2,
        longitude: (bbox.minLng + bbox.maxLng) / 2,
      },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    page.setDefaultNavigationTimeout(45000);
    page.setDefaultTimeout(15000);

    const allResults = new Map<string, PoiRecord>();

    for (let i = 0; i < cells.length; i++) {
      if (i > 0) await humanDelay(3000, 6000);
      for (const term of terms) {
        const records = await searchCell(page, cells[i]!, term, chainFilter);
        for (const r of records) {
          if (r.placeId && !allResults.has(r.placeId)) {
            allResults.set(r.placeId, r);
          }
        }
      }
    }

    return [...allResults.values()];
  } finally {
    await browser.close();
    rmSync(runtimeDir, { recursive: true, force: true });
  }
}

// ─── Main ───────────────────────────────────────────────────────────

function printResults(records: PoiRecord[], label: string) {
  console.log(`\n=== ${label} (${records.length} locations) ===`);
  for (const r of records) {
    console.log(
      `  ${r.name ?? "?"} [${r.chain ?? "-"}] @${r.latitude?.toFixed(5) ?? "?"},${r.longitude?.toFixed(5) ?? "?"} ${r.address ? `- ${r.address}` : ""} (${r.source})`,
    );
  }
}

function printSummary(records: PoiRecord[]) {
  const chainCounts = new Map<string, number>();
  for (const r of records) {
    const key = r.chain ?? "unknown";
    chainCounts.set(key, (chainCounts.get(key) ?? 0) + 1);
  }
  console.log("\nBreakdown by chain:");
  for (const [chain, count] of [...chainCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${chain}: ${count}`);
  }

  const withCoords = records.filter((r) => r.latitude !== null).length;
  const withAddress = records.filter((r) => r.address).length;
  const sources = new Set(records.map((r) => r.source));
  console.log(`\nResults with coordinates: ${withCoords}/${records.length}`);
  console.log(`Results with address: ${withAddress}/${records.length}`);
  console.log(`Sources: ${[...sources].join(", ")}`);
}

async function main() {
  const args = parseArgs(Bun.argv.slice(2));

  console.log(`Location: ${args.location}`);
  console.log(`Source: ${args.source}`);
  if (args.chain) console.log(`Chain filter: ${args.chain}`);
  if (args.source === "google-grid" || args.source === "both") {
    console.log(`Grid: ${args.grid}×${args.grid}`);
  }

  const bbox = await geocodeLocation(args.location);

  // Rate-limit courtesy pause after Nominatim
  await sleep(1000);

  let allRecords = new Map<string, PoiRecord>();

  if (args.source === "osm" || args.source === "both") {
    const osmRecords = await collectFromOsm(bbox, args.chain);

    const deduped = deduplicateByCoord(osmRecords);
    if (deduped.length < osmRecords.length) {
      console.log(
        `  (${osmRecords.length - deduped.length} deduplicated by coordinate)`,
      );
    }

    for (const r of deduped) {
      const key = r.osmId ?? `${r.latitude},${r.longitude}`;
      allRecords.set(key, r);
    }
  }

  if (args.source === "google-grid" || args.source === "both") {
    const googleRecords = await collectFromGoogleGrid(
      bbox,
      args.headless,
      args.grid,
      args.chain,
    );

    for (const r of googleRecords) {
      const key = r.placeId ?? `${r.latitude},${r.longitude}`;
      if (!allRecords.has(key)) {
        allRecords.set(key, r);
      }
    }
  }

  let finalResults = [...allRecords.values()];

  // Final dedup by coordinate across merged sources
  const before = finalResults.length;
  finalResults = deduplicateByCoord(finalResults);
  if (finalResults.length < before) {
    console.log(
      `\nMerged: ${before} → ${finalResults.length} after cross-source dedup`,
    );
  }

  printResults(
    finalResults,
    args.source === "both" ? "Merged Results" : "Results",
  );

  const payload = {
    location: args.location,
    source: args.source,
    grid: args.grid,
    chain: args.chain,
    scrapedAt: new Date().toISOString(),
    count: finalResults.length,
    supermarkets: finalResults,
  };

  await Bun.write(args.output, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${finalResults.length} entries to ${args.output}`);

  printSummary(finalResults);
}

await main();
