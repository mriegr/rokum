import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import appShell from "./index.html";
import {
  createDatabase,
  insertApartment,
  insertOrIgnorePoi,
  setApartmentScoring,
  updateApartmentCoordinates,
} from "../backend/db";
import {
  getApartmentMapData,
  getBootstrapPayload,
  searchMapAddressSuggestions,
  serveMapStyle,
  serveMapTile,
  serveMapGlyph,
  serveMapSprite,
  serveMapSource,
} from "../backend/server";
import type { AppConfig, ApartmentScoreSnapshot } from "../shared/types";

const runBrowserTests = process.env.RUN_BROWSER_TESTS === "1";
const browserTest = runBrowserTests ? test : test.skip;
const databasePaths: string[] = [];
const originalFetch = globalThis.fetch;

let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

function createTestConfig(): AppConfig {
  const databasePath = join("/tmp", `rokum-browser-${randomUUID()}.sqlite`);
  databasePaths.push(databasePath);
  return {
    port: 0,
    city: "Munich",
    databasePath,
    uploadDirectory: "/tmp",
    nominatimBaseUrl: "https://example.test",
    overpassBaseUrl: "https://example.test",
    walkingRouterMode: "osrm",
    walkingBaseUrl: "https://example.test",
    walkingFallbackRouterMode: null,
    walkingFallbackBaseUrl: null,
    transitBaseUrl: null,
    transitMode: "heuristic",
    jawgApiKey: "browser-test-token",
    jawgStyleId: "jawg-streets",
  };
}

function createScoringSnapshot(): ApartmentScoreSnapshot {
  return {
    pricePerSqm: 7.2,
    roomScore: 8.1,
    pricePerSqmValue: 18.4,
    standardPoiScores: [],
    customPoiScores: [],
    totalScore: 7.7,
    updatedAt: new Date().toISOString(),
  };
}

function createApp() {
  const config = createTestConfig();
  const database = createDatabase(config);
  const apartmentId = insertApartment(database, {
    address: "Sendlinger Tor 1",
    squareMeters: 72,
    kaltmiete: 1200,
    warmmiete: 1325,
    floorLevel: "3",
    roomCount: 2.5,
    description: "Browser map test listing",
  });
  updateApartmentCoordinates(database, apartmentId, 48.137154, 11.576124);
  setApartmentScoring(database, apartmentId, createScoringSnapshot());
  insertOrIgnorePoi(database, {
    category: "supermarket",
    subcategory: "",
    name: "Fresh Market",
    address: "Valley 1",
    isActive: true,
    latitude: 48.138154,
    longitude: 11.577124,
    source: ["test"],
    externalId: null,
    tags: [],
    note: "",
  });
  insertOrIgnorePoi(database, {
    category: "sport_studio",
    subcategory: "Running",
    name: "Run Club",
    address: "Valley 2",
    isActive: true,
    latitude: 48.139154,
    longitude: 11.578124,
    source: ["test"],
    externalId: null,
    tags: ["Running"],
    note: "",
  });
  insertOrIgnorePoi(database, {
    category: "supermarket",
    subcategory: "organic",
    name: "Bio Market",
    address: "Valley 3",
    isActive: true,
    latitude: 48.147154,
    longitude: 11.586124,
    source: ["test"],
    externalId: null,
    tags: [],
    note: "",
  });
  insertOrIgnorePoi(database, {
    category: "sport_studio",
    subcategory: "Yoga",
    name: "Yoga Loft",
    address: "Valley 4",
    isActive: true,
    latitude: 48.151154,
    longitude: 11.591124,
    source: ["test"],
    externalId: null,
    tags: ["Yoga"],
    note: "",
  });

  return {
    config,
    database,
    serveUpload() {
      return new Response(null, { status: 404 });
    },
  };
}

function installFetchMock() {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith("https://api.jawg.io/places/v1/autocomplete")) {
      return Response.json({
        features: [{
          geometry: { type: "Point", coordinates: [11.5755, 48.1374] },
          properties: {
            label: "Marienplatz 1, 80331 München, Deutschland",
            name: "Marienplatz 1",
          },
        }],
      });
    }

    if (url.startsWith("https://api.jawg.io/styles/")) {
      return Response.json({
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: {
              "background-color": "#eef2f1",
            },
          },
        ],
      });
    }

    if (url.startsWith("https://example.test")) {
      return Response.json({ elements: [] });
    }

    return originalFetch(input as RequestInfo | URL, init);
  }) as typeof fetch;
}

beforeAll(async () => {
  if (!runBrowserTests) {
    return;
  }

  installFetchMock();
  const app = createApp();
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = 20000 + Math.floor(Math.random() * 40000);
    try {
      server = Bun.serve({
        port,
        routes: {
          "/": appShell,
          "/map": appShell,
          "/settings": appShell,
        },
        async fetch(request) {
          const url = new URL(request.url);
          const { pathname } = url;

          if (pathname === "/api/bootstrap") {
            return Response.json(getBootstrapPayload(app as any));
          }

          if (pathname === "/api/poi-icons") {
            return Response.json({ icons: [] });
          }

          if (pathname === "/api/map/style.json") {
            return serveMapStyle(app as any, request.url);
          }

          if (pathname === "/api/map/address-search") {
            return Response.json(
              await searchMapAddressSuggestions(app as any, url.searchParams.get("q") ?? ""),
            );
          }

          const apartmentMapMatch = pathname.match(/^\/api\/apartments\/(\d+)\/map$/);
          if (apartmentMapMatch) {
            const payload = await getApartmentMapData(app as any, Number(apartmentMapMatch[1]));
            return Response.json({
              ...payload,
              poiList: [
                ...payload.poiList,
                {
                  key: "ubahn-station:sendlinger-tor",
                  kind: "ubahn",
                  id: "sendlinger-tor",
                  category: "ubahn",
                  subcategory: "Station",
                  name: "Sendlinger Tor",
                  address: "Lines: U1, U2",
                  latitude: 48.1375,
                  longitude: 11.5765,
                  tags: ["U1", "U2"],
                  walking: { distanceMeters: 180, durationMinutes: 3, source: "osrm" },
                  transit: { distanceMeters: 0, durationMinutes: 1, source: "heuristic" },
                },
              ],
              ubahnStations: [
                {
                  id: "sendlinger-tor",
                  name: "Sendlinger Tor",
                  latitude: 48.1375,
                  longitude: 11.5765,
                  modes: ["U-Bahn"],
                  routeRefs: ["U1", "U2"],
                },
              ],
              ubahnRoutes: [
                {
                  id: "route-u2",
                  name: "U2",
                  ref: "U2",
                  color: "0056b8",
                  paths: [[
                    { latitude: 48.1325, longitude: 11.5615 },
                    { latitude: 48.1375, longitude: 11.5765 },
                    { latitude: 48.1445, longitude: 11.5885 },
                  ]],
                },
              ],
            });
          }

          const mapTileMatch = pathname.match(/^\/api\/map\/tiles\/([a-f0-9]+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
          if (mapTileMatch) {
            const [, assetId, z, x, y] = mapTileMatch;
            return serveMapTile(app as any, assetId!, z!, x!, y!);
          }

          const mapGlyphMatch = pathname.match(
            /^\/api\/map\/glyphs\/([a-f0-9]+)\/([^/]+)\/(\d+-\d+)\.pbf$/,
          );
          if (mapGlyphMatch) {
            const [, assetId, fontstack, range] = mapGlyphMatch;
            return serveMapGlyph(app as any, assetId!, decodeURIComponent(fontstack!), range!);
          }

          const mapSpriteMatch = pathname.match(
            /^\/api\/map\/sprites\/([a-f0-9]+)(\.json|\.png|@2x\.json|@2x\.png)$/,
          );
          if (mapSpriteMatch) {
            const [, assetId, suffix] = mapSpriteMatch;
            return serveMapSprite(
              app as any,
              assetId!,
              suffix as ".json" | ".png" | "@2x.json" | "@2x.png",
            );
          }

          const mapSourceMatch = pathname.match(/^\/api\/map\/sources\/([a-f0-9]+)\.json$/);
          if (mapSourceMatch) {
            return serveMapSource(app as any, mapSourceMatch[1]!);
          }

          return new Response("Not found", { status: 404 });
        },
      });
      break;
    } catch (error) {
      if (error instanceof Error && "code" in error && String((error as { code?: string }).code) === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }

  if (!server) {
    throw new Error("Could not start browser test server");
  }

  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  installFetchMock();
});

afterAll(() => {
  server?.stop(true);
  server = null;
  globalThis.fetch = originalFetch;
  for (const path of databasePaths.splice(0)) {
    rmSync(path, { force: true });
  }
});

browserTest("map view renders without browser console errors", async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
  });

  try {
    const page = await browser.newPage();
    const consoleErrors: string[] = [];
    const requestUrls: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("requestfinished", (request) => {
      requestUrls.push(request.url());
    });

    await page.goto(`${baseUrl}/map`, { waitUntil: "networkidle" });
    await page.locator(".maplibregl-canvas").waitFor();
    expect(await page.locator(".map-sidebar").isVisible()).toBe(true);

    expect(consoleErrors).toEqual([]);
    expect(requestUrls.some((value) => value.includes("/api/map/style.json"))).toBe(true);
    expect(requestUrls.some((value) => value.includes("/api/apartments/1/map"))).toBe(true);

    const addressInput = page.locator("#map-address-input");
    await addressInput.fill("Ma");
    await page.waitForTimeout(350);
    expect(requestUrls.filter((value) => value.includes("/api/map/address-search"))).toHaveLength(0);

    await addressInput.fill("Marienplatz");
    const suggestion = page.getByRole("option", { name: /Marienplatz 1/ });
    await suggestion.waitFor();
    expect(requestUrls.filter((value) => value.includes("/api/map/address-search"))).toHaveLength(1);

    await addressInput.press("Escape");
    expect(await page.locator(".map-address-suggestions").isVisible()).toBe(false);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("map-address-input");

    await addressInput.fill("Marienplatz 1");
    await page.getByRole("option", { name: /Marienplatz 1/ }).waitFor();

    const apartmentMapRequestsBeforeSelection = requestUrls.filter((value) =>
      value.includes("/api/apartments/1/map"),
    ).length;
    await addressInput.press("ArrowDown");
    await addressInput.press("Enter");
    await page.locator(".map-address-selection").waitFor();
    expect(await page.locator(".map-address-selection").textContent()).toContain(
      "Showing searched location",
    );
    expect(await page.locator("#map-address-input").inputValue()).toBe(
      "Marienplatz 1, 80331 München, Deutschland",
    );
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("map-address-input");
    expect(
      requestUrls.filter((value) => value.includes("/api/apartments/1/map")).length,
    ).toBe(apartmentMapRequestsBeforeSelection);

    await page.getByRole("button", { name: "Clear searched address" }).click();
    expect(await page.locator("#map-address-input").inputValue()).toBe("");
    expect(await page.locator(".map-address-selection").count()).toBe(0);
  } finally {
    await browser.close();
  }
});

browserTest("map poi shortlist keeps all markers but allows selecting a list row", async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
  });

  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/map`, { waitUntil: "networkidle" });
    await page.locator(".maplibregl-canvas").waitFor();

    const shortlistRows = page.locator('.poi-list [data-action="select-map-poi"]');
    await page.getByRole("button", { name: "Walk" }).click();
    await shortlistRows.first().waitFor();
    expect(await shortlistRows.count()).toBe(5);
    expect(await page.locator(".poi-group").count()).toBe(3);
    expect((await page.locator(".poi-subcategory").allTextContents()).length).toBeGreaterThan(0);
    await page.locator("#map-poi-category-limit").selectOption("all");
    expect(await page.locator('label[for="map-poi-category-limit"] strong').textContent()).toContain("All");
    await page.locator("#map-poi-max-transit").selectOption("15");
    expect(await page.locator('label[for="map-poi-max-transit"] strong').textContent()).toContain("15 min");
    expect(await shortlistRows.count()).toBeLessThan(5);

    const firstRow = shortlistRows.first();
    await firstRow.click();
    expect(await firstRow.getAttribute("class")).toContain("is-selected");
  } finally {
    await browser.close();
  }
});
