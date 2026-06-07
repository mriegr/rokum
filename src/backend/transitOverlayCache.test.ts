import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { getTransitOverlayCachePath, loadMunichTransitOverlayCache, saveMunichUbahnRoutes } from "./transitOverlayCache";
import type { AppConfig, TransitStop, UbahnRoute } from "../shared/types";

const cachePaths: string[] = [];

function createConfig(): AppConfig {
  const databasePath = `/tmp/rokum-overlay-cache-${randomUUID()}.sqlite`;
  cachePaths.push(getTransitOverlayCachePath({ databasePath }));
  return {
    port: 0,
    city: "Munich",
    databasePath,
    uploadDirectory: "/tmp",
    nominatimBaseUrl: "https://example.test",
    overpassBaseUrl: "https://example.test",
    walkingBaseUrl: "https://example.test",
    transitBaseUrl: null,
    transitMode: "heuristic",
    jawgApiKey: null,
    jawgStyleId: "jawg-streets",
  };
}

afterEach(() => {
  for (const path of cachePaths.splice(0)) {
    rmSync(path, { force: true });
  }
});

test("munich ubahn route cache persists and reloads from disk", async () => {
  const config = createConfig();
  const routes: UbahnRoute[] = [
    {
      id: "200",
      name: "U2",
      ref: "U2",
      color: "#0056b8",
      paths: [
        [
          { latitude: 48.14, longitude: 11.56 },
          { latitude: 48.145, longitude: 11.57 },
        ],
      ],
    },
  ];

  const stations: TransitStop[] = [
    {
      id: "station-1",
      name: "Sendlinger Tor",
      latitude: 48.134,
      longitude: 11.566,
      modes: ["U-Bahn"],
      routeRefs: [],
    },
  ];

  await saveMunichUbahnRoutes(config, { ubahnStations: stations, ubahnRoutes: routes });

  const cached = await loadMunichTransitOverlayCache(config);
  expect(cached.ubahnStations).toEqual(stations);
  expect(cached.ubahnRoutes).toEqual(routes);
  expect(await Bun.file(getTransitOverlayCachePath(config)).text()).toContain("U2");
});
