import { afterEach, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fetchTransitMapOverlay } from "./services";
import type { AppConfig } from "../shared/types";

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
            type: "node",
            id: 50,
            lat: 48.137,
            lon: 11.575,
            tags: {
              railway: "station",
              station: "subway",
              name: "Sendlinger Tor",
            },
          },
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
  expect(overlay.ubahnStations).toHaveLength(1);
  expect(overlay.ubahnStations[0]?.name).toBe("Sendlinger Tor");
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

test("fetchTransitMapOverlay groups routes by line ref and merges stations within 500m", async () => {
  const config = createConfig();

  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = String(init?.body ?? "");

    if (body.includes('relation["route"="subway"]')) {
      return Response.json({
        elements: [
          // Station 1: Sendlinger Tor (two nodes close to each other)
          {
            type: "node",
            id: 50,
            lat: 48.1334,
            lon: 11.5668,
            tags: {
              railway: "station",
              station: "subway",
              name: "Sendlinger Tor",
            },
          },
          {
            type: "node",
            id: 51,
            lat: 48.1336,
            lon: 11.5670,
            tags: {
              railway: "station",
              station: "subway",
              name: "Sendlinger Tor",
            },
          },
          // Station 2: Hauptbahnhof (far away, shouldn't merge with Sendlinger Tor)
          {
            type: "node",
            id: 60,
            lat: 48.1393,
            lon: 11.5599,
            tags: {
              railway: "station",
              station: "subway",
              name: "Hauptbahnhof",
            },
          },
          // Route relations (two directions of U1)
          {
            type: "relation",
            id: 201,
            tags: {
              route: "subway",
              ref: "U1",
              name: "U1 outbound",
              colour: "ef1e24",
            },
            members: [
              { type: "way", ref: 101, role: "" },
              { type: "way", ref: 103, role: "platform" } // platform role -> should be skipped
            ],
          },
          {
            type: "relation",
            id: 202,
            tags: {
              route: "subway",
              ref: "U1",
              name: "U1 inbound",
              colour: "ef1e24",
            },
            members: [
              { type: "way", ref: 102, role: "" },
              { type: "way", ref: 104, role: "" } // closed loop, empty tags -> should be skipped
            ],
          },
          // Way 101 (outbound path: nodes 1 -> 2)
          { type: "way", id: 101, nodes: [1, 2] },
          // Way 102 (inbound path: nodes 2 -> 5, where 5 is within 50m of 2)
          { type: "way", id: 102, nodes: [2, 5] },
          // Way 103: Platform tags, should be skipped
          { type: "way", id: 103, nodes: [30, 31], tags: { railway: "platform" } },
          // Way 104: Closed loop polygon (rectangle around station), should be skipped
          { type: "way", id: 104, nodes: [40, 41, 42, 40] },
          
          { type: "node", id: 1, lat: 48.13, lon: 11.56 },
          // Node 2 at 48.14000, 11.57000
          { type: "node", id: 2, lat: 48.14000, lon: 11.57000 },
          // Node 5 at 48.14005, 11.57005 (about 7 meters from Node 2, should snap)
          { type: "node", id: 5, lat: 48.14005, lon: 11.57005 },
          
          { type: "node", id: 30, lat: 48.131, lon: 11.561 },
          { type: "node", id: 31, lat: 48.132, lon: 11.562 },
          
          { type: "node", id: 40, lat: 48.1350, lon: 11.5650 },
          { type: "node", id: 41, lat: 48.1351, lon: 11.5651 },
          { type: "node", id: 42, lat: 48.1350, lon: 11.5652 },
        ],
      });
    }

    return Response.json({ elements: [] });
  }) as unknown as typeof fetch;

  const overlay = await fetchTransitMapOverlay(config, {
    latitude: 48.137,
    longitude: 11.575,
  });

  // Verify stations: Sendlinger Tor should be merged into 1 (average coordinates), Hauptbahnhof is separate. Total 2.
  expect(overlay.ubahnStations).toHaveLength(2);
  
  const sendlingerTor = overlay.ubahnStations.find(s => s.name === "Sendlinger Tor");
  expect(sendlingerTor).toBeDefined();
  expect(sendlingerTor!.latitude).toBe(48.1335);
  expect(sendlingerTor!.longitude).toBe(11.5669);

  const hbf = overlay.ubahnStations.find(s => s.name === "Hauptbahnhof");
  expect(hbf).toBeDefined();
  expect(hbf!.latitude).toBe(48.1393);
  expect(hbf!.longitude).toBe(11.5599);

  // Verify routes: U1 outbound and inbound relations should be grouped into 1 route "U1"
  expect(overlay.ubahnRoutes).toHaveLength(1);
  const u1 = overlay.ubahnRoutes[0]!;
  expect(u1.ref).toBe("U1");
  expect(u1.id).toBe("U1");
  expect(u1.name).toBe("U-Bahn U1");
  expect(u1.color).toBe("#ef1e24");
  
  // Verify that:
  // 1. Way 103 (platform) was skipped.
  // 2. Way 104 (closed loop) was skipped.
  // 3. Node 5 snapped to Node 2 (within 50m).
  // 4. Consecutive duplicates collapsed (Path 2 became [2, 2] -> [2] -> skipped, or they became identical and deduplicated).
  // Total unique paths should be 1.
  expect(u1.paths).toHaveLength(1);
  const u1Path = u1.paths[0]!;
  expect(u1Path).toHaveLength(2);
  expect(u1Path[0]!.latitude).toBe(48.13);
  // The second coordinate should be the average (center) of the clustered nodes
  // Node 2 (appears twice) and Node 5 (appears once)
  // Center latitude: (48.14000 * 2 + 48.14005) / 3 = 48.14001666...
  // Center longitude: (11.57000 * 2 + 11.57005) / 3 = 11.57001666...
  expect(u1Path[1]!.latitude).toBeCloseTo(48.140017, 6);
  expect(u1Path[1]!.longitude).toBeCloseTo(11.570017, 6);
});

