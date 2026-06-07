import appShell from "./index.html";
import {
  createApartment,
  createCustomPoi,
  deleteApartment,
  deleteApartmentPhoto,
  deleteCustomPoi,
  getApartmentMapData,
  getBootstrapPayload,
  getPoiManagementPayload,
  getSettings,
  initApp,
  refreshApartmentScores,
  serveMapTile,
  updateApartment,
  updateCustomPoi,
  updatePoiStatuses,
  updateSettings,
  uploadApartmentPhotos,
} from "./src/server";

const app = await initApp();

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
  },
  development: {
    hmr: true,
    console: true,
  },
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    if (pathname.startsWith("/uploads/")) {
      return app.serveUpload(pathname);
    }

    if (pathname === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    try {
      const mapTileMatch = pathname.match(/^\/api\/map-tiles\/(\d+)\/(\d+)\/(\d+)(@2x)?\.png$/);
      if (mapTileMatch && method === "GET") {
        const [, z, x, y, retina] = mapTileMatch;
        return await serveMapTile(
          app,
          z!,
          x!,
          y!,
          Boolean(retina),
        );
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
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Unexpected application error";
      return json({ error: message }, 500);
    }

    return notFound();
  },
});

console.log(`Apartment shortlist app running on http://localhost:${app.config.port}`);
