import type { Apartment, ManagedPoi, StandardPoiCategory, WeightSettings } from "../shared/types";
import {
  filteredManagedPois,
  groupedVisiblePois,
  MANAGED_POI_LABELS,
  MANAGED_POI_CATEGORY_ORDER,
  POI_LABELS,
  state,
  sortedApartments,
  visibleManagedPoiSelectionState,
  visibleNearbyPois,
} from "./state";
import {
  apartmentFormDefaults,
  customPoiDefaults,
  escapeHtml,
  formatCurrency,
  formatScore,
  mapIsAvailable,
  scoreTone,
} from "./helpers";
import { managedPoiKey, summarizePoiCategories, summarizeSportTags } from "./poiFilters";

export function renderTopbar() {
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
        <button class="tab ${state.activeView === "pois" ? "is-active" : ""}" data-action="switch-view" data-view="pois">POIs</button>
      </nav>
    </header>
  `;
}

export function renderScorePills(apartment: Apartment) {
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

export function renderApartmentCard(apartment: Apartment) {
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

export function renderApartmentForm() {
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

export function renderCustomPoiForm() {
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

export function renderSettingsForm() {
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

export function renderSidebar() {
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

export function renderListView() {
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

export function renderPoiStats() {
  const activeCount = state.pois.filter((poi) => poi.isActive).length;
  const inactiveCount = state.pois.length - activeCount;
  const standardCount = state.pois.filter((poi) => poi.kind === "standard").length;
  const customCount = state.pois.length - standardCount;

  return `
    <div class="poi-stat-grid">
      <article class="poi-stat-card">
        <span class="eyebrow">Total</span>
        <strong>${state.pois.length}</strong>
        <p>All cached and custom POIs</p>
      </article>
      <article class="poi-stat-card">
        <span class="eyebrow">Active</span>
        <strong>${activeCount}</strong>
        <p>${inactiveCount} currently excluded</p>
      </article>
      <article class="poi-stat-card">
        <span class="eyebrow">Standard</span>
        <strong>${standardCount}</strong>
        <p>Map and routing candidates</p>
      </article>
      <article class="poi-stat-card">
        <span class="eyebrow">Custom</span>
        <strong>${customCount}</strong>
        <p>User-managed scoring destinations</p>
      </article>
    </div>
  `;
}

export function renderPoiToolbar() {
  const pois = filteredManagedPois();
  const selection = visibleManagedPoiSelectionState();

  return `
    <div class="toolbar poi-toolbar">
      <div>
        <p class="toolbar-label">POI management</p>
        <strong>${pois.length}</strong>
        <span class="toolbar-meta">visible after current filters</span>
      </div>
      <div class="bulk-actions">
        <button
          class="ghost-button"
          data-action="bulk-poi-status"
          data-status="active"
          ${selection.selected ? "" : "disabled"}
        >
          Enable selected
        </button>
        <button
          class="ghost-button danger"
          data-action="bulk-poi-status"
          data-status="inactive"
          ${selection.selected ? "" : "disabled"}
        >
          Disable selected
        </button>
        <button
          class="ghost-button"
          data-action="bulk-visible-poi-status"
          data-status="active"
          ${selection.total ? "" : "disabled"}
        >
          Enable all visible
        </button>
        <button
          class="ghost-button danger"
          data-action="bulk-visible-poi-status"
          data-status="inactive"
          ${selection.total ? "" : "disabled"}
        >
          Disable all visible
        </button>
      </div>
    </div>
  `;
}

export function renderPoiCategoryFilters() {
  const summaries = summarizePoiCategories(state.pois);

  return `
    <div class="poi-filter-section">
      <div class="poi-filter-head">
        <strong>Categories</strong>
        <div class="mini-actions">
          <button type="button" class="ghost-button compact-button" data-action="select-all-poi-categories">All</button>
          <button type="button" class="ghost-button compact-button" data-action="clear-poi-categories">None</button>
        </div>
      </div>
      <div class="toggle-grid">
        ${MANAGED_POI_CATEGORY_ORDER.map((category) => {
          const summary = summaries.get(category) ?? { total: 0, active: 0 };
          return `
            <label class="filter-toggle">
              <input
                type="checkbox"
                data-action="toggle-managed-poi-category"
                data-category="${category}"
                ${state.visibleManagedPoiCategories[category] ? "checked" : ""}
                ${summary.total ? "" : "disabled"}
              />
              <span>${MANAGED_POI_LABELS[category]} (${summary.active}/${summary.total})</span>
            </label>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

export function renderPoiSportTagFilters() {
  const tagSummaries = Array.from(summarizeSportTags(state.pois).entries()).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (tagSummaries.length === 0) {
    return "";
  }

  return `
    <div class="poi-filter-section">
      <div class="poi-filter-head">
        <strong>Sport studio subcategories</strong>
        <div class="mini-actions">
          <button type="button" class="ghost-button compact-button" data-action="select-all-managed-sport-tags">All</button>
        </div>
      </div>
      <div class="tag-grid">
        ${tagSummaries
          .map(([tag, summary]) => {
            const isActive = state.selectedManagedSportTags.includes(tag);
            return `
              <button
                type="button"
                class="tag-chip ${isActive ? "is-active" : ""}"
                data-action="toggle-managed-sport-tag"
                data-tag="${escapeHtml(tag)}"
              >
                ${escapeHtml(tag)} (${summary.active}/${summary.total})
              </button>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

export function renderPoiControls() {
  return `
    <div class="poi-admin-controls">
      <label class="poi-search">
        Search POIs
        <input
          id="poi-search"
          type="search"
          value="${escapeHtml(state.poiSearch)}"
          placeholder="Name, address, category, source or tag"
          autocomplete="off"
        />
      </label>
      <label class="sorter">
        Status
        <select id="poi-status-filter">
          <option value="all" ${state.poiStatusFilter === "all" ? "selected" : ""}>All</option>
          <option value="active" ${state.poiStatusFilter === "active" ? "selected" : ""}>Active only</option>
          <option value="inactive" ${state.poiStatusFilter === "inactive" ? "selected" : ""}>Inactive only</option>
        </select>
      </label>
      <button type="button" class="ghost-button" data-action="reset-poi-filters">Clear filters</button>
    </div>
    <div class="poi-filter-grid">
      ${renderPoiCategoryFilters()}
      ${renderPoiSportTagFilters()}
    </div>
  `;
}

export function renderPoiRow(poi: ManagedPoi, selectedKeys: Set<string>) {
  const key = managedPoiKey(poi);
  return `
    <article class="poi-admin-row ${poi.isActive ? "" : "is-inactive"}">
      <label class="poi-select-cell">
        <input
          type="checkbox"
          data-action="toggle-managed-poi"
          data-key="${key}"
          ${selectedKeys.has(key) ? "checked" : ""}
        />
      </label>
      <div class="poi-main-cell">
        <div class="poi-row-head">
          <strong>${escapeHtml(poi.name)}</strong>
          <div class="poi-badges">
            <span class="pill-badge">${escapeHtml(poi.categoryLabel)}</span>
            <span class="pill-badge ${poi.kind === "custom" ? "custom" : ""}">${
              poi.kind === "custom" ? "Custom" : "Standard"
            }</span>
            <span class="status-dot ${poi.isActive ? "active" : "inactive"}">${
              poi.isActive ? "Active" : "Inactive"
            }</span>
          </div>
        </div>
        <p>${escapeHtml(poi.address || "Address unavailable")}</p>
        ${
          poi.tags.length
            ? `<div class="poi-tags">${poi.tags
                .slice(0, 4)
                .map((tag) => `<span class="mini-tag">${escapeHtml(tag)}</span>`)
                .join("")}</div>`
            : ""
        }
        ${poi.notes ? `<p class="poi-notes">${escapeHtml(poi.notes)}</p>` : ""}
      </div>
      <div class="poi-meta-cell">
        <p>${escapeHtml(poi.source ?? "n/a")}</p>
        <p>${poi.latitude !== null && poi.longitude !== null ? `${poi.latitude.toFixed(5)}, ${poi.longitude.toFixed(5)}` : "No coordinates"}</p>
      </div>
      <div class="poi-actions-cell">
        <button
          class="ghost-button compact-button ${poi.isActive ? "danger" : ""}"
          data-action="set-single-poi-status"
          data-key="${key}"
          data-status="${poi.isActive ? "inactive" : "active"}"
        >
          ${poi.isActive ? "Disable" : "Enable"}
        </button>
      </div>
    </article>
  `;
}

export function renderPoiTable() {
  const pois = filteredManagedPois();
  const selection = visibleManagedPoiSelectionState();
  const selectedKeys = new Set(state.selectedManagedPoiKeys);

  return `
    <div class="poi-table-header">
      <label class="select-all-toggle">
        <input
          id="poi-select-all"
          type="checkbox"
          ${selection.allSelected ? "checked" : ""}
          ${selection.total ? "" : "disabled"}
        />
        <span>Select visible</span>
      </label>
      <p>${selection.selected} selected · ${selection.total} visible</p>
    </div>
    <div class="poi-table">
      ${
        pois.length
          ? pois.map((poi) => renderPoiRow(poi, selectedKeys)).join("")
          : `<div class="empty-state"><h2>No POIs match these filters</h2><p>Try a broader search or enable more categories.</p></div>`
      }
    </div>
  `;
}

export function renderPoisView() {
  return `
    <section class="content-shell poi-admin-shell">
      <div id="poi-toolbar-region">${renderPoiToolbar()}</div>
      <div id="poi-stats-region">${renderPoiStats()}</div>
      <section class="poi-admin-panel">
        <div id="poi-controls-region">${renderPoiControls()}</div>
        <div id="poi-table-region">${renderPoiTable()}</div>
      </section>
    </section>
  `;
}

export function renderMapLegend() {
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

export function renderMapView() {
  const disabledState =
    !mapIsAvailable(state.mapConfig)
      ? `<div class="map-fallback"><div class="panel-block"><strong>Map disabled</strong><p>${escapeHtml(
          state.mapConfig.unavailableReason,
        )}</p></div></div>`
      : "";
  return `
    <section class="map-layout">
      <div id="map-canvas" class="map-canvas">${disabledState}</div>
      <aside class="map-sidebar"></aside>
    </section>
  `;
}

export function updateMapSidebar() {
  const sidebar = document.querySelector<HTMLElement>(".map-sidebar");
  if (!sidebar || state.activeView !== "map") {
    return;
  }

  sidebar.innerHTML = renderMapLegend();
}
