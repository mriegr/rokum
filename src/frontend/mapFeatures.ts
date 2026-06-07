import type { LngLatTuple, FeatureCollection } from "./state";
import {
  POI_LABELS,
  state,
  visibleNearbyPois,
} from "./state";
import { emptyFeatureCollection, normalizeMapColor, popupHtml } from "./helpers";

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
        popupHtml: popupHtml(poi.name, [
          POI_LABELS[poi.category],
          poi.address || "Address unavailable",
          poi.tags.length ? poi.tags.join(", ") : "",
        ].filter(Boolean)),
      },
    })),
  } satisfies FeatureCollection;
}

export function transitStopFeatureCollection() {
  if (!state.showTransitStops || !state.mapPayload) {
    return emptyFeatureCollection();
  }

  return {
    type: "FeatureCollection",
    features: state.mapPayload.transitStops.map((stop) => ({
      type: "Feature" as const,
      id: `stop:${stop.id}`,
      geometry: {
        type: "Point" as const,
        coordinates: [stop.longitude, stop.latitude] as LngLatTuple,
      },
      properties: {
        popupHtml: popupHtml(stop.name, [stop.modes.join(", ")]),
      },
    })),
  } satisfies FeatureCollection;
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
        popupHtml: popupHtml(station.name, [station.modes.join(", ")]),
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
