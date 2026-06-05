import "./styles.css";
import type {
  Apartment,
  BootstrapPayload,
  CustomPoi,
  PoiRecord,
  MapPayload,
  StandardPoiCategory,
  WeightSettings,
} from "./types";

declare global {
  interface Window {
    L?: any;
  }
}

type EditorMode = "create" | "edit";
type PanelView = "apartment" | "custom-poi" | "settings";
type SortMode = "score" | "warmmiete" | "pricePerSqm" | "rooms" | "newest";

type AppState = BootstrapPayload & {
  activeView: "list" | "map";
  selectedApartmentId: number | null;
  panelView: PanelView;
  apartmentEditorMode: EditorMode;
  editingApartmentId: number | null;
  editingCustomPoiId: number | null;
  sortMode: SortMode;
  mapPayload: MapPayload | null;
  visiblePoiCategories: Record<StandardPoiCategory, boolean>;
  showPoiList: boolean;
  selectedSportTags: string[];
  showTransitStops: boolean;
  showUbahnRoutes: boolean;
};

const rootElement = document.querySelector("#app");
if (!rootElement) {
  throw new Error("App root not found");
}
const root = rootElement as HTMLDivElement;

const initialView = window.location.pathname === "/map" ? "map" : "list";

const state: AppState = {
  apartments: [],
  customPois: [],
  settings: {
    pricePerSqm: 1.3,
    rooms: 0.9,
    supermarket: 1,
    sportStudio: 1,
    ubahn: 1.2,
    cafe: 0.7,
    parkOrRiver: 0.8,
    customPoi: 1.1,
  },
  activeView: initialView,
  selectedApartmentId: null,
  panelView: "apartment",
  apartmentEditorMode: "create",
  editingApartmentId: null,
  editingCustomPoiId: null,
  sortMode: "score",
  mapPayload: null,
  visiblePoiCategories: {
    supermarket: true,
    sport_studio: true,
    ubahn: true,
    cafe: true,
    park_or_river: true,
  },
  showPoiList: true,
  selectedSportTags: [],
  showTransitStops: true,
  showUbahnRoutes: true,
};

let map: any = null;
let markers: any[] = [];
let mapTileLayer: any = null;
let routeLayers: any[] = [];

const POI_LABELS: Record<StandardPoiCategory, string> = {
  supermarket: "Supermarkets",
  sport_studio: "Sport studios",
  ubahn: "U-Bahn",
  cafe: "Cafes",
  park_or_river: "Parks / river",
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatScore(value: number) {
  return `${value.toFixed(1)}/10`;
}

function scoreTone(value: number) {
  if (value >= 8) return "high";
  if (value >= 5) return "medium";
  return "low";
}

function currentApartment() {
  return state.apartments.find((apartment) => apartment.id === state.selectedApartmentId) ?? null;
}

function visibleNearbyPois() {
  const payload = state.mapPayload;
  if (!payload) {
    return [] as PoiRecord[];
  }

  return payload.nearbyPois.filter((poi) => {
    if (!state.visiblePoiCategories[poi.category]) {
      return false;
    }

    if (poi.category === "sport_studio" && state.selectedSportTags.length > 0) {
      return poi.tags.some((tag) => state.selectedSportTags.includes(tag));
    }

    return true;
  });
}

function groupedVisiblePois() {
  const grouped = new Map<StandardPoiCategory, PoiRecord[]>();
  for (const poi of visibleNearbyPois()) {
    const bucket = grouped.get(poi.category) ?? [];
    bucket.push(poi);
    grouped.set(poi.category, bucket);
  }
  return grouped;
}

function destroyMap() {
  if (map) {
    map.remove();
    map = null;
    mapTileLayer = null;
    markers = [];
    routeLayers = [];
  }
}

function sortedApartments() {
  const apartments = [...state.apartments];
  apartments.sort((left, right) => {
    switch (state.sortMode) {
      case "warmmiete":
        return left.warmmiete - right.warmmiete;
      case "pricePerSqm":
        return (
          (left.scoring.pricePerSqmValue ?? Number.POSITIVE_INFINITY) -
          (right.scoring.pricePerSqmValue ?? Number.POSITIVE_INFINITY)
        );
      case "rooms":
        return right.roomCount - left.roomCount;
      case "newest":
        return right.createdAt.localeCompare(left.createdAt);
      case "score":
      default:
        return right.totalScore - left.totalScore;
    }
  });
  return apartments;
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

async function loadBootstrap() {
  const payload = await requestJson<BootstrapPayload>("/api/bootstrap");
  state.apartments = payload.apartments;
  state.customPois = payload.customPois;
  state.settings = payload.settings;
  state.selectedApartmentId = payload.apartments[0]?.id ?? null;
  render();
  if (state.activeView === "map" && state.selectedApartmentId) {
    await loadMapPayload(state.selectedApartmentId);
  }
}

async function loadMapPayload(apartmentId: number) {
  state.mapPayload = await requestJson<MapPayload>(`/api/apartments/${apartmentId}/map`);
  state.selectedApartmentId = apartmentId;
  render();
  queueMicrotask(renderMap);
}

function apartmentFormDefaults() {
  const apartment =
    state.editingApartmentId === null
      ? null
      : state.apartments.find((item) => item.id === state.editingApartmentId) ?? null;

  return {
    address: apartment?.address ?? "",
    squareMeters: apartment?.squareMeters ?? 65,
    kaltmiete: apartment?.kaltmiete ?? 1200,
    warmmiete: apartment?.warmmiete ?? 1450,
    floorLevel: apartment?.floorLevel ?? "",
    roomCount: apartment?.roomCount ?? 2.5,
    description: apartment?.description ?? "",
  };
}

function customPoiDefaults() {
  const poi =
    state.editingCustomPoiId === null
      ? null
      : state.customPois.find((item) => item.id === state.editingCustomPoiId) ?? null;

  return {
    name: poi?.name ?? "",
    address: poi?.address ?? "",
    notes: poi?.notes ?? "",
    isActive: poi?.isActive ?? true,
  };
}

function renderTopbar() {
  return `
    <header class="topbar">
      <div class="brand-block">
        <span class="brand-mark">R</span>
        <div>
          <p class="eyebrow">Munich rental board</p>
          <h1>Rokum</h1>
        </div>
      </div>
      <nav class="tabs">
        <button class="tab ${state.activeView === "list" ? "is-active" : ""}" data-action="switch-view" data-view="list">List</button>
        <button class="tab ${state.activeView === "map" ? "is-active" : ""}" data-action="switch-view" data-view="map">Map</button>
      </nav>
    </header>
  `;
}

function renderScorePills(apartment: Apartment) {
  const breakdown = apartment.scoring;
  const standardPills = breakdown.standardPoiScores
    .map(
      (score) => `
        <div class="score-pill tone-${scoreTone(score.score)}">
          <span>${escapeHtml(score.label)}</span>
          <strong>${formatScore(score.score)}</strong>
        </div>
      `,
    )
    .join("");

  const customPills = breakdown.customPoiScores
    .map(
      (score) => `
        <div class="score-pill tone-${scoreTone(score.score)}">
          <span>${escapeHtml(score.name)}</span>
          <strong>${formatScore(score.score)}</strong>
        </div>
      `,
    )
    .join("");

  return standardPills + customPills;
}

function renderApartmentCard(apartment: Apartment) {
  const hero = apartment.photos[0]?.url;
  const pricePerSqm = apartment.scoring.pricePerSqmValue;

  return `
    <article class="apartment-card">
      <div class="card-media ${hero ? "" : "is-empty"}">
        ${
          hero
            ? `<img src="${hero}" alt="Apartment photo for ${escapeHtml(apartment.address)}" />`
            : `<div class="media-fallback">No photos yet</div>`
        }
      </div>
      <div class="card-body">
        <div class="card-head">
          <div>
            <p class="card-address">${escapeHtml(apartment.address)}</p>
            <p class="card-meta">
              ${apartment.squareMeters} m² · ${apartment.roomCount} rooms · Floor ${escapeHtml(
                apartment.floorLevel || "n/a",
              )}
            </p>
          </div>
          <div class="total-score">
            <span>Total</span>
            <strong>${formatScore(apartment.totalScore)}</strong>
          </div>
        </div>
        <div class="price-grid">
          <div><span>Warm rent</span><strong>${formatCurrency(apartment.warmmiete)}</strong></div>
          <div><span>Cold rent</span><strong>${formatCurrency(apartment.kaltmiete)}</strong></div>
          <div><span>€/m²</span><strong>${pricePerSqm ? pricePerSqm.toFixed(1) : "n/a"}</strong></div>
        </div>
        <p class="description">${escapeHtml(apartment.description || "No description added yet.")}</p>
        <div class="score-pills">
          ${renderScorePills(apartment)}
        </div>
        <div class="card-actions">
          <button class="ghost-button" data-action="open-map" data-id="${apartment.id}">Map</button>
          <button class="ghost-button" data-action="edit-apartment" data-id="${apartment.id}">Edit</button>
          <button class="ghost-button" data-action="refresh-score" data-id="${apartment.id}">Refresh</button>
          <button class="ghost-button danger" data-action="delete-apartment" data-id="${apartment.id}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function renderApartmentForm() {
  const defaults = apartmentFormDefaults();
  const editingApartment =
    state.editingApartmentId === null
      ? null
      : state.apartments.find((item) => item.id === state.editingApartmentId) ?? null;

  const existingPhotos = editingApartment
    ? editingApartment.photos
        .map(
          (photo) => `
            <div class="photo-chip">
              <img src="${photo.url}" alt="" />
              <button type="button" class="icon-button" data-action="delete-photo" data-apartment-id="${editingApartment.id}" data-photo-id="${photo.id}">×</button>
            </div>
          `,
        )
        .join("")
    : "";

  return `
    <section class="panel-shell ${state.panelView === "apartment" ? "" : "is-hidden"}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Listing editor</p>
          <h2>${state.apartmentEditorMode === "create" ? "Add apartment" : "Edit apartment"}</h2>
        </div>
        <button class="icon-button" data-action="prepare-create-apartment">+</button>
      </div>
      <form id="apartment-form" class="stack">
        <label>
          Address
          <input name="address" type="text" value="${escapeHtml(defaults.address)}" required />
        </label>
        <div class="two-up">
          <label>
            Square meters
            <input name="squareMeters" type="number" min="1" step="0.5" value="${defaults.squareMeters}" required />
          </label>
          <label>
            Rooms
            <input name="roomCount" type="number" min="0.5" step="0.5" value="${defaults.roomCount}" required />
          </label>
        </div>
        <div class="two-up">
          <label>
            Kaltmiete
            <input name="kaltmiete" type="number" min="0" step="1" value="${defaults.kaltmiete}" required />
          </label>
          <label>
            Warmmiete
            <input name="warmmiete" type="number" min="0" step="1" value="${defaults.warmmiete}" required />
          </label>
        </div>
        <label>
          Floor level
          <input name="floorLevel" type="text" value="${escapeHtml(defaults.floorLevel)}" />
        </label>
        <label>
          Description
          <textarea name="description" rows="4">${escapeHtml(defaults.description)}</textarea>
        </label>
        <label>
          Photos
          <input name="photos" type="file" accept="image/*" multiple />
        </label>
        ${existingPhotos ? `<div class="photo-strip">${existingPhotos}</div>` : ""}
        <button class="primary-button" type="submit">${
          state.apartmentEditorMode === "create" ? "Save apartment" : "Update apartment"
        }</button>
      </form>
    </section>
  `;
}

function renderCustomPoiForm() {
  const defaults = customPoiDefaults();
  return `
    <section class="panel-shell ${state.panelView === "custom-poi" ? "" : "is-hidden"}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Reusable destinations</p>
          <h2>${state.editingCustomPoiId === null ? "Add custom place" : "Edit custom place"}</h2>
        </div>
        <button class="icon-button" data-action="prepare-create-custom-poi">+</button>
      </div>
      <form id="custom-poi-form" class="stack">
        <label>
          Name
          <input name="name" type="text" value="${escapeHtml(defaults.name)}" required />
        </label>
        <label>
          Address
          <input name="address" type="text" value="${escapeHtml(defaults.address)}" required />
        </label>
        <label>
          Notes
          <textarea name="notes" rows="3">${escapeHtml(defaults.notes)}</textarea>
        </label>
        <label class="toggle-row">
          <input name="isActive" type="checkbox" ${defaults.isActive ? "checked" : ""} />
          <span>Include in every apartment score</span>
        </label>
        <button class="primary-button" type="submit">${
          state.editingCustomPoiId === null ? "Save custom place" : "Update custom place"
        }</button>
      </form>
      <div class="stack compact">
        ${state.customPois
          .map(
            (poi) => `
              <article class="mini-card">
                <div>
                  <strong>${escapeHtml(poi.name)}</strong>
                  <p>${escapeHtml(poi.address)}</p>
                </div>
                <div class="mini-actions">
                  <button class="ghost-button" data-action="edit-custom-poi" data-id="${poi.id}">Edit</button>
                  <button class="ghost-button danger" data-action="delete-custom-poi" data-id="${poi.id}">Delete</button>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSettingsForm() {
  return `
    <section class="panel-shell ${state.panelView === "settings" ? "" : "is-hidden"}">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Global weights</p>
          <h2>Scoring balance</h2>
        </div>
      </div>
      <form id="settings-form" class="stack">
        ${[
          ["pricePerSqm", "Price per m²"],
          ["rooms", "Rooms"],
          ["supermarket", "Supermarket"],
          ["sportStudio", "Sport studio"],
          ["ubahn", "U-Bahn"],
          ["cafe", "Cafes"],
          ["parkOrRiver", "Park or river"],
          ["customPoi", "Custom places"],
        ]
          .map(
            ([key, label]) => `
              <label>
                ${label}
                <input name="${key}" type="number" min="0" step="0.1" value="${
                  state.settings[key as keyof WeightSettings]
                }" />
              </label>
            `,
          )
          .join("")}
        <button class="primary-button" type="submit">Save weights</button>
      </form>
    </section>
  `;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <div class="sidebar-tabs">
        <button class="tab ${state.panelView === "apartment" ? "is-active" : ""}" data-action="show-panel" data-panel="apartment">Apartment</button>
        <button class="tab ${state.panelView === "custom-poi" ? "is-active" : ""}" data-action="show-panel" data-panel="custom-poi">Custom places</button>
        <button class="tab ${state.panelView === "settings" ? "is-active" : ""}" data-action="show-panel" data-panel="settings">Weights</button>
      </div>
      ${renderApartmentForm()}
      ${renderCustomPoiForm()}
      ${renderSettingsForm()}
    </aside>
  `;
}

function renderListView() {
  return `
    <section class="content-shell">
      <div class="toolbar">
        <div>
          <p class="toolbar-label">Saved apartments</p>
          <strong>${state.apartments.length}</strong>
        </div>
        <label class="sorter">
          Sort by
          <select id="sort-mode">
            <option value="score" ${state.sortMode === "score" ? "selected" : ""}>Total score</option>
            <option value="warmmiete" ${state.sortMode === "warmmiete" ? "selected" : ""}>Warm rent</option>
            <option value="pricePerSqm" ${state.sortMode === "pricePerSqm" ? "selected" : ""}>€/m²</option>
            <option value="rooms" ${state.sortMode === "rooms" ? "selected" : ""}>Rooms</option>
            <option value="newest" ${state.sortMode === "newest" ? "selected" : ""}>Newest</option>
          </select>
        </label>
      </div>
      <div class="list-layout">
        <div class="apartment-feed">
          ${
            state.apartments.length
              ? sortedApartments().map(renderApartmentCard).join("")
              : `<div class="empty-state"><h2>No apartments saved yet</h2><p>Use the apartment panel to add the first listing, upload photos, and let the app calculate walking and transit scores.</p></div>`
          }
        </div>
        ${renderSidebar()}
      </div>
    </section>
  `;
}

function renderMapLegend() {
  const payload = state.mapPayload;
  if (!payload) {
    return `
      <div class="map-legend stack compact">
        <div class="selector-block">
          <label>
            Apartment focus
            <select id="map-apartment-selector" ${state.apartments.length ? "" : "disabled"}>
              ${
                state.apartments.length
                  ? state.apartments
                      .map(
                        (apartment) => `
                          <option value="${apartment.id}" ${
                            apartment.id === state.selectedApartmentId ? "selected" : ""
                          }>
                            ${escapeHtml(apartment.address)}
                          </option>
                        `,
                      )
                      .join("")
                  : `<option>No apartments yet</option>`
              }
            </select>
          </label>
        </div>
        <div class="empty-state compact">
          <h2>No map focus yet</h2>
          <p>Add an apartment or select one from the list to see nearby POIs.</p>
        </div>
      </div>
    `;
  }

  return `
    <div class="map-legend stack compact">
      <div class="map-controls stack">
        <div class="panel-block">
          <div class="panel-block-head">
            <strong>POIs on map</strong>
            <button class="ghost-button compact-button" data-action="toggle-poi-list">
              ${state.showPoiList ? "Hide list" : "Show list"}
            </button>
          </div>
          <div class="toggle-grid">
            ${(
              Object.keys(POI_LABELS) as StandardPoiCategory[]
            ).map(
              (category) => `
                <label class="filter-toggle">
                  <input
                    type="checkbox"
                    data-action="toggle-poi-category"
                    data-category="${category}"
                    ${state.visiblePoiCategories[category] ? "checked" : ""}
                  />
                  <span>${POI_LABELS[category]}</span>
                </label>
              `,
            ).join("")}
          </div>
        </div>
        <div class="panel-block">
          <div class="panel-block-head">
            <strong>Transit overlay</strong>
          </div>
          <div class="toggle-grid">
            <label class="filter-toggle">
              <input
                type="checkbox"
                data-action="toggle-transit-stops"
                ${state.showTransitStops ? "checked" : ""}
              />
              <span>Haltestellen</span>
            </label>
            <label class="filter-toggle">
              <input
                type="checkbox"
                data-action="toggle-ubahn-routes"
                ${state.showUbahnRoutes ? "checked" : ""}
              />
              <span>U-Bahn routes</span>
            </label>
          </div>
        </div>
        ${
          payload.sportStudioTags.length
            ? `
              <div class="panel-block">
                <div class="panel-block-head">
                  <strong>Sport studio types</strong>
                  <button class="ghost-button compact-button" data-action="clear-sport-tags">All</button>
                </div>
                <div class="tag-grid">
                  ${payload.sportStudioTags
                    .map(
                      (tag) => `
                        <button
                          class="tag-chip ${state.selectedSportTags.includes(tag) ? "is-active" : ""}"
                          data-action="toggle-sport-tag"
                          data-tag="${escapeHtml(tag)}"
                        >
                          ${escapeHtml(tag)}
                        </button>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
      </div>
      <div class="selector-block">
        <label>
          Apartment focus
          <select id="map-apartment-selector">
            ${state.apartments
              .map(
                (apartment) => `
                  <option value="${apartment.id}" ${
                    apartment.id === state.selectedApartmentId ? "selected" : ""
                  }>
                    ${escapeHtml(apartment.address)}
                  </option>
                `,
              )
              .join("")}
          </select>
        </label>
      </div>
      <article class="focus-card">
        <p class="eyebrow">Selected apartment</p>
        <h2>${escapeHtml(payload.apartment.address)}</h2>
        <p>${payload.apartment.squareMeters} m² · ${payload.apartment.roomCount} rooms · ${formatCurrency(
          payload.apartment.warmmiete,
        )}</p>
      </article>
      <div class="score-table">
        ${payload.standardPoiScores
          .map(
            (score) => `
              <div class="score-row">
                <div>
                  <strong>${escapeHtml(score.label)}</strong>
                  <p>${escapeHtml(score.poiName)}</p>
                </div>
                <div>
                  <p>Walk ${score.walking.durationMinutes ?? "n/a"} min</p>
                  <p>Transit ${score.transit.durationMinutes ?? "n/a"} min</p>
                  <strong>${formatScore(score.score)}</strong>
                </div>
              </div>
            `,
          )
          .join("")}
        ${payload.customPoiScores
          .map(
            (score) => `
              <div class="score-row custom">
                <div>
                  <strong>${escapeHtml(score.name)}</strong>
                  <p>${escapeHtml(score.address)}</p>
                </div>
                <div>
                  <p>Walk ${score.walking.durationMinutes ?? "n/a"} min</p>
                  <p>Transit ${score.transit.durationMinutes ?? "n/a"} min</p>
                  <strong>${formatScore(score.score)}</strong>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
      ${
        state.showPoiList
          ? `
            <div class="poi-list-block">
              <div class="panel-block-head">
                <strong>Visible POIs</strong>
                <span>${visibleNearbyPois().length}</span>
              </div>
              <div class="poi-list">
                ${
                  visibleNearbyPois().length
                    ? Array.from(groupedVisiblePois().entries())
                        .map(
                          ([category, pois]) => `
                            <section class="poi-group">
                              <h3>${POI_LABELS[category]}</h3>
                              ${pois
                                .map(
                                  (poi) => `
                                    <article class="poi-row">
                                      <div>
                                        <strong>${escapeHtml(poi.name)}</strong>
                                        <p>${escapeHtml(poi.address || "Address unavailable")}</p>
                                      </div>
                                      ${
                                        poi.category === "sport_studio" && poi.tags.length
                                          ? `<div class="poi-tags">${poi.tags
                                              .slice(0, 3)
                                              .map(
                                                (tag) =>
                                                  `<span class="mini-tag">${escapeHtml(tag)}</span>`,
                                              )
                                              .join("")}</div>`
                                          : ""
                                      }
                                    </article>
                                  `,
                                )
                                .join("")}
                            </section>
                          `,
                        )
                        .join("")
                    : `<div class="empty-state compact"><p>No POIs match the current filters.</p></div>`
                }
              </div>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderMapView() {
  return `
    <section class="map-layout">
      <div id="map-canvas" class="map-canvas"></div>
      <aside class="map-sidebar">
        ${renderMapLegend()}
      </aside>
    </section>
  `;
}

function render() {
  if (state.activeView === "map" || map) {
    destroyMap();
  }

  root.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${state.activeView === "list" ? renderListView() : renderMapView()}
    </div>
  `;

  bindEvents();

  if (state.activeView === "map") {
    queueMicrotask(renderMap);
  }
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const target = event.currentTarget as HTMLElement;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "switch-view") {
        const view = target.dataset.view === "map" ? "map" : "list";
        state.activeView = view;
        window.history.replaceState({}, "", view === "map" ? "/map" : "/");
        render();
        if (view === "map" && state.selectedApartmentId) {
          await loadMapPayload(state.selectedApartmentId);
        }
      }

      if (action === "show-panel") {
        state.panelView = target.dataset.panel as PanelView;
        render();
      }

      if (action === "prepare-create-apartment") {
        state.panelView = "apartment";
        state.apartmentEditorMode = "create";
        state.editingApartmentId = null;
        render();
      }

      if (action === "prepare-create-custom-poi") {
        state.panelView = "custom-poi";
        state.editingCustomPoiId = null;
        render();
      }

      if (action === "edit-apartment") {
        state.panelView = "apartment";
        state.apartmentEditorMode = "edit";
        state.editingApartmentId = Number(target.dataset.id);
        render();
      }

      if (action === "edit-custom-poi") {
        state.panelView = "custom-poi";
        state.editingCustomPoiId = Number(target.dataset.id);
        render();
      }

      if (action === "open-map") {
        const apartmentId = Number(target.dataset.id);
        state.activeView = "map";
        window.history.replaceState({}, "", "/map");
        await loadMapPayload(apartmentId);
      }

      if (action === "refresh-score") {
        const apartmentId = Number(target.dataset.id);
        const apartment = await requestJson<Apartment>(
          `/api/apartments/${apartmentId}/refresh-score`,
          { method: "POST" },
        );
        state.apartments = state.apartments.map((item) =>
          item.id === apartment.id ? apartment : item,
        );
        if (state.selectedApartmentId === apartment.id && state.activeView === "map") {
          await loadMapPayload(apartment.id);
        } else {
          render();
        }
      }

      if (action === "delete-apartment") {
        const apartmentId = Number(target.dataset.id);
        if (!window.confirm("Delete this apartment listing?")) return;
        await requestJson(`/api/apartments/${apartmentId}`, { method: "DELETE" });
        state.apartments = state.apartments.filter((item) => item.id !== apartmentId);
        if (state.selectedApartmentId === apartmentId) {
          state.selectedApartmentId = state.apartments[0]?.id ?? null;
        }
        render();
      }

      if (action === "delete-custom-poi") {
        const customPoiId = Number(target.dataset.id);
        if (!window.confirm("Delete this custom place?")) return;
        await requestJson(`/api/custom-pois/${customPoiId}`, { method: "DELETE" });
        state.customPois = state.customPois.filter((item) => item.id !== customPoiId);
        const bootstrap = await requestJson<BootstrapPayload>("/api/bootstrap");
        state.apartments = bootstrap.apartments;
        state.settings = bootstrap.settings;
        render();
      }

      if (action === "delete-photo") {
        const apartmentId = Number(target.dataset.apartmentId);
        const photoId = Number(target.dataset.photoId);
        await requestJson(`/api/apartments/${apartmentId}/photos/${photoId}`, {
          method: "DELETE",
        });
        const refreshed = await requestJson<Apartment>(`/api/apartments/${apartmentId}/refresh-score`, {
          method: "POST",
        });
        state.apartments = state.apartments.map((item) =>
          item.id === refreshed.id ? refreshed : item,
        );
        state.editingApartmentId = apartmentId;
        state.apartmentEditorMode = "edit";
        render();
      }

      if (action === "toggle-poi-list") {
        state.showPoiList = !state.showPoiList;
        render();
      }

      if (action === "toggle-transit-stops") {
        state.showTransitStops = !state.showTransitStops;
        render();
      }

      if (action === "toggle-ubahn-routes") {
        state.showUbahnRoutes = !state.showUbahnRoutes;
        render();
      }

      if (action === "clear-sport-tags") {
        state.selectedSportTags = [];
        render();
      }

      if (action === "toggle-sport-tag") {
        const tag = target.dataset.tag;
        if (!tag) return;
        state.selectedSportTags = state.selectedSportTags.includes(tag)
          ? state.selectedSportTags.filter((value) => value !== tag)
          : [...state.selectedSportTags, tag];
        render();
      }
    });
  });

  document
    .querySelectorAll<HTMLInputElement>('input[data-action="toggle-poi-category"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        const category = input.dataset.category as StandardPoiCategory | undefined;
        if (!category) return;
        state.visiblePoiCategories[category] = input.checked;
        render();
      });
    });

  const apartmentForm = document.querySelector<HTMLFormElement>("#apartment-form");
  apartmentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(apartmentForm);
    const payload = {
      address: String(formData.get("address") ?? ""),
      squareMeters: Number(formData.get("squareMeters") ?? 0),
      kaltmiete: Number(formData.get("kaltmiete") ?? 0),
      warmmiete: Number(formData.get("warmmiete") ?? 0),
      floorLevel: String(formData.get("floorLevel") ?? ""),
      roomCount: Number(formData.get("roomCount") ?? 0),
      description: String(formData.get("description") ?? ""),
    };

    const apartment =
      state.apartmentEditorMode === "create"
        ? await requestJson<Apartment>("/api/apartments", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : await requestJson<Apartment>(`/api/apartments/${state.editingApartmentId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

    const files = apartmentForm.querySelector<HTMLInputElement>('input[name="photos"]')?.files;
    if (files && files.length > 0) {
      const photoForm = new FormData();
      Array.from(files).forEach((file) => photoForm.append("photos", file));
      const uploadedApartment = await fetch(`/api/apartments/${apartment.id}/photos`, {
        method: "POST",
        body: photoForm,
      }).then((response) => response.json() as Promise<Apartment>);
      state.apartments = state.apartments.filter((item) => item.id !== apartment.id);
      state.apartments.unshift(uploadedApartment);
    } else {
      state.apartments = state.apartments.filter((item) => item.id !== apartment.id);
      state.apartments.unshift(apartment);
    }

    state.selectedApartmentId = apartment.id;
    state.apartmentEditorMode = "edit";
    state.editingApartmentId = apartment.id;
    render();
  });

  const customPoiForm = document.querySelector<HTMLFormElement>("#custom-poi-form");
  customPoiForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(customPoiForm);
    const payload = {
      name: String(formData.get("name") ?? ""),
      address: String(formData.get("address") ?? ""),
      notes: String(formData.get("notes") ?? ""),
      isActive: formData.get("isActive") === "on",
    };

    const poi =
      state.editingCustomPoiId === null
        ? await requestJson<CustomPoi>("/api/custom-pois", {
            method: "POST",
            body: JSON.stringify(payload),
          })
        : await requestJson<CustomPoi>(`/api/custom-pois/${state.editingCustomPoiId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });

    state.customPois = state.customPois.filter((item) => item.id !== poi.id);
    state.customPois.push(poi);
    const bootstrap = await requestJson<BootstrapPayload>("/api/bootstrap");
    state.apartments = bootstrap.apartments;
    state.settings = bootstrap.settings;
    state.editingCustomPoiId = poi.id;
    render();
  });

  const settingsForm = document.querySelector<HTMLFormElement>("#settings-form");
  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(settingsForm);
    const payload = Object.fromEntries(formData.entries());
    const response = await requestJson<{ settings: WeightSettings; apartments: Apartment[] }>(
      "/api/settings",
      {
        method: "PUT",
        body: JSON.stringify(payload),
      },
    );
    state.settings = response.settings;
    state.apartments = response.apartments;
    render();
  });

  const sortSelect = document.querySelector<HTMLSelectElement>("#sort-mode");
  sortSelect?.addEventListener("change", () => {
    state.sortMode = sortSelect.value as SortMode;
    render();
  });

  const mapApartmentSelector =
    document.querySelector<HTMLSelectElement>("#map-apartment-selector");
  mapApartmentSelector?.addEventListener("change", async () => {
    const apartmentId = Number(mapApartmentSelector.value);
    await loadMapPayload(apartmentId);
  });
}

function renderMap() {
  if (state.activeView !== "map") {
    return;
  }

  const mapElement = document.querySelector<HTMLElement>("#map-canvas");
  if (!mapElement || !window.L) {
    if (mapElement) {
      mapElement.innerHTML = `<div class="map-fallback">Map library did not load.</div>`;
    }
    return;
  }

  if (map && map.getContainer() !== mapElement) {
    destroyMap();
  }

  if (!map) {
    map = window.L.map("map-canvas", {
      zoomControl: true,
      scrollWheelZoom: true,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
    });
    mapTileLayer = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    mapTileLayer.addTo(map);
  }

  setTimeout(() => map?.invalidateSize(), 0);

  markers.forEach((marker) => marker.remove());
  markers = [];
  routeLayers.forEach((layer) => layer.remove());
  routeLayers = [];

  const payload = state.mapPayload;
  if (!payload || payload.apartment.latitude === null || payload.apartment.longitude === null) {
    map.setView([48.137154, 11.576124], 12);
    return;
  }

  const apartmentLatLng = [payload.apartment.latitude, payload.apartment.longitude];
  const apartmentMarker = window.L.marker(apartmentLatLng).addTo(map);
  apartmentMarker.bindPopup(`<strong>${escapeHtml(payload.apartment.address)}</strong>`);
  markers.push(apartmentMarker);

  if (state.showUbahnRoutes) {
    for (const route of payload.ubahnRoutes) {
      for (const path of route.paths) {
        const polyline = window.L.polyline(
          path.map((point) => [point.latitude, point.longitude]),
          {
            color: route.color || "#0056b8",
            weight: 4,
            opacity: 0.65,
          },
        ).addTo(map);
        polyline.bindPopup(
          `<strong>${escapeHtml(route.ref || route.name)}</strong><br />${escapeHtml(
            route.name,
          )}`,
        );
        routeLayers.push(polyline);
      }
    }
  }

  for (const poi of visibleNearbyPois()) {
    const isSportStudio = poi.category === "sport_studio";
    const marker = window.L.circleMarker([poi.latitude, poi.longitude], {
      radius: isSportStudio ? 7 : 6,
      color: isSportStudio ? "#0f6b57" : "#275d8a",
      fillColor: isSportStudio ? "#7ad3b0" : "#b7d5ea",
      fillOpacity: 0.92,
      weight: 2,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${escapeHtml(poi.name)}</strong><br />${escapeHtml(
        POI_LABELS[poi.category],
      )}<br />${escapeHtml(poi.address || "Address unavailable")}${
        poi.tags.length ? `<br />${escapeHtml(poi.tags.join(", "))}` : ""
      }`,
    );
    markers.push(marker);
  }

  if (state.showTransitStops) {
    for (const stop of payload.transitStops) {
      const marker = window.L.circleMarker([stop.latitude, stop.longitude], {
        radius: 5,
        color: "#101820",
        fillColor: "#ffe55c",
        fillOpacity: 0.95,
        weight: 2,
      }).addTo(map);
      marker.bindPopup(
        `<strong>${escapeHtml(stop.name)}</strong><br />${escapeHtml(
          stop.modes.join(", "),
        )}`,
      );
      markers.push(marker);
    }
  }

  for (const score of payload.customPoiScores) {
    const marker = window.L.circleMarker([score.latitude, score.longitude], {
      radius: 8,
      color: "#25556e",
      fillColor: "#7dc4de",
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(map);
    marker.bindPopup(
      `<strong>${escapeHtml(score.name)}</strong><br />Walk ${
        score.walking.durationMinutes ?? "n/a"
      } min · Transit ${score.transit.durationMinutes ?? "n/a"} min`,
    );
    markers.push(marker);
  }

  const bounds = window.L.latLngBounds(markers.map((marker) => marker.getLatLng()));
  map.fitBounds(bounds.pad(0.25));
  setTimeout(() => map?.invalidateSize(), 80);
}

loadBootstrap().catch((error) => {
  root.innerHTML = `<div class="fatal-error"><h1>App failed to load</h1><p>${escapeHtml(
    error instanceof Error ? error.message : "Unknown error",
  )}</p></div>`;
});
