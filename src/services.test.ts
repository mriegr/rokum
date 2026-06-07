import { afterEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fetchTransitMapOverlay } from "./services";
import type { AppConfig } from "./types";

const originalFetch = globalThis.fetch;

function createConfig(): AppConfig {
  return {
    port: 0,
    city: "Munich",
    databasePath: `/tmp/rokum-services-${randomUUID()}.sqlite`,
    uploadDirectory: "/tmp",
    nominatimBaseUrl: "https://example.test",
    overpassBaseUrl: `https://overpass-${randomUUID()}.example.test`,
    walkingBaseUrl: "https://example.test",
    transitBaseUrl: null,
    transitMode: "heuristic",
    jawgApiKey: null,
    jawgStyleId: "jawg-streets",
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

test("fetchTransitMapOverlay normalizes ubahn route colors for map rendering", async () => {
  const config = createConfig();
  let requestCount = 0;

  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    requestCount += 1;
    const body = String(init?.body ?? "");

    if (body.includes('relation["route"="subway"]')) {
      return Response.json({
        elements: [
          {
            type: "relation",
            id: 200,
            tags: {
              route: "subway",
              ref: "U2",
              name: "U2",
              colour: "0056b8",
            },
            members: [{ type: "way", ref: 100, role: "" }],
          },
          { type: "way", id: 100, nodes: [1, 2] },
          { type: "node", id: 1, lat: 48.14, lon: 11.56 },
          { type: "node", id: 2, lat: 48.145, lon: 11.57 },
        ],
      });
    }

    return Response.json({
      elements: [],
    });
  }) as unknown as typeof fetch;

  const overlay = await fetchTransitMapOverlay(config, {
    latitude: 48.137154,
    longitude: 11.576124,
  });

  expect(requestCount).toBe(2);
  expect(overlay.ubahnRoutes).toHaveLength(1);
  expect(overlay.ubahnRoutes[0]?.color).toBe("#0056b8");
  expect(overlay.ubahnRoutes[0]?.paths).toHaveLength(1);
});
