import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { state, root } from "./state";
import { escapeHtml } from "./helpers";
import { loadBootstrap, loadPoiManagement, render } from "./events";

async function boot() {
  await loadBootstrap();
  if (state.activeView === "pois") {
    await loadPoiManagement();
    render();
  }
}

boot().catch((error) => {
  root.innerHTML = `<div class="fatal-error"><h1>App failed to load</h1><p>${escapeHtml(
    error instanceof Error ? error.message : "Unknown error",
  )}</p></div>`;
});
