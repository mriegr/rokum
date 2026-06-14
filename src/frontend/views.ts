import type { Apartment, ManagedPoi, StandardPoiCategory, WeightSettings } from "../shared/types";
import {
  categoryDisplayLabel,
  filteredManagedPois,
  groupedVisiblePois,
  isCategoryExpanded,
  managedPoiCategoryLabel,
  MANAGED_POI_CATEGORY_ORDER,
  POI_LABELS,
  poiIconKey,
  POI_TABLE_ROW_HEIGHT,
  POI_TABLE_OVERSCAN,
  state,
  standardPoiLabel,
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
import {
  existingPoiSubcategories,
  managedPoiKey,
  managedPoiSubcategories,
  poiTableWindowedSlice,
  summarizePoiCategories,
  summarizePoiSubcategories,
} from "./poiFilters";


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
        <button class="tab ${state.activeView === "categories" ? "is-active" : ""}" data-action="switch-view" data-view="categories">Categories</button>
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
          <span>${escapeHtml(standardPoiLabel(score.category))}</span>
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
  const categoryCount = summarizePoiCategories(state.pois).size;
  const subcategoryCount = summarizePoiSubcategories(state.pois).size;

  return `
    <div class="poi-overview-strip" aria-label="POI overview">
      <div><strong>${state.pois.length}</strong><span>total POIs</span></div>
      <div><strong>${activeCount}</strong><span>active</span></div>
      <div><strong>${inactiveCount}</strong><span>disabled</span></div>
      <div><strong>${categoryCount}</strong><span>categories</span></div>
      <div><strong>${subcategoryCount}</strong><span>subcategories</span></div>
    </div>
  `;
}

export function renderPoiToolbar(
  pois: ManagedPoi[],
  selection: { total: number; selected: number; allSelected: boolean },
) {
  return `
    <div class="poi-inventory-head">
      <div class="poi-title-block">
        <p class="eyebrow">Place inventory</p>
        <h2>Points of interest</h2>
        <p>Review every scoring destination, its classification, source, notes, and availability.</p>
      </div>
      <div class="poi-match-count" aria-live="polite">
        <strong>${pois.length}</strong>
        <span>of ${state.pois.length} matched</span>
      </div>
      <div class="bulk-actions poi-bulk-actions">
        <button
          class="ghost-button"
          data-action="edit-selected-poi"
          ${selection.selected === 1 ? "" : "disabled"}
        >
          Edit selected
        </button>
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
  const subcategorySummaries = Array.from(summarizePoiSubcategories(state.pois).entries());

  return `
    <div class="poi-filter-section poi-category-filter-section">
      <div class="poi-filter-head">
        <strong>Categories</strong>
        <div class="mini-actions">
          <button type="button" class="ghost-button compact-button" data-action="select-all-poi-categories">All</button>
          <button type="button" class="ghost-button compact-button" data-action="clear-poi-categories">None</button>
        </div>
      </div>
      <div class="poi-facet-list">
        ${MANAGED_POI_CATEGORY_ORDER.map((category) => {
          const summary = summaries.get(category) ?? { total: 0, active: 0 };
          const subcategories = subcategorySummaries
            .filter(([, item]) => item.category === category)
            .sort(([, left], [, right]) => left.label.localeCompare(right.label));
          return `
            <section class="poi-facet-group">
              <label class="poi-facet-parent">
                <input
                  type="checkbox"
                  data-action="toggle-managed-poi-category"
                  data-category="${category}"
                  ${state.visibleManagedPoiCategories[category] ? "checked" : ""}
                  ${summary.total ? "" : "disabled"}
                />
                <span><strong>${managedPoiCategoryLabel(category)}</strong><small>${summary.active} active / ${summary.total}</small></span>
              </label>
              ${
                subcategories.length
                  ? `<div class="poi-subcategory-list">${subcategories
                      .map(([key, item]) => `
                        <label>
                          <input
                            type="checkbox"
                            data-action="toggle-managed-poi-subcategory"
                            data-key="${escapeHtml(key)}"
                            ${state.selectedManagedSubcategories.includes(key) ? "checked" : ""}
                          />
                          <span>${
                            item.label
                              ? escapeHtml(categoryDisplayLabel(category, item.label, item.label))
                              : "No subcategory"
                          }</span>
                          <small>${item.total}</small>
                        </label>
                      `)
                      .join("")}</div>`
                  : ""
              }
            </section>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

export function renderPoiControls() {
  const activeFilters =
    Number(state.poiStatusFilter !== "all") +
    state.selectedManagedSubcategories.length +
    MANAGED_POI_CATEGORY_ORDER.filter((category) => !state.visibleManagedPoiCategories[category]).length;

  return `
    <div class="poi-command-bar">
      <label class="poi-search" aria-label="Search POIs">
        <span class="poi-search-icon" aria-hidden="true"></span>
        <input
          id="poi-search"
          type="search"
          value="${escapeHtml(state.poiSearch)}"
          placeholder="Search name, address, category, subcategory, note or source"
          autocomplete="off"
        />
      </label>
      <button type="button" class="poi-filter-trigger ${activeFilters ? "has-filters" : ""}" data-action="toggle-poi-filters" aria-expanded="${state.poiFiltersOpen}">
        <span>Filters</span>
        ${activeFilters ? `<strong>${activeFilters}</strong>` : ""}
      </button>
    </div>
    <div class="poi-filter-backdrop ${state.poiFiltersOpen ? "is-open" : ""}" data-action="close-poi-filters"></div>
    <aside class="poi-filter-drawer ${state.poiFiltersOpen ? "is-open" : ""}" aria-hidden="${!state.poiFiltersOpen}">
      <div class="poi-filter-drawer-head">
        <div><p class="eyebrow">Refine inventory</p><h3>Filters</h3></div>
        <button type="button" class="icon-button" data-action="close-poi-filters" aria-label="Close filters">&times;</button>
      </div>
      <div class="poi-filter-drawer-body">
        <div class="poi-filter-section">
          <div class="poi-filter-head"><strong>Active status</strong></div>
          <label class="sorter poi-status-select">
            <select id="poi-status-filter">
              <option value="all" ${state.poiStatusFilter === "all" ? "selected" : ""}>All statuses</option>
              <option value="active" ${state.poiStatusFilter === "active" ? "selected" : ""}>Active only</option>
              <option value="inactive" ${state.poiStatusFilter === "inactive" ? "selected" : ""}>Disabled only</option>
            </select>
          </label>
        </div>
        ${renderPoiCategoryFilters()}
      </div>
      <div class="poi-filter-drawer-foot">
        <button type="button" class="ghost-button" data-action="reset-poi-filters">Reset all</button>
        <button type="button" class="primary-button" data-action="close-poi-filters">Show ${filteredManagedPois().length} POIs</button>
      </div>
    </aside>
  `;
}

export function renderPoiRow(poi: ManagedPoi, selectedKeys: Set<string>) {
  const key = managedPoiKey(poi);
  const subcategories = managedPoiSubcategories(poi);
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
        <strong>${escapeHtml(poi.name)}</strong>
        <p>${escapeHtml(poi.address || "Address unavailable")}</p>
      </div>
      <div class="poi-taxonomy-cell">
        <span class="pill-badge ${poi.kind === "custom" ? "custom" : ""}">${escapeHtml(poi.categoryLabel)}</span>
        ${subcategories.length
          ? `<div class="poi-subcategory-chips">${subcategories.map((value) => `<span>${escapeHtml(categoryDisplayLabel(poi.category, value, value))}</span>`).join("")}</div>`
          : `<span class="poi-empty-value">No subcategory</span>`}
      </div>
      <div class="poi-notes-cell">
        ${poi.notes ? `<p>${escapeHtml(poi.notes)}</p>` : `<span class="poi-empty-value">No notes</span>`}
      </div>
      <div class="poi-source-cell">
        <strong>${escapeHtml(poi.source?.join(", ") ?? "Unknown")}</strong>
        <span>${poi.kind === "custom" ? "User supplied" : "Imported source"}</span>
      </div>
      <div class="poi-actions-cell">
        <span class="status-dot ${poi.isActive ? "active" : "inactive"}">${poi.isActive ? "Active" : "Disabled"}</span>
        <button
          class="ghost-button compact-button"
          data-action="edit-managed-poi"
          data-key="${key}"
        >
          Edit
        </button>
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

export function renderPoiEditor() {
  if (!state.editingManagedPoiKey) return "";
  const poi = state.pois.find((item) => managedPoiKey(item) === state.editingManagedPoiKey);
  if (!poi) return "";
  const subcategories = existingPoiSubcategories(state.pois, poi.category);
  if (poi.subcategory && !subcategories.includes(poi.subcategory)) subcategories.push(poi.subcategory);

  return `
    <div class="poi-editor-backdrop" data-action="close-poi-editor"></div>
    <aside class="poi-editor" aria-label="Edit ${escapeHtml(poi.name)}">
      <div class="poi-editor-head">
        <div><p class="eyebrow">Edit POI</p><h3>${escapeHtml(poi.name)}</h3></div>
        <button type="button" class="icon-button" data-action="close-poi-editor" aria-label="Close editor">&times;</button>
      </div>
      <form id="poi-editor-form" class="poi-editor-form">
        <input type="hidden" name="key" value="${escapeHtml(managedPoiKey(poi))}" />
        <label>Name<input name="name" required value="${escapeHtml(poi.name)}" /></label>
        <label>Address<input name="address" required value="${escapeHtml(poi.address)}" /></label>
        <label>Notes<textarea name="notes" rows="4">${escapeHtml(poi.notes)}</textarea></label>
        <label>Category
          <select id="poi-editor-category" name="category" ${poi.kind === "custom" ? "disabled" : ""}>
            ${MANAGED_POI_CATEGORY_ORDER.map((category) => `
              <option value="${category}" ${poi.category === category ? "selected" : ""} ${category === "custom" && poi.kind !== "custom" ? "disabled" : ""}>
                ${escapeHtml(managedPoiCategoryLabel(category))}
              </option>
            `).join("")}
          </select>
        </label>
        <label>Subcategory
          <select id="poi-editor-subcategory" name="subcategory" ${poi.kind === "custom" ? "disabled" : ""}>
            <option value="" ${poi.subcategory ? "" : "selected"}>No subcategory</option>
            ${subcategories.map((subcategory) => `
              <option value="${escapeHtml(subcategory)}" ${poi.subcategory === subcategory ? "selected" : ""}>
                ${escapeHtml(categoryDisplayLabel(poi.category, subcategory, subcategory))}
              </option>
            `).join("")}
          </select>
        </label>
        <p class="poi-editor-hint">${poi.kind === "custom" ? "Custom POIs keep the Custom category." : "Changing category or address updates scoring inputs."}</p>
        <div class="poi-editor-actions">
          <button type="button" class="ghost-button" data-action="close-poi-editor">Cancel</button>
          <button type="submit" class="primary-button">Save changes</button>
        </div>
      </form>
    </aside>
  `;
}

export function renderPoiTable(
  pois: ManagedPoi[],
  selection: { total: number; selected: number; allSelected: boolean },
) {
  const selectedKeys = new Set(state.selectedManagedPoiKeys);
  const viewportHeight = state.poiTableViewportHeight || 600;

  const selectionBar = `
    <div class="poi-selection-bar">
      <label class="select-all-toggle">
        <input
          id="poi-select-all"
          type="checkbox"
          ${selection.allSelected ? "checked" : ""}
          ${selection.total ? "" : "disabled"}
        />
        <span>Select visible</span>
      </label>
      <p>${selection.selected} selected</p>
    </div>`;

  const columnHead = `
    <div class="poi-column-head" aria-hidden="true">
      <span></span><span>POI and address</span><span>Category / subcategory</span><span>Notes</span><span>Source</span><span>Status</span>
    </div>`;

  if (!pois.length) {
    return `
      ${selectionBar}
      ${columnHead}
      <div class="poi-table">
        <div class="empty-state"><h2>No POIs match these filters</h2><p>Try a broader search or enable more categories.</p></div>
      </div>
    `;
  }

  const slice = poiTableWindowedSlice(
    pois.length,
    state.poiTableScrollTop,
    viewportHeight,
    POI_TABLE_ROW_HEIGHT,
    POI_TABLE_OVERSCAN,
  );

  const rowsHtml = pois
    .slice(slice.startIndex, slice.endIndex)
    .map((poi) => renderPoiRow(poi, selectedKeys))
    .join("");

  return `
    ${selectionBar}
    ${columnHead}
    <div class="poi-table-viewport" style="height:${viewportHeight}px">
      <div style="height:${slice.topSpacerHeight}px"></div>
      <div class="poi-table" role="group" aria-label="POI list">
        ${rowsHtml}
      </div>
      <div style="height:${slice.bottomSpacerHeight}px"></div>
    </div>
  `;
}

export function renderPoisView() {
  const pois = filteredManagedPois();
  const selection = visibleManagedPoiSelectionState();
  return `
    <section class="content-shell poi-admin-shell">
      <div id="poi-toolbar-region">${renderPoiToolbar(pois, selection)}</div>
      <div id="poi-stats-region">${renderPoiStats()}</div>
      <section class="poi-admin-panel poi-inventory-panel">
        <div id="poi-controls-region">${renderPoiControls()}</div>
        <div id="poi-table-region">${renderPoiTable(pois, selection)}</div>
      </section>
      ${renderPoiEditor()}
    </section>
  `;
}

function renderCategoryIconControls(category: string, subcategory: string, label: string, iconPath: string | null) {
  const iconSrc = iconPath;
  const preview = iconSrc
    ? `<img
          src="${escapeHtml(iconSrc)}"
          alt="${escapeHtml(label)}"
          width="28"
          height="28"
          crossorigin="anonymous"
        />`
    : `<span class="category-icon-fallback">${escapeHtml(label.charAt(0).toUpperCase())}</span>`;

  return `
    <div class="category-icon-block">
      <div class="category-icon-preview">
        ${preview}
      </div>
      <div class="category-icon-actions">
        <label class="ghost-button compact-button">
          Upload icon
          <input
            type="file"
            accept="image/png,image/svg+xml,image/x-icon"
            hidden
            data-action="upload-category-icon"
            data-category="${escapeHtml(category)}"
            data-subcategory="${escapeHtml(subcategory)}"
          />
        </label>
        ${
          iconPath
            ? `<button class="ghost-button compact-button danger" data-action="delete-category-icon" data-category="${escapeHtml(category)}" data-subcategory="${escapeHtml(subcategory)}">Reset</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderCategoryLabelForm(category: string, subcategory: string, currentLabel: string) {
  return `
    <form class="category-label-form" data-action="save-category-label">
      <input type="hidden" name="category" value="${escapeHtml(category)}" />
      <input type="hidden" name="subcategory" value="${escapeHtml(subcategory)}" />
      <label>
        ${subcategory ? "Subcategory name" : "Category name"}
        <input
          type="text"
          name="label"
          value="${escapeHtml(currentLabel)}"
          placeholder="${subcategory ? "Subcategory name" : "Category name"}"
          required
        />
      </label>
      <div class="category-label-actions">
        <button type="submit" class="ghost-button compact-button">Save</button>
        <button type="button" class="ghost-button compact-button" data-action="cancel-edit-category-label">Cancel</button>
      </div>
    </form>
  `;
}

function renderCategoryCountRow(itemCount: number, activeItemCount: number) {
  return `
    <div class="category-count-row">
      <span class="category-count-badge">${activeItemCount}/${itemCount} active</span>
      <span class="category-count-badge">${itemCount} items</span>
    </div>
  `;
}

function renderCategoryCard() {
  const categories = state.categoryManagement?.categories ?? [];

  return categories
    .map(
      (category) => {
        const expanded = isCategoryExpanded(category.category);
        const categoryKey = poiIconKey(category.category, "");
        const isEditingCategory = state.editingCategoryKey === categoryKey;

        return `
        <article class="category-card">
          <div class="category-card-head">
            <div class="category-title-block">
              <p class="eyebrow">Standard category</p>
              <div class="category-title-row">
                <h2>${escapeHtml(category.label)}</h2>
                ${renderCategoryCountRow(category.itemCount, category.activeItemCount)}
              </div>
            </div>
            <div class="category-head-actions">
              <button
                type="button"
                class="ghost-button compact-button"
                data-action="start-edit-category-label"
                data-category="${escapeHtml(category.category)}"
                data-subcategory=""
              >
                Edit
              </button>
              <button
                type="button"
                class="ghost-button compact-button"
                data-action="toggle-category-section"
                data-category="${escapeHtml(category.category)}"
              >
                ${expanded ? "Collapse" : `Subcategories (${category.subcategories.length})`}
              </button>
              ${renderCategoryIconControls(category.category, "", category.label, category.iconPath)}
            </div>
          </div>
          ${
            isEditingCategory
              ? renderCategoryLabelForm(
                  category.category,
                  "",
                  category.label,
                )
              : ""
          }
          <div class="category-subsection ${expanded ? "" : "is-collapsed"}">
            <div class="panel-block-head compact">
              <strong>Subcategories</strong>
              <span>${category.subcategories.length}</span>
            </div>
            ${
              category.subcategories.length
                ? `<div class="category-subcategory-list">
                    ${category.subcategories
                      .map(
                        (subcategory) => {
                          const subcategoryKey = poiIconKey(subcategory.category, subcategory.subcategory);
                          const isEditingSubcategory = state.editingCategoryKey === subcategoryKey;

                          return `
                          <div class="category-subcategory-row">
                            <div class="category-subcategory-head">
                              <div class="category-subcategory-meta">
                                <strong>${escapeHtml(subcategory.label)}</strong>
                                <p>${escapeHtml(categoryDisplayLabel(category.category, "", category.label))}</p>
                                ${renderCategoryCountRow(subcategory.itemCount, subcategory.activeItemCount)}
                              </div>
                              <div class="category-subcategory-actions">
                                <button
                                  type="button"
                                  class="ghost-button compact-button"
                                  data-action="start-edit-category-label"
                                  data-category="${escapeHtml(subcategory.category)}"
                                  data-subcategory="${escapeHtml(subcategory.subcategory)}"
                                >
                                  Edit
                                </button>
                                ${renderCategoryIconControls(
                                  subcategory.category,
                                  subcategory.subcategory,
                                  subcategory.label,
                                  subcategory.iconPath,
                                )}
                              </div>
                            </div>
                            ${
                              isEditingSubcategory
                                ? renderCategoryLabelForm(
                                    subcategory.category,
                                    subcategory.subcategory,
                                    subcategory.label,
                                  )
                                : ""
                            }
                          </div>
                        `;
                        },
                      )
                      .join("")}
                  </div>`
                : `<div class="empty-state compact"><p>No subcategories are stored for this category yet.</p></div>`
            }
          </div>
        </article>
      `;
      },
    )
    .join("");
}

export function renderCategoriesView() {
  const categories = state.categoryManagement?.categories ?? [];
  const totalItems = categories.reduce((sum, category) => sum + category.itemCount, 0);
  const activeItems = categories.reduce((sum, category) => sum + category.activeItemCount, 0);

  return `
    <section class="content-shell categories-shell">
      <section class="categories-hero">
        <div>
          <p class="eyebrow">Category management</p>
          <h2>Names, icons, and subcategories in one place</h2>
          <p>Manage the display names and icon overrides for standard POI categories and their stored subcategories.</p>
        </div>
        <div class="categories-hero-stats">
          <article class="poi-stat-card">
            <strong>${categories.length}</strong>
            <p>Categories</p>
          </article>
          <article class="poi-stat-card">
            <strong>${totalItems}</strong>
            <p>Stored POIs</p>
          </article>
          <article class="poi-stat-card">
            <strong>${activeItems}</strong>
            <p>Active POIs</p>
          </article>
        </div>
      </section>
      <section class="categories-grid">
        ${renderCategoryCard()}
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
          <p>Search any Munich address on the map, or add an apartment to see nearby POIs and scores.</p>
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
                  <span>${standardPoiLabel(category)}</span>
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
                  <strong>${escapeHtml(standardPoiLabel(score.category))}</strong>
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
                              <h3>${standardPoiLabel(category)}</h3>
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

export function renderMapAddressSearch() {
  const query = escapeHtml(state.mapAddressQuery);
  const hasSuggestions = state.mapAddressSuggestions.length > 0;
  const showDropdown =
    state.mapAddressSuggestionsOpen &&
    state.mapAddressQuery.trim().length >= 3 &&
    !state.mapAddressSelection;
  const statusMessage =
    state.mapAddressSearchStatus === "loading"
      ? "Searching addresses..."
      : state.mapAddressSearchStatus === "error"
        ? "Address search is temporarily unavailable."
        : !hasSuggestions && showDropdown
          ? "No matching addresses in the Munich area."
          : "";

  return `
    <form class="map-address-search" id="map-address-search" role="search">
      <div class="map-address-input-wrap">
        <span class="map-address-search-icon" aria-hidden="true"></span>
        <input
          id="map-address-input"
          type="search"
          value="${query}"
          placeholder="Search any Munich address"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-label="Search an address on the map"
          aria-autocomplete="list"
          aria-controls="map-address-suggestions"
          aria-expanded="${showDropdown}"
          aria-activedescendant="${
            state.mapAddressActiveSuggestionIndex >= 0
              ? `map-address-option-${state.mapAddressActiveSuggestionIndex}`
              : ""
          }"
        />
        ${
          state.mapAddressSelection || state.mapAddressQuery
            ? `<button class="map-address-clear" type="button" data-action="clear-map-address" aria-label="Clear searched address">&times;</button>`
            : ""
        }
      </div>
      <div
        id="map-address-suggestions"
        class="map-address-suggestions ${showDropdown ? "is-open" : ""}"
        role="listbox"
      >
        ${state.mapAddressSuggestions
          .map(
            (suggestion, index) => `
              <button
                id="map-address-option-${index}"
                class="map-address-option ${
                  index === state.mapAddressActiveSuggestionIndex ? "is-active" : ""
                }"
                type="button"
                role="option"
                aria-selected="${index === state.mapAddressActiveSuggestionIndex}"
                data-action="select-map-address"
                data-index="${index}"
              >
                <span class="map-address-pin" aria-hidden="true"></span>
                <span class="map-address-option-copy">
                  <strong>${escapeHtml(suggestion.label)}</strong>
                  ${
                    suggestion.address !== suggestion.label
                      ? `<small>${escapeHtml(suggestion.address)}</small>`
                      : ""
                  }
                </span>
              </button>
            `,
          )
          .join("")}
        ${statusMessage ? `<p class="map-address-status" role="status">${statusMessage}</p>` : ""}
      </div>
      ${
        state.mapAddressSelection
          ? `<p class="map-address-selection"><span></span>Showing searched location</p>`
          : ""
      }
    </form>
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
      <div class="map-stage">
        <div id="map-canvas" class="map-canvas">${disabledState}</div>
        ${
          mapIsAvailable(state.mapConfig)
            ? `<div id="map-address-search-region">${renderMapAddressSearch()}</div>`
            : ""
        }
      </div>
      <aside class="map-sidebar"></aside>
    </section>
  `;
}

export function updateMapAddressSearch(options?: { preserveFocus?: boolean }) {
  const region = document.querySelector<HTMLElement>("#map-address-search-region");
  if (!region || state.activeView !== "map") {
    return;
  }

  const previousInput = document.querySelector<HTMLInputElement>("#map-address-input");
  const shouldRestoreFocus = options?.preserveFocus && document.activeElement === previousInput;
  const selectionStart = previousInput?.selectionStart ?? state.mapAddressQuery.length;
  region.innerHTML = renderMapAddressSearch();

  if (shouldRestoreFocus) {
    const nextInput = region.querySelector<HTMLInputElement>("#map-address-input");
    nextInput?.focus();
    nextInput?.setSelectionRange(selectionStart, selectionStart);
  }
}

export function updateMapSidebar() {
  const sidebar = document.querySelector<HTMLElement>(".map-sidebar");
  if (!sidebar || state.activeView !== "map") {
    return;
  }

  sidebar.innerHTML = renderMapLegend();
}
