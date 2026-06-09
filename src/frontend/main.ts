import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import type { PoiIconMapping } from "../shared/types";
import { state, root } from "./state";
import { escapeHtml, requestJson } from "./helpers";
import { loadBootstrap, loadCategoryManagement, loadPoiManagement, render } from "./events";
import { mapReady, registerChainIcons, syncMapSources } from "./map";

async function boot() {
  await loadBootstrap();

  if (state.activeView === "pois") {
    await loadPoiManagement();
    render();
  } else if (state.activeView === "categories") {
    await loadCategoryManagement();
    render();
  }

  if (state.activeView === "map" && state.managedPoiIcons.size === 0) {
    const { icons } = await requestJson<PoiIconMapping>("/api/poi-icons");
    const iconMap = new Map<string, string>();
    for (const icon of icons) {
      iconMap.set(`${icon.category}:${icon.subcategory}`, icon.iconPath);
    }
    state.managedPoiIcons = iconMap;
    if (mapReady) {
      await registerChainIcons();
      syncMapSources({ preserveViewport: true });
    }
  }
}

boot().catch((error) => {
  root.innerHTML = `<div class="fatal-error"><h1>App failed to load</h1><p>${escapeHtml(
    error instanceof Error ? error.message : "Unknown error",
  )}</p></div>`;
});
