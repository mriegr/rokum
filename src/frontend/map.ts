import maplibregl, {
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type Popup,
} from "maplibre-gl";
import type { FeatureCollection, LngLatTuple } from "./state";
import {
  APARTMENT_LAYER_ID,
  APARTMENT_SOURCE_ID,
  EMPTY_FEATURE_COLLECTION,
  POI_LAYER_ID,
  POI_SPIDER_LEG_LAYER_ID,
  POI_SPIDER_LEG_SOURCE_ID,
  POI_SOURCE_ID,
  SEARCHED_ADDRESS_LAYER_ID,
  SEARCHED_ADDRESS_SOURCE_ID,
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
  combinedPoiFeatureCollection,
  searchedAddressFeatureCollection,
  spiderfyPoiFeatureCollection,
  ubahnRouteFeatureCollection,
  ubahnStationFeatureCollection,
} from "./mapFeatures";


export let map: maplibregl.Map | null = null;
export let popup: Popup | null = null;
export let mapReady = false;

const SPIDERFY_OVERLAP_RADIUS_PX = 14;
const SPIDERFY_HORIZONTAL_GAP_PX = 22;

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

export function focusSearchedAddress() {
  const selection = state.mapAddressSelection;
  if (!mapReady || !map || !selection) {
    return;
  }

  setSourceData(SEARCHED_ADDRESS_SOURCE_ID, searchedAddressFeatureCollection());
  map.jumpTo({
    center: [selection.longitude, selection.latitude],
    zoom: 16,
  });
}

export function syncMapSources(options?: { preserveViewport?: boolean }) {
  if (!mapReady) {
    return;
  }

  setSourceData(APARTMENT_SOURCE_ID, apartmentFeatureCollection());
  setSourceData(SEARCHED_ADDRESS_SOURCE_ID, searchedAddressFeatureCollection());
  setSourceData(UBAHN_STATION_SOURCE_ID, ubahnStationFeatureCollection());
  setSourceData(UBAHN_SOURCE_ID, ubahnRouteFeatureCollection());

  applyLayerVisibility(UBAHN_STATION_LAYER_ID, state.showUbahnRoutes);
  applyLayerVisibility(UBAHN_LAYER_ID, state.showUbahnRoutes);

  if (!options?.preserveViewport) {
    if (state.mapAddressSelection) {
      focusSearchedAddress();
    } else {
      fitMapToPayload();
    }
  }

  syncPoiSources();

  resizeMapSoon();
}

export function showMapPopup(
  feature: MapGeoJSONFeature,
  lngLat: maplibregl.LngLat,
) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false, offset: 12 })
    .setLngLat(lngLat)
    .setHTML(String(feature.properties?.popupHtml ?? ""))
    .addTo(map!);
}

function syncPoiSources() {
  if (!map) {
    return;
  }

  const combinedFeatures = combinedPoiFeatureCollection();
  const spiderfied = spiderfyPoiFeatureCollection(combinedFeatures, {
    project: (coordinates) => map!.project(coordinates),
    unproject: (point) => {
      const lngLat = map!.unproject([point.x, point.y]);
      return [lngLat.lng, lngLat.lat];
    },
    overlapRadiusPx: SPIDERFY_OVERLAP_RADIUS_PX,
    horizontalGapPx: SPIDERFY_HORIZONTAL_GAP_PX,
  });

  setSourceData(POI_SOURCE_ID, spiderfied.points);
  setSourceData(POI_SPIDER_LEG_SOURCE_ID, spiderfied.legs);
}

function bindMapInteractions() {
  if (!map) {
    return;
  }

  for (const layerId of [
    APARTMENT_LAYER_ID,
    SEARCHED_ADDRESS_LAYER_ID,
    POI_LAYER_ID,
    UBAHN_STATION_LAYER_ID,
    UBAHN_LAYER_ID,
  ]) {
    map.on("click", layerId, (event) => {
      const feature = event.features?.[0];
      if (feature) {
        showMapPopup(feature, event.lngLat);
      }
    });
    map.on("mouseenter", layerId, () => {
      map?.getCanvas().style.setProperty("cursor", "pointer");
    });
    map.on("mouseleave", layerId, () => {
      map?.getCanvas().style.removeProperty("cursor");
    });
  }

  map.on("styleimagemissing", (event) => {
    if (!map || map.hasImage(event.id)) {
      return;
    }

    const fallback = fallbackIconFromImageId(event.id);
    if (!fallback) {
      return;
    }

    map.addImage(event.id, fallback);
  });

  map.on("zoomend", syncPoiSources);
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.quadraticCurveTo(w, 0, w, r);
  ctx.lineTo(w, h - r);
  ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(r, h);
  ctx.quadraticCurveTo(0, h, 0, h - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
}

function makeIcon(bg: string, text: string, textColor = "#ffffff"): ImageData {
  const c = document.createElement("canvas");
  c.width = 24;
  c.height = 24;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  drawRoundedRect(ctx, 24, 24, 5);
  ctx.fill();
  ctx.fillStyle = textColor;
  ctx.font = "bold 14px Arial, Helvetica, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 12, 12.5);
  return ctx.getImageData(0, 0, 24, 24);
}

function titleCaseSlug(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackIconFromImageId(imageId: string) {
  if (imageId.startsWith("chain-")) {
    const label = titleCaseSlug(imageId.slice("chain-".length));
    return makeIcon("#34495e", label.charAt(0) || "S");
  }

  if (imageId.startsWith("cat-")) {
    const category = imageId.slice("cat-".length);
    switch (category) {
      case "supermarket":
        return makeIcon("#e67e22", "M");
      case "sport_studio":
        return makeIcon("#2ecc71", "S");
      default:
        return makeIcon("#5c6670", titleCaseSlug(category).charAt(0) || "P");
    }
  }

  return null;
}

function loadIcon(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 24;
      c.height = 24;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 24, 24);
      resolve(ctx.getImageData(0, 0, 24, 24));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function registerCategoryIcons() {
  if (!map) return;

  map.addImage("cat-supermarket", makeIcon("#e67e22", "M"));
  map.addImage("cat-sport_studio", makeIcon("#2ecc71", "S"));
}

export async function registerChainIcons() {
  if (!map) return;

  const customUrls = new Map<string, string>();
  for (const [key, path] of state.managedPoiIcons) {
    const [cat, sub] = key.split(":");
    const icoName = sub
      ? "chain-" + sub.toLowerCase().replace(/\s+/g, "-")
      : "cat-" + cat;
    customUrls.set(icoName, path);
  }

  if (customUrls.size === 0) return;

  const customResults = await Promise.allSettled(
    Array.from(customUrls).map(async ([name, path]) => {
      return { name, data: await loadIcon(path) };
    }),
  );

  for (const result of customResults) {
    if (result.status === "fulfilled") {
      if (map.hasImage(result.value.name)) {
        map.updateImage(result.value.name, result.value.data);
      } else {
        map.addImage(result.value.name, result.value.data);
      }
    }
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
  map.addSource(SEARCHED_ADDRESS_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(POI_SOURCE_ID, {
    type: "geojson",
    data: EMPTY_FEATURE_COLLECTION,
  });
  map.addSource(POI_SPIDER_LEG_SOURCE_ID, {
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

  const iconCanvas = document.createElement("canvas");
  iconCanvas.width = 24;
  iconCanvas.height = 24;
  const iconCtx = iconCanvas.getContext("2d")!;
  iconCtx.fillStyle = "#0056b8";
  drawRoundedRect(iconCtx, 22, 22, 5);
  iconCtx.fill();
  iconCtx.fillStyle = "#ffffff";
  iconCtx.font = "bold 14px Arial, Helvetica, sans-serif";
  iconCtx.textAlign = "center";
  iconCtx.textBaseline = "middle";
  iconCtx.fillText("U", 12, 12.5);
  map.addImage("ubahn-station-icon", iconCtx.getImageData(0, 0, 24, 24));
  map.addImage("custom-poi-icon", makeIcon("#7dc4de", "C", "#25556e"));

  registerCategoryIcons();

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
    id: UBAHN_STATION_LAYER_ID,
    type: "symbol",
    source: UBAHN_STATION_SOURCE_ID,
    layout: {
      "icon-image": "ubahn-station-icon",
      "icon-size": 0.75,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });
  map.addLayer({
    id: POI_SPIDER_LEG_LAYER_ID,
    type: "line",
    source: POI_SPIDER_LEG_SOURCE_ID,
    paint: {
      "line-color": "#25556e",
      "line-width": 1.5,
      "line-opacity": 0.55,
    },
  });
  map.addLayer({
    id: POI_LAYER_ID,
    type: "symbol",
    source: POI_SOURCE_ID,
    layout: {
      "icon-image": [
        "case",
        ["==", ["get", "kind"], "custom"],
        "custom-poi-icon",
        ["get", "icon"],
      ],
      "icon-size": 0.75,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
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
  map.addLayer({
    id: SEARCHED_ADDRESS_LAYER_ID,
    type: "circle",
    source: SEARCHED_ADDRESS_SOURCE_ID,
    paint: {
      "circle-radius": 11,
      "circle-color": "#18201f",
      "circle-stroke-color": "#f06b4f",
      "circle-stroke-width": 4,
    },
  });

  bindMapInteractions();
  mapReady = true;

  registerChainIcons().catch((err) =>
    console.error("Failed to load chain icons", err),
  );
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
