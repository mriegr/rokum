import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature, type Popup } from "maplibre-gl";
import type { FeatureCollection, LngLatTuple } from "./state";
import {
  APARTMENT_LAYER_ID,
  APARTMENT_SOURCE_ID,
  CUSTOM_POI_LAYER_ID,
  CUSTOM_POI_SOURCE_ID,
  EMPTY_FEATURE_COLLECTION,
  POI_LAYER_ID,
  POI_SOURCE_ID,
  TRANSIT_LAYER_ID,
  TRANSIT_SOURCE_ID,
  UBAHN_LAYER_ID,
  UBAHN_SOURCE_ID,
  UBAHN_STATION_LAYER_ID,
  UBAHN_STATION_SOURCE_ID,
  state,
  visibleNearbyPois,
} from "./state";
import { mapIsAvailable } from "./helpers";
import {
  apartmentFeatureCollection,
  customPoiFeatureCollection,
  nearbyPoiFeatureCollection,
  transitStopFeatureCollection,
  ubahnRouteFeatureCollection,
  ubahnStationFeatureCollection,
} from "./mapFeatures";

export let map: maplibregl.Map | null = null;
export let popup: Popup | null = null;
export let mapReady = false;

export function destroyMap() {
  if (map) {
    popup?.remove();
    popup = null;
    map.remove();
    map = null;
    mapReady = false;
  }
}

export function setSourceData(sourceId: string, data: FeatureCollection) {
  const source = map?.getSource(sourceId) as GeoJSONSource | undefined;
  source?.setData(data);
}

export function applyLayerVisibility(layerId: string, visible: boolean) {
  if (!map?.getLayer(layerId)) {
    return;
  }

  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

export function resizeMapSoon() {
  window.setTimeout(() => map?.resize(), 0);
}

export function fitMapToPayload() {
  const coordinates: LngLatTuple[] = [];
  const apartment = state.mapPayload?.apartment;
  if (
    apartment &&
    apartment.latitude !== null &&
    apartment.longitude !== null
  ) {
    coordinates.push([apartment.longitude, apartment.latitude]);
  }

  for (const poi of visibleNearbyPois()) {
    coordinates.push([poi.longitude, poi.latitude]);
  }

  if (state.showTransitStops) {
    for (const stop of state.mapPayload?.transitStops ?? []) {
      coordinates.push([stop.longitude, stop.latitude]);
    }
  }

  for (const score of state.mapPayload?.customPoiScores ?? []) {
    coordinates.push([score.longitude, score.latitude]);
  }

  if (state.showUbahnRoutes) {
    for (const station of state.mapPayload?.ubahnStations ?? []) {
      coordinates.push([station.longitude, station.latitude]);
    }
    for (const route of state.mapPayload?.ubahnRoutes ?? []) {
      for (const path of route.paths) {
        for (const point of path) {
          coordinates.push([point.longitude, point.latitude]);
        }
      }
    }
  }

  if (coordinates.length === 0) {
    if (mapIsAvailable(state.mapConfig)) {
      map?.jumpTo({
        center: state.mapConfig.center,
        zoom: 11,
      });
    }
    return;
  }

  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  map?.fitBounds(bounds, {
    padding: 56,
    maxZoom: 15,
    duration: 0,
  });
}

export function syncMapSources(options?: { preserveViewport?: boolean }) {
  if (!mapReady) {
    return;
  }

  setSourceData(APARTMENT_SOURCE_ID, apartmentFeatureCollection());
  setSourceData(POI_SOURCE_ID, nearbyPoiFeatureCollection());
  setSourceData(CUSTOM_POI_SOURCE_ID, customPoiFeatureCollection());
  setSourceData(TRANSIT_SOURCE_ID, transitStopFeatureCollection());
  setSourceData(UBAHN_STATION_SOURCE_ID, ubahnStationFeatureCollection());
  setSourceData(UBAHN_SOURCE_ID, ubahnRouteFeatureCollection());

  applyLayerVisibility(TRANSIT_LAYER_ID, state.showTransitStops);
  applyLayerVisibility(UBAHN_STATION_LAYER_ID, state.showUbahnRoutes);
  applyLayerVisibility(UBAHN_LAYER_ID, state.showUbahnRoutes);

  if (!options?.preserveViewport) {
    fitMapToPayload();
  }

  resizeMapSoon();
}

export function showMapPopup(feature: MapGeoJSONFeature) {
  const coordinates = feature.geometry.type === "Point"
    ? [...feature.geometry.coordinates]
    : feature.geometry.coordinates[0]
      ? [...feature.geometry.coordinates[0]]
      : null;

  if (!coordinates) {
    return;
  }

  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 12 })
    .setLngLat(coordinates as [number, number])
    .setHTML(String(feature.properties?.popupHtml ?? ""))
    .addTo(map!);
}

function bindMapInteractions() {
  if (!map) {
    return;
  }

  for (const layerId of [
    APARTMENT_LAYER_ID,
    POI_LAYER_ID,
    CUSTOM_POI_LAYER_ID,
    TRANSIT_LAYER_ID,
    UBAHN_STATION_LAYER_ID,
    UBAHN_LAYER_ID,
  ]) {
    map.on("click", layerId, (event) => {
      const feature = event.features?.[0];
      if (feature) {
        showMapPopup(feature);
      }
    });
    map.on("mouseenter", layerId, () => {
      map?.getCanvas().style.setProperty("cursor", "pointer");
    });
    map.on("mouseleave", layerId, () => {
      map?.getCanvas().style.removeProperty("cursor");
    });
  }
}

function addMapSourcesAndLayers() {
  if (!map || mapReady) {
    return;
  }

  map.addSource(APARTMENT_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(POI_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(CUSTOM_POI_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(TRANSIT_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(UBAHN_STATION_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(UBAHN_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });

  map.addLayer({
    id: UBAHN_STATION_LAYER_ID,
    type: "circle",
    source: UBAHN_STATION_SOURCE_ID,
    paint: {
      "circle-radius": 6,
      "circle-color": "#0056b8",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
      "circle-opacity": 0.92,
    },
  });
  map.addLayer({
    id: UBAHN_LAYER_ID,
    type: "line",
    source: UBAHN_SOURCE_ID,
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#0056b8"],
      "line-width": 4,
      "line-opacity": 0.65,
    },
  });
  map.addLayer({
    id: POI_LAYER_ID,
    type: "circle",
    source: POI_SOURCE_ID,
    paint: {
      "circle-radius": [
        "case",
        ["==", ["get", "category"], "sport_studio"],
        7,
        6,
      ],
      "circle-color": [
        "case",
        ["==", ["get", "category"], "sport_studio"],
        "#7ad3b0",
        "#b7d5ea",
      ],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "category"], "sport_studio"],
        "#0f6b57",
        "#275d8a",
      ],
      "circle-stroke-width": 2,
      "circle-opacity": 0.92,
    },
  });
  map.addLayer({
    id: TRANSIT_LAYER_ID,
    type: "circle",
    source: TRANSIT_SOURCE_ID,
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffe55c",
      "circle-stroke-color": "#101820",
      "circle-stroke-width": 2,
      "circle-opacity": 0.95,
    },
  });
  map.addLayer({
    id: CUSTOM_POI_LAYER_ID,
    type: "circle",
    source: CUSTOM_POI_SOURCE_ID,
    paint: {
      "circle-radius": 8,
      "circle-color": "#7dc4de",
      "circle-stroke-color": "#25556e",
      "circle-stroke-width": 2,
      "circle-opacity": 0.9,
    },
  });
  map.addLayer({
    id: APARTMENT_LAYER_ID,
    type: "circle",
    source: APARTMENT_SOURCE_ID,
    paint: {
      "circle-radius": 9,
      "circle-color": "#f06b4f",
      "circle-stroke-color": "#18201f",
      "circle-stroke-width": 3,
    },
  });

  bindMapInteractions();
  mapReady = true;
}

export function renderMap(options?: { preserveViewport?: boolean }) {
  if (state.activeView !== "map") {
    return;
  }

  const mapElement = document.querySelector<HTMLElement>("#map-canvas");
  if (!mapElement) {
    return;
  }

  if (!mapIsAvailable(state.mapConfig)) {
    destroyMap();
    return;
  }

  if (map && map.getContainer() !== mapElement) {
    destroyMap();
  }

  if (!map) {
    map = new maplibregl.Map({
      container: mapElement,
      style: state.mapConfig.styleUrl,
      center: state.mapConfig.center,
      zoom: 11,
      minZoom: state.mapConfig.minZoom,
      maxZoom: state.mapConfig.maxZoom,
      maxBounds: state.mapConfig.bounds,
      renderWorldCopies: false,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: state.mapConfig.attribution,
      }),
      "bottom-right",
    );
    map.on("load", () => {
      addMapSourcesAndLayers();
      syncMapSources(options);
    });
    map.on("error", (event) => {
      console.error("MapLibre error", event.error ?? event);
    });
    resizeMapSoon();
    return;
  }

  syncMapSources(options);
}
