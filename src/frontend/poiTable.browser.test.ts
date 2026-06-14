import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import appShell from "./index.html";
import {
  createDatabase,
  insertApartment,
  setApartmentScoring,
  updateApartmentCoordinates,
} from "../backend/db";
import type { ManagedPoi, PoiManagementPayload } from "../shared/types";

const runBrowserTests = process.env.RUN_BROWSER_TESTS === "1";
const browserTest = runBrowserTests ? test : test.skip;
const databasePaths: string[] = [];
const originalFetch = globalThis.fetch;

let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

function createTestConfig() {
  const databasePath = join("/tmp", `rokum-browser-poi-${randomUUID()}.sqlite`);
  databasePaths.push(databasePath);
  return {
    port: 0,
    city: "Munich" as const,
    databasePath,
    uploadDirectory: "/tmp",
    nominatimBaseUrl: "https://example.test",
    overpassBaseUrl: "https://example.test",
    walkingBaseUrl: "https://example.test",
    transitBaseUrl: null,
    transitMode: "heuristic" as const,
    jawgApiKey: "browser-test-token",
    jawgStyleId: "jawg-streets",
  };
}

function createScoringSnapshot() {
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
    description: "Browser POI test listing",
  });
  updateApartmentCoordinates(database, apartmentId, 48.137154, 11.576124);
  setApartmentScoring(database, apartmentId, createScoringSnapshot());

  return {
    config,
    database,
    serveUpload() {
      return new Response(null, { status: 404 });
    },
  };
}

function generatePois(count: number): ManagedPoi[] {
  const pois: ManagedPoi[] = [];
  const categories: Array<ManagedPoi["category"]> = ["supermarket", "sport_studio", "custom"];
  const subcategories = ["edeka", "rewe", "aldi", "yoga", "boxing", "pilates", "fitness", ""];

  for (let i = 0; i < count; i++) {
    const idx = i % categories.length;
    const category: ManagedPoi["category"] = categories[idx]!;
    const kind = category === "custom" ? "custom" : "standard";
    const subcategory = subcategories[i % subcategories.length]!;
    pois.push({
      id: i + 1,
      kind,
      category,
      categoryLabel: category,
      subcategory,
      name: `Test POI ${i + 1}`,
      address: `Teststrasse ${i + 1}, M\u00fcnchen`,
      isActive: i % 5 !== 0,
      notes: i % 7 === 0 ? `Note for POI ${i + 1}` : "",
      source: kind === "standard" ? ["overpass"] : null,
      tags: category === "sport_studio" ? [subcategory].filter(Boolean) : [],
      latitude: 48.13 + (i % 100) * 0.001,
      longitude: 11.56 + (i % 100) * 0.001,
      createdAt: new Date().toISOString(),
      updatedAt: null,
    });
  }
  return pois;
}

function installFetchMock(pois: ManagedPoi[]) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.startsWith("https://example.test")) {
      return Response.json({ elements: [] });
    }

    return originalFetch(input as RequestInfo | URL, init);
  }) as typeof fetch;
}

const POI_COUNT = 1200;

beforeAll(async () => {
  if (!runBrowserTests) {
    return;
  }

  const app = createApp();
  const pois = generatePois(POI_COUNT);
  installFetchMock(pois);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const port = 20000 + Math.floor(Math.random() * 40000);
    try {
      server = Bun.serve({
        port,
        routes: {
          "/": appShell,
          "/pois": appShell,
          "/map": appShell,
        },
        async fetch(request) {
          const url = new URL(request.url);
          const { pathname } = url;

          if (pathname === "/api/bootstrap") {
            return Response.json({
              apartments: [],
              customPois: [],
              settings: {
                pricePerSqm: 1.3,
                rooms: 0.9,
                supermarket: 1,
                sportStudio: 1,
                customPoi: 1.1,
              },
              mapConfig: {
                available: false,
                unavailableReason: "Map not configured for test.",
                styleUrl: null,
              },
              poiCategoryLabels: [],
            });
          }

          if (pathname === "/api/pois") {
            return Response.json({ pois } satisfies PoiManagementPayload);
          }

          if (pathname === "/api/poi-icons") {
            return Response.json({ icons: [] });
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

afterAll(() => {
  server?.stop(true);
  server = null;
  globalThis.fetch = originalFetch;
  for (const path of databasePaths.splice(0)) {
    rmSync(path, { force: true });
  }
});

browserTest("POI table renders a bounded number of rows with 1200 records", async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(15000);
    const apiRequests: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/api/")) {
        apiRequests.push(request.url());
      }
    });

    await page.goto(`${baseUrl}/pois`, { waitUntil: "networkidle" });
    await page.waitForSelector(".poi-admin-row");

    const initialRowCount = await page.locator(".poi-admin-row").count();
    expect(initialRowCount).toBeLessThan(POI_COUNT);
    expect(initialRowCount).toBeGreaterThan(0);

    const matchedText = await page.locator(".poi-match-count").textContent();
    expect(matchedText).toContain(String(POI_COUNT));

    const poiApiCalls = apiRequests.filter((r) => r.includes("/api/pois") && !r.includes("/api/poi-icons"));
    expect(poiApiCalls.length).toBe(1);

    const viewportHandle = await page.evaluateHandle(() => document.querySelector<HTMLElement>(".poi-table-viewport"));
    expect(viewportHandle.asElement()).not.toBeNull();

    const lastRowText = await page.evaluate(() => {
      const rows = document.querySelectorAll(".poi-admin-row");
      return rows[rows.length - 1]?.textContent ?? "";
    });
    expect(lastRowText).toContain("POI");
    const lastRowNum = parseInt(lastRowText.match(/POI (\d+)/)?.[1] ?? "0", 10);
    expect(lastRowNum).toBeGreaterThan(0);
    expect(lastRowNum).toBeLessThan(POI_COUNT);

    await page.evaluate(() => {
      const vp = document.querySelector<HTMLElement>(".poi-table-viewport");
      if (!vp) return;
      const maxScroll = vp.scrollHeight - vp.clientHeight;
      vp.scrollTop = maxScroll;
      vp.dispatchEvent(new Event("scroll"));
    });

    await page.waitForTimeout(400);

    const afterScroll = await page.evaluate(() => {
      const rows = document.querySelectorAll(".poi-admin-row");
      const lastRow = rows[rows.length - 1]?.textContent ?? "";
      return lastRow;
    });
    expect(afterScroll).toContain("POI 1200");

    expect(apiRequests.filter((r) => r.includes("/api/pois") && !r.includes("/api/poi-icons")).length).toBe(1);

    const lastCheckbox = page.locator('[data-action="toggle-managed-poi"]').last();
    await lastCheckbox.check();
    await page.waitForTimeout(100);

    expect(await page.locator(".poi-selection-bar p").textContent()).toContain("1 selected");

    await page.evaluate(() => {
      const vp = document.querySelector<HTMLElement>(".poi-table-viewport");
      if (vp) {
        vp.scrollTop = 0;
        vp.dispatchEvent(new Event("scroll"));
      }
    });
    await page.waitForTimeout(400);

    const firstRowText = await page.evaluate(() => {
      const rows = document.querySelectorAll(".poi-admin-row");
      return rows[0]?.textContent ?? "";
    });
    expect(firstRowText).toContain("POI 1");
    expect(await page.locator(".poi-selection-bar p").textContent()).toContain("1 selected");

  } finally {
    await browser.close();
  }
}, 30000);

browserTest("select-all updates selection bar and button states without API calls", async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
  });

  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(10000);
    const apiRequests: string[] = [];

    page.on("request", (request) => {
      if (request.url().includes("/api/")) {
        apiRequests.push(request.url());
      }
    });

    await page.goto(`${baseUrl}/pois`, { waitUntil: "networkidle" });
    await page.waitForSelector(".poi-admin-row");

    const selectAllCheckbox = page.locator("#poi-select-all");
    await selectAllCheckbox.check();
    await page.waitForTimeout(100);

    expect(await page.locator(".poi-selection-bar p").textContent()).toContain(
      `${POI_COUNT} selected`,
    );

    const enableSelectedButton = page.locator('[data-action="bulk-poi-status"][data-status="active"]');
    expect(await enableSelectedButton.isEnabled()).toBe(true);

    const editSelectedButton = page.locator('[data-action="edit-selected-poi"]');
    expect(await editSelectedButton.getAttribute("disabled")).not.toBeNull();

    const apiCallsAfterTest = apiRequests.filter(
      (r) => r.includes("/api/pois") && !r.includes("/api/poi-icons"),
    );
    expect(apiCallsAfterTest.length).toBe(1);

  } finally {
    await browser.close();
  }
}, 30000);
