import { beforeAll, expect, test } from "bun:test";

let ubahnStationFeatureCollection: (typeof import("./mapFeatures"))["ubahnStationFeatureCollection"];
let ubahnRouteFeatureCollection: (typeof import("./mapFeatures"))["ubahnRouteFeatureCollection"];
let combinedPoiFeatureCollection: (typeof import("./mapFeatures"))["combinedPoiFeatureCollection"];
let nearbyPoiFeatureCollection: (typeof import("./mapFeatures"))["nearbyPoiFeatureCollection"];
let apartmentFeatureCollection: (typeof import("./mapFeatures"))["apartmentFeatureCollection"];
let customPoiFeatureCollection: (typeof import("./mapFeatures"))["customPoiFeatureCollection"];
let spiderfyPoiFeatureCollection: (typeof import("./mapFeatures"))["spiderfyPoiFeatureCollection"];
let state: any;

beforeAll(async () => {
  globalThis.document = { querySelector: () => ({}) as never, createElement: () => ({}) as never, documentElement: {} as never } as never;
  globalThis.window = { location: { pathname: "/" } } as never;

  const mapFeatures = await import("./mapFeatures");
  const stateMod = await import("./state");

  ubahnStationFeatureCollection = mapFeatures.ubahnStationFeatureCollection;
  ubahnRouteFeatureCollection = mapFeatures.ubahnRouteFeatureCollection;
  combinedPoiFeatureCollection = mapFeatures.combinedPoiFeatureCollection;
  nearbyPoiFeatureCollection = mapFeatures.nearbyPoiFeatureCollection;
  apartmentFeatureCollection = mapFeatures.apartmentFeatureCollection;
  customPoiFeatureCollection = mapFeatures.customPoiFeatureCollection;
  spiderfyPoiFeatureCollection = mapFeatures.spiderfyPoiFeatureCollection;
  state = stateMod.state;
});

test("ubahnStationFeatureCollection returns empty when showUbahnRoutes is false", () => {
  state.showUbahnRoutes = false;
  state.mapPayload = null;
  const result = ubahnStationFeatureCollection();
  expect(result.type).toBe("FeatureCollection");
  expect(result.features).toHaveLength(0);
});

test("ubahnStationFeatureCollection returns empty when mapPayload is null", () => {
  state.showUbahnRoutes = true;
  state.mapPayload = null;
  const result = ubahnStationFeatureCollection();
  expect(result.type).toBe("FeatureCollection");
  expect(result.features).toHaveLength(0);
});

test("ubahnStationFeatureCollection returns features with correct structure", () => {
  state.showUbahnRoutes = true;
  state.mapPayload = {
    ubahnStations: [
      {
        id: "test-station|48.137|11.575",
        name: "Sendlinger Tor",
        latitude: 48.137,
        longitude: 11.575,
        modes: ["U-Bahn"],
        routeRefs: ["U1", "U2", "U3"],
      },
      {
        id: "other-station|48.15|11.59",
        name: "Marienplatz",
        latitude: 48.15,
        longitude: 11.59,
        modes: ["U-Bahn", "S-Bahn"],
        routeRefs: [],
      },
    ],
    ubahnRoutes: [],
  } as never;

  const result = ubahnStationFeatureCollection();
  expect(result.type).toBe("FeatureCollection");
  expect(result.features).toHaveLength(2);

  const f0 = result.features[0]!;
  expect(f0.id).toBe("ubahn-station:test-station|48.137|11.575");
  expect(f0.geometry.type).toBe("Point");
  expect(f0.geometry.coordinates).toEqual([11.575, 48.137]);
  expect(f0.properties!.popupHtml).toContain("Sendlinger Tor");
  expect(f0.properties!.popupHtml).toContain("U-Bahn");
  expect(f0.properties!.popupHtml).toContain("Lines: U1, U2, U3");

  const f1 = result.features[1]!;
  expect(f1.id).toBe("ubahn-station:other-station|48.15|11.59");
  expect(f1.geometry.coordinates).toEqual([11.59, 48.15]);
  expect(f1.properties!.popupHtml).toContain("Marienplatz");
  expect(f1.properties!.popupHtml).not.toContain("Lines:");
});

test("ubahnRouteFeatureCollection returns empty when showUbahnRoutes is false", () => {
  state.showUbahnRoutes = false;
  state.mapPayload = null;
  const result = ubahnRouteFeatureCollection();
  expect(result.type).toBe("FeatureCollection");
  expect(result.features).toHaveLength(0);
});

test("ubahnRouteFeatureCollection returns features with correct structure", () => {
  state.showUbahnRoutes = true;
  state.mapPayload = {
    ubahnStations: [],
    ubahnRoutes: [
      {
        id: "route-u3",
        name: "U3",
        ref: "U3",
        color: "#ff6600",
        paths: [
          [
            { latitude: 48.13, longitude: 11.57 },
            { latitude: 48.14, longitude: 11.58 },
          ],
        ],
      },
      {
        id: "route-u6",
        name: "U6",
        ref: "U6",
        color: null,
        paths: [
          [
            { latitude: 48.16, longitude: 11.60 },
            { latitude: 48.17, longitude: 11.61 },
          ],
        ],
      },
    ],
  } as never;

  const result = ubahnRouteFeatureCollection();
  expect(result.type).toBe("FeatureCollection");
  expect(result.features).toHaveLength(2);

  const f0 = result.features[0]!;
  expect(f0.id).toBe("ubahn:route-u3:0");
  expect(f0.geometry.type).toBe("LineString");
  expect(f0.geometry.coordinates).toEqual([
    [11.57, 48.13],
    [11.58, 48.14],
  ]);
  expect(f0.properties!.color).toBe("#ff6600");
  expect(f0.properties!.popupHtml).toContain("U3");

  const f1 = result.features[1]!;
  expect(f1.id).toBe("ubahn:route-u6:0");
  expect(f1.geometry.coordinates).toEqual([
    [11.60, 48.16],
    [11.61, 48.17],
  ]);
  expect(f1.properties!.color).toBe("#0056b8");
});

test("apartmentFeatureCollection returns empty when no apartment", () => {
  state.mapPayload = null;
  const result = apartmentFeatureCollection();
  expect(result.features).toHaveLength(0);
});

test("apartmentFeatureCollection returns empty when apartment has null coordinates", () => {
  state.mapPayload = {
    apartment: { id: 1, latitude: null, longitude: null },
  } as never;
  const result = apartmentFeatureCollection();
  expect(result.features).toHaveLength(0);
});

test("nearbyPoiFeatureCollection returns empty when no payload", () => {
  state.mapPayload = null;
  const result = nearbyPoiFeatureCollection();
  expect(result.features).toHaveLength(0);
});

test("combinedPoiFeatureCollection combines standard and custom pois", () => {
  state.visiblePoiCategories = {
    supermarket: true,
    sport_studio: true,
    ubahn: true,
    cafe: true,
    park_or_river: true,
  };
  state.selectedSportTags = [];
  state.mapPayload = {
    nearbyPois: [
      {
        id: 1,
        category: "supermarket",
        subcategory: "edeka",
        name: "Edeka Sendling",
        address: "Street 1",
        tags: [],
        latitude: 48.13,
        longitude: 11.57,
      },
    ],
    customPoiScores: [
      {
        customPoiId: 7,
        name: "Office",
        longitude: 11.58,
        latitude: 48.14,
        walking: { durationMinutes: 12 },
        transit: { durationMinutes: 8 },
      },
    ],
  } as never;

  const result = combinedPoiFeatureCollection();
  expect(result.features).toHaveLength(2);
  expect(result.features[0]?.id).toBe("poi:1");
  expect(result.features[0]?.properties?.kind).toBe("standard");
  expect(result.features[1]?.id).toBe("custom:7");
  expect(result.features[1]?.properties?.kind).toBe("custom");
  expect(result.features[1]?.properties?.icon).toBe("custom-poi-icon");
});

test("spiderfyPoiFeatureCollection leaves separate points untouched", () => {
  const result = spiderfyPoiFeatureCollection(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "poi:1",
          geometry: { type: "Point", coordinates: [11.57, 48.13] },
          properties: {},
        },
        {
          type: "Feature",
          id: "poi:2",
          geometry: { type: "Point", coordinates: [11.60, 48.14] },
          properties: {},
        },
      ],
    },
    {
      project: ([x, y]) => ({ x, y }),
      unproject: ({ x, y }) => [x, y],
      overlapRadiusPx: 0.01,
      horizontalGapPx: 10,
    },
  );

  expect(result.points.features).toHaveLength(2);
  expect(result.legs.features).toHaveLength(0);
  expect(result.points.features[0]?.geometry.coordinates).toEqual([11.57, 48.13]);
  expect(result.points.features[1]?.geometry.coordinates).toEqual([11.60, 48.14]);
});

test("spiderfyPoiFeatureCollection spreads overlapping points into a horizontal row", () => {
  const result = spiderfyPoiFeatureCollection(
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "poi:1",
          geometry: { type: "Point", coordinates: [0, 0] },
          properties: {},
        },
        {
          type: "Feature",
          id: "poi:2",
          geometry: { type: "Point", coordinates: [0.002, 0] },
          properties: {},
        },
        {
          type: "Feature",
          id: "poi:3",
          geometry: { type: "Point", coordinates: [0.004, 0] },
          properties: {},
        },
      ],
    },
    {
      project: ([x, y]) => ({ x: x * 1000, y: y * 1000 }),
      unproject: ({ x, y }) => [x / 1000, y / 1000],
      overlapRadiusPx: 5,
      horizontalGapPx: 20,
    },
  );

  expect(result.points.features).toHaveLength(3);
  expect(result.legs.features).toHaveLength(3);
  expect(result.points.features.map((feature) => feature.geometry.coordinates)).toEqual([
    [-0.018, 0],
    [0.002, 0],
    [0.022, 0],
  ]);
});

test("customPoiFeatureCollection returns empty when no payload", () => {
  state.mapPayload = null;
  const result = customPoiFeatureCollection();
  expect(result.features).toHaveLength(0);
});
