import appShell from "./src/frontend/index.html";
import { HttpError } from "./src/backend/httpErrors";
import {
  createApartment,
  createCustomPoi,
  deleteApartment,
  deleteApartmentPhoto,
  deleteCustomPoi,
  deletePoiIconHandler,
  getApartmentMapData,
  getBootstrapPayload,
  getPoiCategoryManagementPayload,
  getPoiIcons,
  getPoiManagementPayload,
  getSettings,
  initApp,
  refreshApartmentScores,
  searchMapAddressSuggestions,
  serveMapGlyph,
  serveMapSource,
  serveMapSprite,
  serveMapStyle,
  serveMapTile,
  updateApartment,
  updatePoiCategoryLabel,
  updateCustomPoi,
  updatePoiStatuses,
  updateSettings,
  uploadApartmentPhotos,
  uploadPoiIcon,
} from "./src/backend/server";

const app = await initApp();
const isProduction = process.env.NODE_ENV === "production";

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

function notFound() {
  return json({ error: "Not found" }, 404);
}

function parseId(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

Bun.serve({
  port: app.config.port,
  routes: {
    "/": appShell,
    "/map": appShell,
    "/pois": appShell,
    "/categories": appShell,
  },
  ...(isProduction
    ? {}
    : {
        development: {
          hmr: true,
          console: true,
        },
      }),
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (pathname === "/healthz" && method === "GET") {
      return new Response("ok", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    if (pathname.startsWith("/uploads/")) {
      return app.serveUpload(pathname);
    }

    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    try {
      if (pathname === "/api/map/address-search" && method === "GET") {
        return json(await searchMapAddressSuggestions(app, url.searchParams.get("q") ?? ""));
      }

      if (pathname === "/api/map/style.json" && method === "GET") {
        return await serveMapStyle(app, request.url);
      }

      const mapTileMatch = pathname.match(/^\/api\/map\/tiles\/([a-f0-9]+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      if (mapTileMatch && method === "GET") {
        const [, assetId, z, x, y] = mapTileMatch;
        return await serveMapTile(app, assetId!, z!, x!, y!);
      }

      const mapGlyphMatch = pathname.match(
        /^\/api\/map\/glyphs\/([a-f0-9]+)\/([^/]+)\/(\d+-\d+)\.pbf$/,
      );
      if (mapGlyphMatch && method === "GET") {
        const [, assetId, fontstack, range] = mapGlyphMatch;
        return await serveMapGlyph(app, assetId!, decodeURIComponent(fontstack!), range!);
      }

      const mapSpriteMatch = pathname.match(
        /^\/api\/map\/sprites\/([a-f0-9]+)(\.json|\.png|@2x\.json|@2x\.png)$/,
      );
      if (mapSpriteMatch && method === "GET") {
        const [, assetId, suffix] = mapSpriteMatch;
        return await serveMapSprite(
          app,
          assetId!,
          suffix as ".json" | ".png" | "@2x.json" | "@2x.png",
        );
      }

      const mapSourceMatch = pathname.match(/^\/api\/map\/sources\/([a-f0-9]+)\.json$/);
      if (mapSourceMatch && method === "GET") {
        return await serveMapSource(app, mapSourceMatch[1]!);
      }

      if (pathname === "/api/bootstrap" && method === "GET") {
        return json(getBootstrapPayload(app));
      }

      if (pathname === "/api/settings" && method === "GET") {
        return json(getSettings(app));
      }

      if (pathname === "/api/settings" && method === "PUT") {
        const payload = await request.json();
        return json(await updateSettings(app, payload));
      }

      if (pathname === "/api/pois" && method === "GET") {
        return json(getPoiManagementPayload(app));
      }

      if (pathname === "/api/pois/status" && method === "PUT") {
        const payload = await request.json();
        return json(await updatePoiStatuses(app, payload));
      }

      if (pathname === "/api/poi-icons" && method === "GET") {
        return json(getPoiIcons(app));
      }

      if (pathname === "/api/poi-icons" && method === "PUT") {
        const formData = await request.formData();
        const category = String(formData.get("category") ?? "");
        const subcategory = String(formData.get("subcategory") ?? "");
        const file = formData.get("file");
        if (!category || !(file instanceof File)) {
          return json({ error: "Missing category or file" }, 400);
        }
        return json(await uploadPoiIcon(app, category, subcategory, file));
      }

      if (pathname === "/api/poi-icons" && method === "DELETE") {
        const payload = await request.json() as { category: string; subcategory?: string };
        return json(deletePoiIconHandler(app, payload.category, payload.subcategory ?? ""));
      }

      if (pathname === "/api/categories" && method === "GET") {
        return json(getPoiCategoryManagementPayload(app));
      }

      if (pathname === "/api/categories/label" && method === "PUT") {
        const payload = await request.json();
        return json(updatePoiCategoryLabel(app, payload));
      }

      if (pathname === "/api/apartments" && method === "POST") {
        const payload = await request.json();
        return json(await createApartment(app, payload), 201);
      }

      if (pathname === "/api/custom-pois" && method === "POST") {
        const payload = await request.json();
        return json(await createCustomPoi(app, payload), 201);
      }

      const apartmentMapMatch = pathname.match(/^\/api\/apartments\/(\d+)\/map$/);
      if (apartmentMapMatch && method === "GET") {
        const apartmentId = parseId(apartmentMapMatch[1]);
        if (!apartmentId) {
          return json({ error: "Invalid apartment id" }, 400);
        }
        return json(await getApartmentMapData(app, apartmentId));
      }

      const apartmentRefreshMatch = pathname.match(
        /^\/api\/apartments\/(\d+)\/refresh-score$/,
      );
      if (apartmentRefreshMatch && method === "POST") {
        const apartmentId = parseId(apartmentRefreshMatch[1]);
        if (!apartmentId) {
          return json({ error: "Invalid apartment id" }, 400);
        }
        return json(await refreshApartmentScores(app, apartmentId));
      }

      const apartmentUploadMatch = pathname.match(/^\/api\/apartments\/(\d+)\/photos$/);
      if (apartmentUploadMatch && method === "POST") {
        const apartmentId = parseId(apartmentUploadMatch[1]);
        if (!apartmentId) {
          return json({ error: "Invalid apartment id" }, 400);
        }
        const formData = await request.formData();
        return json(await uploadApartmentPhotos(app, apartmentId, formData));
      }

      const apartmentPhotoDeleteMatch = pathname.match(
        /^\/api\/apartments\/(\d+)\/photos\/(\d+)$/,
      );
      if (apartmentPhotoDeleteMatch && method === "DELETE") {
        const apartmentId = parseId(apartmentPhotoDeleteMatch[1]);
        const photoId = parseId(apartmentPhotoDeleteMatch[2]);
        if (!apartmentId || !photoId) {
          return json({ error: "Invalid identifier" }, 400);
        }
        await deleteApartmentPhoto(app, apartmentId, photoId);
        return json({ ok: true });
      }

      const apartmentMatch = pathname.match(/^\/api\/apartments\/(\d+)$/);
      if (apartmentMatch) {
        const apartmentId = parseId(apartmentMatch[1]);
        if (!apartmentId) {
          return json({ error: "Invalid apartment id" }, 400);
        }

        if (method === "PUT") {
          const payload = await request.json();
          return json(await updateApartment(app, apartmentId, payload));
        }

        if (method === "DELETE") {
          await deleteApartment(app, apartmentId);
          return json({ ok: true });
        }
      }

      const customPoiMatch = pathname.match(/^\/api\/custom-pois\/(\d+)$/);
      if (customPoiMatch) {
        const customPoiId = parseId(customPoiMatch[1]);
        if (!customPoiId) {
          return json({ error: "Invalid custom POI id" }, 400);
        }

        if (method === "PUT") {
          const payload = await request.json();
          return json(await updateCustomPoi(app, customPoiId, payload));
        }

        if (method === "DELETE") {
          await deleteCustomPoi(app, customPoiId);
          return json({ ok: true });
        }
      }
    } catch (error) {
      console.error(`[${method} ${pathname}]`, error);
      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }

      return json({ error: "Internal server error" }, 500);
    }

    return notFound();
  },
});

console.log(`Apartment shortlist app running on http://localhost:${app.config.port}`);
