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

test("fetchTransitMapOverlay resolves nested route relations", async () => {
  const config = createConfig();

  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? "");

    if (body.includes('relation["route"="subway"]')) {
      return Response.json({
        elements: [
          {
            type: "relation",
            id: 300,
            tags: {
              route: "subway",
              ref: "U6",
              name: "U6",
              colour: "#0056b8",
            },
            members: [{ type: "relation", ref: 301, role: "" }],
          },
          {
            type: "relation",
            id: 301,
            tags: {
              route: "subway",
              ref: "U6",
              name: "U6 branch",
              colour: "#0056b8",
            },
            members: [{ type: "way", ref: 101, role: "" }],
          },
          { type: "way", id: 101, nodes: [11, 12] },
          { type: "node", id: 11, lat: 48.14, lon: 11.56 },
          { type: "node", id: 12, lat: 48.145, lon: 11.57 },
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

  expect(overlay.ubahnRoutes).toHaveLength(1);
  expect(overlay.ubahnRoutes[0]?.paths).toHaveLength(1);
  expect(overlay.ubahnRoutes[0]?.paths[0]).toHaveLength(2);
});

test("fetchTransitMapOverlay reuses the Munich route cache across origins", async () => {
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
            id: 400,
            tags: {
              route: "subway",
              ref: "U4",
              name: "U4",
              colour: "#0056b8",
            },
            members: [{ type: "way", ref: 401, role: "" }],
          },
          { type: "way", id: 401, nodes: [21, 22] },
          { type: "node", id: 21, lat: 48.11, lon: 11.53 },
          { type: "node", id: 22, lat: 48.12, lon: 11.54 },
        ],
      });
    }

    return Response.json({ elements: [] });
  }) as unknown as typeof fetch;

  const first = await fetchTransitMapOverlay(config, {
    latitude: 48.137154,
    longitude: 11.576124,
  });
  const second = await fetchTransitMapOverlay(config, {
    latitude: 48.2,
    longitude: 11.7,
  });

  expect(first.ubahnRoutes).toHaveLength(1);
  expect(second.ubahnRoutes).toHaveLength(1);
  expect(requestCount).toBe(3);
});
