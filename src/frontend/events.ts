import type {
  Apartment,
  BootstrapPayload,
  CustomPoi,
  MapPayload,
  ManagedPoi,
  PoiCategoryManagementPayload,
  PoiCategory,
  PoiIconMapping,
  PoiManagementPayload,
  StandardPoiCategory,
  WeightSettings,
} from "../shared/types";
import type { MapAddressSuggestion, PanelView, SortMode } from "./state";
import {
  categoryDisplayLabel,
  filteredManagedPois,
  isCategoryExpanded,
  MANAGED_POI_CATEGORY_ORDER,
  poiIconKey,
  root,
  setPoiCategoryLabels,
  selectedManagedPois,
  state,
  visibleManagedPoiKeys,
  visibleManagedPoiSelectionState,
} from "./state";
import {
  escapeHtml,
  mapIsAvailable,
  requestJson,
} from "./helpers";
import {
  poiTableWindowedSlice,
} from "./poiFilters";
import {
  POI_TABLE_ROW_HEIGHT,
  POI_TABLE_OVERSCAN,
} from "./state";
import {
  renderListView,
  renderMapLegend,
  renderMapView,
  renderPoiControls,
  renderPoiRow,
  renderPoiStats,
  renderPoiTable,
  renderPoiToolbar,
  renderCategoriesView,
  renderPoisView,
  renderTopbar,
  updateMapAddressSearch,
  updateMapSidebar,
} from "./views";
import {
  destroyMap,
  focusSearchedAddress,
  renderMap,
} from "./map";
import {
  existingPoiSubcategories,
  indexManagedPois,
  managedPoiKey,
  type PoiStatusFilter,
} from "./poiFilters";

let poiSearchUpdateTimer: number | null = null;
let mapAddressSearchTimer: number | null = null;
let mapAddressSearchSequence = 0;

type MapAddressSearchResponse = {
  displayLabel: string;
  address: string;
  latitude: number;
  longitude: number;
};

export function render() {
  if (state.activeView !== "map" && mapIsAvailable(state.mapConfig)) {
    destroyMap();
  }

  root.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${
        state.activeView === "list"
          ? renderListView()
          : state.activeView === "map"
            ? renderMapView()
            : state.activeView === "pois"
              ? renderPoisView()
              : renderCategoriesView()
      }
    </div>
  `;

  bindEvents();

  if (state.activeView === "map") {
    bindMapAddressSearchEvents();
    updateMapSidebar();
    const sidebar = document.querySelector<HTMLElement>(".map-sidebar");
    if (sidebar) bindMapSidebarEvents(sidebar);
    queueMicrotask(() => renderMap());
  }
}

function bindEvents() {
  document.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const target = event.currentTarget as HTMLElement;
      if (target.closest(".map-sidebar")) {
        return;
      }
      if (target.closest(".poi-admin-shell")) {
        return;
      }
      const action = target.dataset.action;
      if (!action) return;

      if (action === "switch-view") {
        const view =
          target.dataset.view === "map"
            ? "map"
            : target.dataset.view === "pois"
              ? "pois"
              : target.dataset.view === "categories"
                ? "categories"
              : "list";
        state.activeView = view;
        window.history.replaceState(
          {},
          "",
          view === "map"
            ? "/map"
            : view === "pois"
              ? "/pois"
              : view === "categories"
                ? "/categories"
                : "/",
        );
        if (view === "pois") {
          await loadPoiManagement();
        }
        if (view === "categories") {
          await loadCategoryManagement();
        }
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
        await refreshAppData({ refreshMap: true, refreshPois: state.poisLoaded });
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
    state.editingCustomPoiId = poi.id;
    await refreshAppData({ refreshMap: true, refreshPois: state.poisLoaded });
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

  bindPoiAdminEvents();
  bindCategoryAdminEvents();
}

export async function loadBootstrap() {
  const payload = await requestJson<BootstrapPayload>("/api/bootstrap");
  state.apartments = payload.apartments;
  state.customPois = payload.customPois;
  state.settings = payload.settings;
  state.mapConfig = payload.mapConfig;
  state.poiCategoryLabels = payload.poiCategoryLabels;
  setPoiCategoryLabels(payload.poiCategoryLabels);
  state.selectedApartmentId = payload.apartments[0]?.id ?? null;
  render();
  if (state.activeView === "map" && state.selectedApartmentId && mapIsAvailable(state.mapConfig)) {
    await loadMapPayload(state.selectedApartmentId);
  }
}

export async function loadPoiManagement(force = false) {
  if (state.poisLoaded && !force) {
    return;
  }

  const [poisPayload, iconsPayload] = await Promise.all([
    requestJson<PoiManagementPayload>("/api/pois"),
    requestJson<PoiIconMapping>("/api/poi-icons"),
  ]);
  state.pois = poisPayload.pois;
  state.indexedPois = indexManagedPois(poisPayload.pois);
  state.poisLoaded = true;
  state.selectedManagedPoiKeys = state.selectedManagedPoiKeys.filter((key) =>
    poisPayload.pois.some((poi) => managedPoiKey(poi) === key),
  );
  const iconMap = new Map<string, string>();
  for (const icon of iconsPayload.icons) {
    iconMap.set(`${icon.category}:${icon.subcategory}`, icon.iconPath);
  }
  state.managedPoiIcons = iconMap;
}

export async function loadCategoryManagement(force = false) {
  if (state.categoriesLoaded && !force) {
    return;
  }

  const [payload, iconsPayload] = await Promise.all([
    requestJson<PoiCategoryManagementPayload>("/api/categories"),
    requestJson<PoiIconMapping>("/api/poi-icons"),
  ]);
  state.categoryManagement = payload;
  state.categoriesLoaded = true;
  const visibleCategoryKeys = payload.categories.map((category) => poiIconKey(category.category, ""));
  state.expandedCategoryKeys = state.expandedCategoryKeys.filter((key) => visibleCategoryKeys.includes(key));
  const iconMap = new Map<string, string>();
  for (const icon of iconsPayload.icons) {
    iconMap.set(`${icon.category}:${icon.subcategory}`, icon.iconPath);
  }
  state.managedPoiIcons = iconMap;
  setPoiCategoryLabels(
    payload.categories.flatMap((category) => [
      { category: category.category, subcategory: "", label: category.label },
      ...category.subcategories.map((subcategory) => ({
        category: subcategory.category,
        subcategory: subcategory.subcategory,
        label: subcategory.label,
      })),
    ]),
  );
}

export async function refreshAppData(options?: { refreshMap?: boolean; refreshPois?: boolean }) {
  const bootstrap = await requestJson<BootstrapPayload>("/api/bootstrap");
  state.apartments = bootstrap.apartments;
  state.customPois = bootstrap.customPois;
  state.settings = bootstrap.settings;
  state.mapConfig = bootstrap.mapConfig;
  state.poiCategoryLabels = bootstrap.poiCategoryLabels;
  setPoiCategoryLabels(bootstrap.poiCategoryLabels);
  state.selectedApartmentId =
    state.selectedApartmentId && bootstrap.apartments.some((item) => item.id === state.selectedApartmentId)
      ? state.selectedApartmentId
      : bootstrap.apartments[0]?.id ?? null;

  if (options?.refreshPois) {
    await loadPoiManagement(true);
  }

  if (options?.refreshMap && state.activeView === "map" && state.selectedApartmentId) {
    if (!mapIsAvailable(state.mapConfig)) {
      state.mapPayload = null;
      render();
      return;
    }
    await loadMapPayload(state.selectedApartmentId);
    return;
  }

  render();
}

export async function loadMapPayload(apartmentId: number) {
  if (!mapIsAvailable(state.mapConfig)) {
    state.mapPayload = null;
    state.selectedApartmentId = apartmentId;
    render();
    return;
  }

  state.mapPayload = await requestJson<MapPayload>(`/api/apartments/${apartmentId}/map`);
  state.selectedApartmentId = apartmentId;
  if (state.activeView === "map" && document.querySelector(".map-sidebar")) {
    updateMapSidebar();
    const sidebar = document.querySelector<HTMLElement>(".map-sidebar");
    if (sidebar) bindMapSidebarEvents(sidebar);
    queueMicrotask(() => renderMap());
    return;
  }

  render();
  queueMicrotask(() => renderMap());
}

async function searchMapAddresses(query: string, sequence: number) {
  try {
    const results = await requestJson<MapAddressSearchResponse[]>(
      `/api/map/address-search?q=${encodeURIComponent(query)}`,
    );
    const currentQuery = state.mapAddressQuery.trim().replace(/\s+/g, " ");
    if (sequence !== mapAddressSearchSequence || currentQuery !== query) {
      return;
    }

    state.mapAddressSuggestions = results.map(
      (result): MapAddressSuggestion => ({
        label: result.displayLabel || result.address,
        address: result.address,
        latitude: result.latitude,
        longitude: result.longitude,
      }),
    );
    state.mapAddressSuggestionsOpen = true;
    state.mapAddressSearchStatus = "idle";
    state.mapAddressActiveSuggestionIndex = results.length ? 0 : -1;
    updateMapAddressSearch({ preserveFocus: true });
  } catch {
    if (sequence !== mapAddressSearchSequence) {
      return;
    }
    state.mapAddressSuggestions = [];
    state.mapAddressSuggestionsOpen = true;
    state.mapAddressSearchStatus = "error";
    state.mapAddressActiveSuggestionIndex = -1;
    updateMapAddressSearch({ preserveFocus: true });
  }
}

function scheduleMapAddressSearch() {
  if (mapAddressSearchTimer !== null) {
    window.clearTimeout(mapAddressSearchTimer);
    mapAddressSearchTimer = null;
  }

  const query = state.mapAddressQuery.trim().replace(/\s+/g, " ");
  const sequence = ++mapAddressSearchSequence;
  if (query.length < 3) {
    state.mapAddressSuggestions = [];
    state.mapAddressSuggestionsOpen = false;
    state.mapAddressSearchStatus = "idle";
    state.mapAddressActiveSuggestionIndex = -1;
    updateMapAddressSearch({ preserveFocus: true });
    return;
  }

  state.mapAddressSearchStatus = "loading";
  state.mapAddressSuggestions = [];
  state.mapAddressSuggestionsOpen = true;
  state.mapAddressActiveSuggestionIndex = -1;
  updateMapAddressSearch({ preserveFocus: true });
  mapAddressSearchTimer = window.setTimeout(() => {
    mapAddressSearchTimer = null;
    void searchMapAddresses(query, sequence);
  }, 250);
}

function selectMapAddress(index: number) {
  const suggestion = state.mapAddressSuggestions[index];
  if (!suggestion) {
    return;
  }

  mapAddressSearchSequence += 1;
  state.mapAddressSelection = suggestion;
  state.mapAddressQuery = suggestion.address;
  state.mapAddressSuggestions = [];
  state.mapAddressSuggestionsOpen = false;
  state.mapAddressSearchStatus = "idle";
  state.mapAddressActiveSuggestionIndex = -1;
  updateMapAddressSearch();
  renderMap({ preserveViewport: true });
  focusSearchedAddress();
  document.querySelector<HTMLInputElement>("#map-address-input")?.focus();
}

function clearMapAddressSearch() {
  mapAddressSearchSequence += 1;
  if (mapAddressSearchTimer !== null) {
    window.clearTimeout(mapAddressSearchTimer);
    mapAddressSearchTimer = null;
  }
  state.mapAddressQuery = "";
  state.mapAddressSuggestions = [];
  state.mapAddressSuggestionsOpen = false;
  state.mapAddressSearchStatus = "idle";
  state.mapAddressActiveSuggestionIndex = -1;
  state.mapAddressSelection = null;
  updateMapAddressSearch();
  renderMap({ preserveViewport: true });
  document.querySelector<HTMLInputElement>("#map-address-input")?.focus();
}

function bindMapAddressSearchEvents() {
  const mapLayout = document.querySelector<HTMLElement>(".map-layout");
  if (!mapLayout) {
    return;
  }

  mapLayout.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (input?.id !== "map-address-input") {
      return;
    }

    const hadSelection = state.mapAddressSelection !== null;
    state.mapAddressQuery = input.value;
    state.mapAddressSelection = null;
    if (hadSelection) {
      renderMap({ preserveViewport: true });
    }
    scheduleMapAddressSearch();
  });

  mapLayout.addEventListener("keydown", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (input?.id !== "map-address-input") {
      return;
    }

    if (event.key === "ArrowDown" && state.mapAddressSuggestions.length) {
      event.preventDefault();
      state.mapAddressActiveSuggestionIndex =
        (state.mapAddressActiveSuggestionIndex + 1) % state.mapAddressSuggestions.length;
      updateMapAddressSearch({ preserveFocus: true });
      return;
    }

    if (event.key === "ArrowUp" && state.mapAddressSuggestions.length) {
      event.preventDefault();
      state.mapAddressActiveSuggestionIndex =
        (state.mapAddressActiveSuggestionIndex - 1 + state.mapAddressSuggestions.length) %
        state.mapAddressSuggestions.length;
      updateMapAddressSearch({ preserveFocus: true });
      return;
    }

    if (event.key === "Enter" && state.mapAddressSuggestions.length) {
      event.preventDefault();
      selectMapAddress(Math.max(0, state.mapAddressActiveSuggestionIndex));
      return;
    }

    if (event.key === "Escape") {
      mapAddressSearchSequence += 1;
      if (mapAddressSearchTimer !== null) {
        window.clearTimeout(mapAddressSearchTimer);
        mapAddressSearchTimer = null;
      }
      state.mapAddressSuggestions = [];
      state.mapAddressSuggestionsOpen = false;
      state.mapAddressSearchStatus = "idle";
      state.mapAddressActiveSuggestionIndex = -1;
      updateMapAddressSearch({ preserveFocus: true });
    }
  });

  mapLayout.addEventListener("submit", (event) => {
    if ((event.target as HTMLFormElement | null)?.id === "map-address-search") {
      event.preventDefault();
    }
  });

  mapLayout.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) {
      return;
    }

    if (target.dataset.action === "select-map-address") {
      selectMapAddress(Number(target.dataset.index));
      return;
    }

    if (target.dataset.action === "clear-map-address") {
      clearMapAddressSearch();
    }
  });
}

export function updatePoiRegions(options?: { controls?: boolean }) {
  if (state.activeView !== "pois") {
    return;
  }

  const pois = filteredManagedPois();
  const selection = visibleManagedPoiSelectionState();

  const toolbarRegion = document.querySelector<HTMLElement>("#poi-toolbar-region");
  if (toolbarRegion) {
    toolbarRegion.innerHTML = renderPoiToolbar(pois, selection);
  }

  const statsRegion = document.querySelector<HTMLElement>("#poi-stats-region");
  if (statsRegion) {
    statsRegion.innerHTML = renderPoiStats();
  }

  if (options?.controls) {
    const controlsRegion = document.querySelector<HTMLElement>("#poi-controls-region");
    if (controlsRegion) {
      controlsRegion.innerHTML = renderPoiControls();
    }
  }

  const tableRegion = document.querySelector<HTMLElement>("#poi-table-region");
  if (tableRegion) {
    tableRegion.innerHTML = renderPoiTable(pois, selection);
  }

  syncPoiTableViewport();
}

export function schedulePoiSearchUpdate() {
  if (poiSearchUpdateTimer !== null) {
    window.clearTimeout(poiSearchUpdateTimer);
  }

  poiSearchUpdateTimer = window.setTimeout(() => {
    poiSearchUpdateTimer = null;
    state.poiTableScrollTop = 0;
    updatePoiRegions();
  }, 120);
}

let poiTableScrollRaf: number | null = null;

function updatePoiTableRows() {
  const viewport = document.querySelector<HTMLElement>(".poi-table-viewport");
  if (!viewport) return;

  const pois = filteredManagedPois();
  if (!pois.length) return;

  const slice = poiTableWindowedSlice(
    pois.length,
    state.poiTableScrollTop,
    viewport.clientHeight || 600,
    POI_TABLE_ROW_HEIGHT,
    POI_TABLE_OVERSCAN,
  );

  const selectedKeys = new Set(state.selectedManagedPoiKeys);
  const rowsHtml = pois
    .slice(slice.startIndex, slice.endIndex)
    .map((poi) => renderPoiRow(poi, selectedKeys))
    .join("");

  viewport.innerHTML = `
    <div style="height:${slice.topSpacerHeight}px"></div>
    <div class="poi-table" role="group" aria-label="POI list">
      ${rowsHtml}
    </div>
    <div style="height:${slice.bottomSpacerHeight}px"></div>
  `;

  const selection = visibleManagedPoiSelectionState();
  updatePoiSelectionBar(selection);
}

function updatePoiSelectionBar(selection: { total: number; selected: number; allSelected: boolean }) {
  const selectAll = document.querySelector<HTMLInputElement>("#poi-select-all");
  if (selectAll) {
    selectAll.checked = selection.allSelected;
    selectAll.disabled = !selection.total;
  }
  const selectedText = document.querySelector<HTMLElement>(".poi-selection-bar p");
  if (selectedText) {
    selectedText.textContent = `${selection.selected} selected`;
  }
}

function updatePoiToolbarFromSelection() {
  const pois = filteredManagedPois();
  const selection = visibleManagedPoiSelectionState();
  const toolbarRegion = document.querySelector<HTMLElement>("#poi-toolbar-region");
  if (toolbarRegion) {
    toolbarRegion.innerHTML = renderPoiToolbar(pois, selection);
  }
  updatePoiSelectionBar(selection);
}

function onPoiTableScroll() {
  const viewport = document.querySelector<HTMLElement>(".poi-table-viewport");
  if (!viewport) return;

  state.poiTableScrollTop = viewport.scrollTop;

  if (poiTableScrollRaf === null) {
    poiTableScrollRaf = requestAnimationFrame(() => {
      poiTableScrollRaf = null;
      updatePoiTableRows();
    });
  }
}

function syncPoiTableViewport() {
  const viewport = document.querySelector<HTMLElement>(".poi-table-viewport");
  if (!viewport) return;

  viewport.scrollTop = state.poiTableScrollTop;
  state.poiTableViewportHeight = viewport.clientHeight;

  viewport.removeEventListener("scroll", onPoiTableScroll);
  viewport.addEventListener("scroll", onPoiTableScroll, { passive: true });
}

function poiStatusItemsFromKeys(keys: string[]) {
  return keys.flatMap((key) => {
    const [kind, rawId] = key.split(":");
    const id = Number(rawId);

    if ((kind !== "standard" && kind !== "custom") || !Number.isInteger(id) || id <= 0) {
      return [];
    }

    return [{ kind, id }];
  });
}

async function updateManagedPoiStatuses(keys: string[], isActive: boolean) {
  const items = poiStatusItemsFromKeys(keys);
  if (items.length === 0) {
    return;
  }

  await requestJson<PoiManagementPayload>("/api/pois/status", {
    method: "PUT",
    body: JSON.stringify({
      isActive,
      items,
    }),
  });
  state.selectedManagedPoiKeys = [];
  await refreshAppData({ refreshMap: true, refreshPois: true });
}

export function bindPoiAdminEvents() {
  const shell = document.querySelector<HTMLElement>(".poi-admin-shell");
  if (!shell) {
    return;
  }

  syncPoiTableViewport();

  shell.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.id !== "poi-search") {
      return;
    }

    state.poiSearch = input.value;
    schedulePoiSearchUpdate();
  });

  shell.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!input) {
      return;
    }

    if (input.id === "poi-editor-category" && input instanceof HTMLSelectElement) {
      const subcategorySelect = shell.querySelector<HTMLSelectElement>("#poi-editor-subcategory");
      if (!subcategorySelect) return;
      const category = input.value as PoiCategory;
      subcategorySelect.innerHTML = [
        '<option value="">No subcategory</option>',
        ...existingPoiSubcategories(state.pois, category).map((subcategory) => {
          const label = categoryDisplayLabel(category, subcategory, subcategory);
          return `<option value="${escapeHtml(subcategory)}">${escapeHtml(label)}</option>`;
        }),
      ].join("");
      subcategorySelect.value = "";
      return;
    }

    if (input.id === "poi-status-filter") {
      state.poiStatusFilter = input.value as PoiStatusFilter;
      state.poiTableScrollTop = 0;
      updatePoiRegions({ controls: true });
      return;
    }

    if (input.id === "poi-select-all" && input instanceof HTMLInputElement) {
      const visibleKeys = visibleManagedPoiKeys();
      const selectedKeys = new Set(state.selectedManagedPoiKeys);

      if (input.checked) {
        for (const key of visibleKeys) {
          selectedKeys.add(key);
        }
      } else {
        for (const key of visibleKeys) {
          selectedKeys.delete(key);
        }
      }

      state.selectedManagedPoiKeys = Array.from(selectedKeys);
      updatePoiTableRows();
      updatePoiToolbarFromSelection();
      return;
    }

    if (input.dataset.action === "toggle-managed-poi" && input instanceof HTMLInputElement) {
      const key = input.dataset.key;
      if (!key) {
        return;
      }

      state.selectedManagedPoiKeys = input.checked
        ? [...new Set([...state.selectedManagedPoiKeys, key])]
        : state.selectedManagedPoiKeys.filter((value) => value !== key);
      updatePoiTableRows();
      updatePoiToolbarFromSelection();
      return;
    }

    if (input.dataset.action === "toggle-managed-poi-category" && input instanceof HTMLInputElement) {
      const category = input.dataset.category as PoiCategory | undefined;
      if (!category) {
        return;
      }

      state.visibleManagedPoiCategories[category] = input.checked;
      state.poiTableScrollTop = 0;
      updatePoiRegions({ controls: true });
      return;
    }

    if (input.dataset.action === "toggle-managed-poi-subcategory" && input instanceof HTMLInputElement) {
      const key = input.dataset.key;
      if (!key) {
        return;
      }

      state.selectedManagedSubcategories = input.checked
        ? [...new Set([...state.selectedManagedSubcategories, key])]
        : state.selectedManagedSubcategories.filter((value) => value !== key);
      state.poiTableScrollTop = 0;
      updatePoiRegions({ controls: true });
      return;
    }

  });

  shell.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;

    if (action === "edit-managed-poi") {
      state.editingManagedPoiKey = target.dataset.key ?? null;
      render();
      return;
    }

    if (action === "edit-selected-poi") {
      const visibleSelected = selectedManagedPois();
      state.editingManagedPoiKey = visibleSelected.length === 1 ? managedPoiKey(visibleSelected[0]!) : null;
      render();
      return;
    }

    if (action === "close-poi-editor") {
      state.editingManagedPoiKey = null;
      render();
      return;
    }

    if (action === "set-single-poi-status") {
      const key = target.dataset.key;
      if (!key) {
        return;
      }

      await updateManagedPoiStatuses([key], target.dataset.status === "active");
      return;
    }

    if (action === "bulk-poi-status") {
      await updateManagedPoiStatuses(
        selectedManagedPois().map(managedPoiKey),
        target.dataset.status === "active",
      );
      return;
    }

    if (action === "bulk-visible-poi-status") {
      await updateManagedPoiStatuses(visibleManagedPoiKeys(), target.dataset.status === "active");
      return;
    }

    if (action === "reset-poi-filters") {
      state.poiSearch = "";
      state.poiStatusFilter = "all";
      state.visibleManagedPoiCategories = {
        supermarket: true,
        sport_studio: true,
        custom: true,
      };
      state.selectedManagedSubcategories = [];
      state.poiTableScrollTop = 0;
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "toggle-poi-filters") {
      state.poiFiltersOpen = !state.poiFiltersOpen;
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "close-poi-filters") {
      state.poiFiltersOpen = false;
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "select-all-poi-categories" || action === "clear-poi-categories") {
      const isVisible = action === "select-all-poi-categories";
      for (const category of MANAGED_POI_CATEGORY_ORDER) {
        state.visibleManagedPoiCategories[category] = isVisible;
      }
      state.poiTableScrollTop = 0;
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "clear-poi-subcategories") {
      state.selectedManagedSubcategories = [];
      state.poiTableScrollTop = 0;
      updatePoiRegions({ controls: true });
    }
  });

  const editorForm = document.querySelector<HTMLFormElement>("#poi-editor-form");
  editorForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(editorForm);
    const key = String(formData.get("key") ?? "");
    const [kind, rawId] = key.split(":");
    const id = Number(rawId);
    const poi = state.pois.find((item) => managedPoiKey(item) === key);
    if (!poi || (kind !== "standard" && kind !== "custom") || !Number.isInteger(id)) return;

    await requestJson<ManagedPoi>(`/api/pois/${kind}/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: String(formData.get("name") ?? ""),
        address: String(formData.get("address") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        category: kind === "custom" ? "custom" : String(formData.get("category") ?? poi.category),
        subcategory: kind === "custom" ? "" : String(formData.get("subcategory") ?? ""),
      }),
    });
    state.editingManagedPoiKey = null;
    state.selectedManagedPoiKeys = [];
    await refreshAppData({ refreshMap: true, refreshPois: true });
  });

  window.addEventListener("resize", () => {
    const viewport = document.querySelector<HTMLElement>(".poi-table-viewport");
    if (viewport) {
      state.poiTableViewportHeight = viewport.clientHeight;
    }
  });
}

export function bindCategoryAdminEvents() {
  const shell = document.querySelector<HTMLElement>(".categories-shell");
  if (!shell) {
    return;
  }

  shell.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.dataset.action !== "upload-category-icon" || !input.files?.length) {
      return;
    }

    const category = input.dataset.category ?? "";
    const subcategory = input.dataset.subcategory ?? "";
    const file = input.files[0];
    if (!category || !file) {
      return;
    }

    const formData = new FormData();
    formData.append("category", category);
    formData.append("subcategory", subcategory);
    formData.append("file", file);
    await fetch("/api/poi-icons", { method: "PUT", body: formData });
    await Promise.all([refreshAppData({ refreshPois: state.poisLoaded }), loadCategoryManagement(true)]);
    render();
    input.value = "";
  });

  shell.addEventListener("submit", async (event) => {
    const form = event.target as HTMLFormElement | null;
    if (!form || form.dataset.action !== "save-category-label") {
      return;
    }

    event.preventDefault();
    const formData = new FormData(form);
    await requestJson("/api/categories/label", {
      method: "PUT",
      body: JSON.stringify({
        category: String(formData.get("category") ?? ""),
        subcategory: String(formData.get("subcategory") ?? ""),
        label: String(formData.get("label") ?? ""),
      }),
    });
    state.editingCategoryKey = null;
    await Promise.all([refreshAppData({ refreshPois: state.poisLoaded }), loadCategoryManagement(true)]);
    render();
  });

  shell.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) {
      return;
    }

    if (target.dataset.action === "toggle-category-section") {
      const category = target.dataset.category ?? "";
      if (!category) {
        return;
      }
      const key = poiIconKey(category, "");
      state.expandedCategoryKeys = isCategoryExpanded(category)
        ? state.expandedCategoryKeys.filter((value) => value !== key)
        : [...state.expandedCategoryKeys, key];
      render();
      return;
    }

    if (target.dataset.action === "start-edit-category-label") {
      const category = target.dataset.category ?? "";
      const subcategory = target.dataset.subcategory ?? "";
      if (!category) {
        return;
      }
      state.editingCategoryKey = poiIconKey(category, subcategory);
      if (!subcategory) {
        const categoryKey = poiIconKey(category, "");
        if (!state.expandedCategoryKeys.includes(categoryKey)) {
          state.expandedCategoryKeys = [...state.expandedCategoryKeys, categoryKey];
        }
      }
      render();
      return;
    }

    if (target.dataset.action === "cancel-edit-category-label") {
      state.editingCategoryKey = null;
      render();
      return;
    }

    if (target.dataset.action !== "delete-category-icon") {
      return;
    }

    await requestJson("/api/poi-icons", {
      method: "DELETE",
      body: JSON.stringify({
        category: target.dataset.category ?? "",
        subcategory: target.dataset.subcategory ?? "",
      }),
    });
    await Promise.all([refreshAppData({ refreshPois: state.poisLoaded }), loadCategoryManagement(true)]);
    render();
  });
}

export function bindMapSidebarEvents(sidebar: HTMLElement) {
  sidebar.querySelectorAll<HTMLElement>("[data-action]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      const target = event.currentTarget as HTMLElement;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "toggle-poi-list") {
        state.showPoiList = !state.showPoiList;
        updateMapSidebar();
        bindMapSidebarEvents(sidebar);
        renderMap({ preserveViewport: true });
      }

      if (action === "toggle-ubahn-routes") {
        state.showUbahnRoutes = !state.showUbahnRoutes;
        updateMapSidebar();
        bindMapSidebarEvents(sidebar);
        renderMap({ preserveViewport: true });
      }

      if (action === "clear-sport-tags") {
        state.selectedSportTags = [];
        updateMapSidebar();
        bindMapSidebarEvents(sidebar);
        renderMap({ preserveViewport: true });
      }

      if (action === "toggle-sport-tag") {
        const tag = target.dataset.tag;
        if (!tag) return;
        state.selectedSportTags = state.selectedSportTags.includes(tag)
          ? state.selectedSportTags.filter((value) => value !== tag)
          : [...state.selectedSportTags, tag];
        updateMapSidebar();
        bindMapSidebarEvents(sidebar);
        renderMap({ preserveViewport: true });
      }
    });
  });

  sidebar
    .querySelectorAll<HTMLInputElement>('input[data-action="toggle-poi-category"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        const category = input.dataset.category as StandardPoiCategory | undefined;
        if (!category) return;
        state.visiblePoiCategories[category] = input.checked;
        updateMapSidebar();
        bindMapSidebarEvents(sidebar);
        renderMap({ preserveViewport: true });
      });
    });

  const mapApartmentSelector = sidebar.querySelector<HTMLSelectElement>("#map-apartment-selector");
  mapApartmentSelector?.addEventListener("change", async () => {
    const apartmentId = Number(mapApartmentSelector.value);
    await loadMapPayload(apartmentId);
  });
}
