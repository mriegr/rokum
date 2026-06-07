import type {
  Apartment,
  BootstrapPayload,
  CustomPoi,
  MapPayload,
  PoiCategory,
  PoiManagementPayload,
  StandardPoiCategory,
  WeightSettings,
} from "../shared/types";
import type { PanelView, SortMode } from "./state";
import {
  MANAGED_POI_CATEGORY_ORDER,
  root,
  selectedManagedPois,
  state,
  visibleManagedPoiKeys,
} from "./state";
import {
  escapeHtml,
  mapIsAvailable,
  requestJson,
} from "./helpers";
import {
  renderListView,
  renderMapLegend,
  renderMapView,
  renderPoiControls,
  renderPoiStats,
  renderPoiTable,
  renderPoiToolbar,
  renderPoisView,
  renderTopbar,
  updateMapSidebar,
} from "./views";
import {
  destroyMap,
  renderMap,
} from "./map";
import {
  indexManagedPois,
  managedPoiKey,
  type PoiStatusFilter,
} from "./poiFilters";

let poiSearchUpdateTimer: number | null = null;

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
            : renderPoisView()
      }
    </div>
  `;

  bindEvents();

  if (state.activeView === "map") {
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
              : "list";
        state.activeView = view;
        window.history.replaceState(
          {},
          "",
          view === "map" ? "/map" : view === "pois" ? "/pois" : "/",
        );
        if (view === "pois") {
          await loadPoiManagement();
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
}

export async function loadBootstrap() {
  const payload = await requestJson<BootstrapPayload>("/api/bootstrap");
  state.apartments = payload.apartments;
  state.customPois = payload.customPois;
  state.settings = payload.settings;
  state.mapConfig = payload.mapConfig;
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

  const payload = await requestJson<PoiManagementPayload>("/api/pois");
  state.pois = payload.pois;
  state.indexedPois = indexManagedPois(payload.pois);
  state.poisLoaded = true;
  state.selectedManagedPoiKeys = state.selectedManagedPoiKeys.filter((key) =>
    payload.pois.some((poi) => managedPoiKey(poi) === key),
  );
}

export async function refreshAppData(options?: { refreshMap?: boolean; refreshPois?: boolean }) {
  const bootstrap = await requestJson<BootstrapPayload>("/api/bootstrap");
  state.apartments = bootstrap.apartments;
  state.customPois = bootstrap.customPois;
  state.settings = bootstrap.settings;
  state.mapConfig = bootstrap.mapConfig;
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

export function updatePoiRegions(options?: { controls?: boolean }) {
  if (state.activeView !== "pois") {
    return;
  }

  const toolbarRegion = document.querySelector<HTMLElement>("#poi-toolbar-region");
  if (toolbarRegion) {
    toolbarRegion.innerHTML = renderPoiToolbar();
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
    tableRegion.innerHTML = renderPoiTable();
  }
}

export function schedulePoiSearchUpdate() {
  if (poiSearchUpdateTimer !== null) {
    window.clearTimeout(poiSearchUpdateTimer);
  }

  poiSearchUpdateTimer = window.setTimeout(() => {
    poiSearchUpdateTimer = null;
    updatePoiRegions();
  }, 120);
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

  shell.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.id !== "poi-search") {
      return;
    }

    state.poiSearch = input.value;
    schedulePoiSearchUpdate();
  });

  shell.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!input) {
      return;
    }

    if (input.id === "poi-status-filter") {
      state.poiStatusFilter = input.value as PoiStatusFilter;
      updatePoiRegions();
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
      updatePoiRegions();
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
      updatePoiRegions();
      return;
    }

    if (input.dataset.action === "toggle-managed-poi-category" && input instanceof HTMLInputElement) {
      const category = input.dataset.category as PoiCategory | undefined;
      if (!category) {
        return;
      }

      state.visibleManagedPoiCategories[category] = input.checked;
      updatePoiRegions();
    }
  });

  shell.addEventListener("click", async (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!target) {
      return;
    }

    const action = target.dataset.action;

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
        ubahn: true,
        cafe: true,
        park_or_river: true,
        custom: true,
      };
      state.selectedManagedSportTags = [];
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "select-all-poi-categories" || action === "clear-poi-categories") {
      const isVisible = action === "select-all-poi-categories";
      for (const category of MANAGED_POI_CATEGORY_ORDER) {
        state.visibleManagedPoiCategories[category] = isVisible;
      }
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "toggle-managed-sport-tag") {
      const tag = target.dataset.tag;
      if (!tag) {
        return;
      }

      state.selectedManagedSportTags = state.selectedManagedSportTags.includes(tag)
        ? state.selectedManagedSportTags.filter((value) => value !== tag)
        : [...state.selectedManagedSportTags, tag];
      updatePoiRegions({ controls: true });
      return;
    }

    if (action === "select-all-managed-sport-tags") {
      state.selectedManagedSportTags = [];
      updatePoiRegions({ controls: true });
    }
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
