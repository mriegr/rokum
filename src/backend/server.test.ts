import { afterEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "./db";
import {
  getBootstrapPayload,
  serveMapStyle,
  serveMapTile,
} from "./server";
import type { AppConfig } from "../shared/types";

const originalFetch = globalThis.fetch;
const databasePaths: string[] = [];

function createAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0,
    city: "Munich",
    databasePath: join("/tmp", `rokum-server-${randomUUID()}.sqlite`),
    uploadDirectory: "/tmp",
    nominatimBaseUrl: "https://example.test",
    overpassBaseUrl: "https://example.test",
    walkingBaseUrl: "https://example.test",
    transitBaseUrl: null,
    transitMode: "heuristic",
    jawgApiKey: "secret-token",
    jawgStyleId: "jawg-streets",
    ...overrides,
  };
}

function createApp(overrides: Partial<AppConfig> = {}) {
  return {
    config: createAppConfig(overrides),
    database: null,
    serveUpload() {
      return new Response(null);
    },
  } as any;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
  for (const path of databasePaths.splice(0)) {
    rmSync(path, { force: true });
  }
});

test("bootstrap disables map config when JAWG_API is missing", () => {
  const config = createAppConfig({ jawgApiKey: null });
  databasePaths.push(config.databasePath);
  const payload = getBootstrapPayload({
    config,
    database: createDatabase(config),
  } as any);

  expect(payload.mapConfig).toEqual({
    available: false,
    unavailableReason: "Map API configuration is missing.",
    styleUrl: null,
  });
});

test("style proxy rewrites Jawg asset URLs to local endpoints", async () => {
  globalThis.fetch = mock(async () =>
    Response.json({
      version: 8,
      sources: {
        jawg: {
          type: "vector",
          tiles: [
            "https://tile.jawg.io/streets-v2/{z}/{x}/{y}.pbf?access-token=secret-token",
          ],
        },
      },
      glyphs:
        "https://api.jawg.io/fonts/{fontstack}/{range}.pbf?access-token=secret-token",
      sprite: "https://api.jawg.io/sprites/jawg-streets?access-token=secret-token",
    })
  ) as unknown as typeof fetch;

  const response = await serveMapStyle(createApp(), "http://localhost:3000/api/map/style.json");
  expect(response.status).toBe(200);

  const payload = await response.json();
  expect(payload.sources.jawg.tiles[0]).toMatch(
    /^http:\/\/localhost:3000\/api\/map\/tiles\/[a-f0-9]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/,
  );
  expect(payload.glyphs).toMatch(
    /^http:\/\/localhost:3000\/api\/map\/glyphs\/[a-f0-9]+\/\{fontstack\}\/\{range\}\.pbf$/,
  );
  expect(payload.sprite).toMatch(/^http:\/\/localhost:3000\/api\/map\/sprites\/[a-f0-9]+$/);
  expect(JSON.stringify(payload)).not.toContain("secret-token");
  expect(JSON.stringify(payload)).not.toContain("https://tile.jawg.io");
});

test("tile proxy deduplicates concurrent upstream requests", async () => {
  let upstreamCalls = 0;
  const seenUrls: string[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    upstreamCalls += 1;
    const url = String(input);
    seenUrls.push(url);
    if (url.includes("/styles/")) {
      return Response.json({
        version: 8,
        sources: {
          jawg: {
            type: "vector",
            tiles: ["https://tile.jawg.io/streets-v2/{z}/{x}/{y}.pbf"],
          },
        },
      });
    }

    return new Response(new Uint8Array([1, 2, 3]), {
      headers: {
        "Content-Type": "application/x-protobuf",
        "Cache-Control": "public, max-age=120",
      },
    });
  }) as unknown as typeof fetch;

  const styleResponse = await serveMapStyle(
    createApp(),
    "http://localhost:3000/api/map/style.json",
  );
  const payload = await styleResponse.json();
  const tileUrl = String(payload.sources.jawg.tiles[0]);
  const assetId = tileUrl.match(/^http:\/\/localhost:3000\/api\/map\/tiles\/([a-f0-9]+)\//)?.[1];

  expect(assetId).toBeTruthy();

  const [first, second] = await Promise.all([
    serveMapTile(createApp(), assetId!, "12", "2140", "1408"),
    serveMapTile(createApp(), assetId!, "12", "2140", "1408"),
  ]);

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.headers.get("cache-control")).toBe("public, max-age=120");
  expect(upstreamCalls).toBe(2);
  expect(seenUrls.some((url) => url.includes("/12/2140/1408.pbf"))).toBe(true);
});

test("style proxy returns 503 when the map API is not configured", async () => {
  const response = await serveMapStyle(
    createApp({ jawgApiKey: null }),
    "http://localhost:3000/api/map/style.json",
  );
  expect(response.status).toBe(503);
});
