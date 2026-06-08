import type { LngLatTuple, FeatureCollection } from "./state";
import {
  state,
  standardPoiLabel,
  visibleNearbyPois,
} from "./state";
import { emptyFeatureCollection, normalizeMapColor, popupHtml } from "./helpers";

type PointFeature = FeatureCollection["features"][number] & {
  geometry: { type: "Point"; coordinates: LngLatTuple };
};

type ScreenPoint = { x: number; y: number };

type SpiderfyResult = {
  points: FeatureCollection;
  legs: FeatureCollection;
};

export function apartmentFeatureCollection() {
  const apartment = state.mapPayload?.apartment;
  if (!apartment || apartment.latitude === null || apartment.longitude === null) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: `apartment:${apartment.id}`,
        geometry: {
          type: "Point",
          coordinates: [apartment.longitude, apartment.latitude],
        },
        properties: {
          popupHtml: popupHtml(apartment.address, []),
        },
      },
    ],
  } satisfies FeatureCollection;
}

export function searchedAddressFeatureCollection() {
  const selection = state.mapAddressSelection;
  if (!selection) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "searched-address",
        geometry: {
          type: "Point",
          coordinates: [selection.longitude, selection.latitude],
        },
        properties: {
          popupHtml: popupHtml(selection.label, [selection.address, "Searched address"]),
        },
      },
    ],
  } satisfies FeatureCollection;
}

export function nearbyPoiFeatureCollection() {
  return {
    type: "FeatureCollection",
    features: visibleNearbyPois().map((poi) => ({
      type: "Feature" as const,
      id: `poi:${poi.id}`,
      geometry: {
        type: "Point" as const,
        coordinates: [poi.longitude, poi.latitude] as LngLatTuple,
      },
      properties: {
        category: poi.category,
        icon: poiIcoKey(poi.category, poi.subcategory),
        popupHtml: popupHtml(poi.name, [
          standardPoiLabel(poi.category),
          poi.address || "Address unavailable",
          poi.tags.length ? poi.tags.join(", ") : "",
        ].filter(Boolean)),
      },
    })),
  } satisfies FeatureCollection;
}

export function combinedPoiFeatureCollection() {
  if (!state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: [
      ...visibleNearbyPois().map((poi) => ({
        type: "Feature" as const,
        id: `poi:${poi.id}`,
        geometry: {
          type: "Point" as const,
          coordinates: [poi.longitude, poi.latitude] as LngLatTuple,
        },
        properties: {
          kind: "standard",
          category: poi.category,
          icon: poiIcoKey(poi.category, poi.subcategory),
          popupHtml: popupHtml(poi.name, [
            standardPoiLabel(poi.category),
            poi.address || "Address unavailable",
            poi.tags.length ? poi.tags.join(", ") : "",
          ].filter(Boolean)),
        },
      })),
      ...state.mapPayload.customPoiScores.map((score) => ({
        type: "Feature" as const,
        id: `custom:${score.customPoiId}`,
        geometry: {
          type: "Point" as const,
          coordinates: [score.longitude, score.latitude] as LngLatTuple,
        },
        properties: {
          kind: "custom",
          category: "custom",
          icon: "custom-poi-icon",
          popupHtml: popupHtml(score.name, [
            `Walk ${score.walking.durationMinutes ?? "n/a"} min`,
            `Transit ${score.transit.durationMinutes ?? "n/a"} min`,
          ]),
        },
      })),
    ],
  } satisfies FeatureCollection;
}

export function spiderfyPoiFeatureCollection(
  featureCollection: FeatureCollection,
  options: {
    project: (coordinates: LngLatTuple) => ScreenPoint;
    unproject: (point: ScreenPoint) => LngLatTuple;
    overlapRadiusPx?: number;
    horizontalGapPx?: number;
  },
): SpiderfyResult {
  const pointFeatures = featureCollection.features.filter(
    (feature): feature is PointFeature => feature.geometry.type === "Point",
  );

  if (pointFeatures.length <= 1) {
    return {
      points: featureCollection,
      legs: emptyFeatureCollection(),
    };
  }

  const overlapRadiusPx = options.overlapRadiusPx ?? 18;
  const horizontalGapPx = options.horizontalGapPx ?? 22;
  const projected = pointFeatures.map((feature) => ({
    feature,
    projected: options.project(feature.geometry.coordinates),
  }));
  const visited = new Set<number>();
  const spiderfiedPoints: FeatureCollection["features"] = [];
  const spiderLegs: FeatureCollection["features"] = [];

  for (let index = 0; index < projected.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }

    const group: Array<(typeof projected)[number] & { index: number }> = [];
    const queue = [index];
    visited.add(index);

    while (queue.length > 0) {
      const currentIndex = queue.shift()!;
      const current = projected[currentIndex]!;
      group.push({ ...current, index: currentIndex });

      for (let candidateIndex = 0; candidateIndex < projected.length; candidateIndex += 1) {
        if (visited.has(candidateIndex)) {
          continue;
        }

        const candidate = projected[candidateIndex]!;
        const distance = Math.hypot(
          current.projected.x - candidate.projected.x,
          current.projected.y - candidate.projected.y,
        );
        if (distance > overlapRadiusPx) {
          continue;
        }

        visited.add(candidateIndex);
        queue.push(candidateIndex);
      }
    }

    if (group.length === 1) {
      spiderfiedPoints.push(group[0]!.feature);
      continue;
    }

    const centroid = group.reduce(
      (accumulator, entry) => ({
        x: accumulator.x + entry.projected.x,
        y: accumulator.y + entry.projected.y,
      }),
      { x: 0, y: 0 },
    );
    centroid.x /= group.length;
    centroid.y /= group.length;

    const sortedGroup = [...group].sort((left, right) => {
      if (left.projected.x !== right.projected.x) {
        return left.projected.x - right.projected.x;
      }
      if (left.projected.y !== right.projected.y) {
        return left.projected.y - right.projected.y;
      }
      return String(left.feature.id ?? "").localeCompare(String(right.feature.id ?? ""));
    });

    const startX = centroid.x - ((sortedGroup.length - 1) * horizontalGapPx) / 2;
    for (const [groupIndex, entry] of sortedGroup.entries()) {
      const displacedPoint = {
        x: startX + groupIndex * horizontalGapPx,
        y: centroid.y,
      };
      const displacedCoordinates = options.unproject(displacedPoint);
      spiderfiedPoints.push({
        ...entry.feature,
        geometry: {
          type: "Point",
          coordinates: displacedCoordinates,
        },
        properties: {
          ...entry.feature.properties,
          spiderfied: true,
        },
      });
      spiderLegs.push({
        type: "Feature",
        id: `${String(entry.feature.id ?? `poi-${entry.index}`)}:spider-leg`,
        geometry: {
          type: "LineString",
          coordinates: [entry.feature.geometry.coordinates, displacedCoordinates],
        },
        properties: {
          spiderfied: true,
        },
      });
    }
  }

  return {
    points: {
      type: "FeatureCollection",
      features: spiderfiedPoints,
    },
    legs: {
      type: "FeatureCollection",
      features: spiderLegs,
    },
  };
}

function poiIcoKey(category: string, subcategory: string): string {
  if (subcategory && state.managedPoiIcons.has(`${category}:${subcategory}`)) {
    return "chain-" + subcategory.toLowerCase().replace(/\s+/g, "-");
  }
  return "cat-" + category;
}

export function ubahnStationFeatureCollection() {
  if (!state.showUbahnRoutes || !state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: state.mapPayload.ubahnStations.map((station) => ({
      type: "Feature" as const,
      id: `ubahn-station:${station.id}`,
      geometry: {
        type: "Point" as const,
        coordinates: [station.longitude, station.latitude] as LngLatTuple,
      },
      properties: {
        popupHtml: popupHtml(station.name, [
          station.modes.join(", "),
          ...(station.routeRefs.length > 0 ? [`Lines: ${station.routeRefs.join(", ")}`] : []),
        ]),
      },
    })),
  } satisfies FeatureCollection;
}

export function customPoiFeatureCollection() {
  if (!state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: state.mapPayload.customPoiScores.map((score) => ({
      type: "Feature" as const,
      id: `custom:${score.customPoiId}`,
      geometry: {
        type: "Point" as const,
        coordinates: [score.longitude, score.latitude] as LngLatTuple,
      },
      properties: {
        popupHtml: popupHtml(score.name, [
          `Walk ${score.walking.durationMinutes ?? "n/a"} min`,
          `Transit ${score.transit.durationMinutes ?? "n/a"} min`,
        ]),
      },
    })),
  } satisfies FeatureCollection;
}

export function ubahnRouteFeatureCollection() {
  if (!state.showUbahnRoutes || !state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: state.mapPayload.ubahnRoutes.flatMap((route) =>
      route.paths
        .filter((path) => path.length >= 2)
        .map((path, index) => ({
          type: "Feature" as const,
          id: `ubahn:${route.id}:${index}`,
          geometry: {
            type: "LineString" as const,
            coordinates: path.map((point) => [point.longitude, point.latitude] as LngLatTuple),
          },
          properties: {
            color: normalizeMapColor(route.color) || "#0056b8",
            popupHtml: popupHtml(route.ref || route.name, [route.name]),
          },
        })),
    ),
  } satisfies FeatureCollection;
}
