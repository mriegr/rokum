import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AppConfig } from "./types";

function requireDirectory(path: string) {
  mkdirSync(path, { recursive: true });
}

export function loadConfig(): AppConfig {
  const dataRoot = resolve(process.env.DATA_DIR ?? "./data");
  const databasePath = resolve(process.env.DB_PATH ?? `${dataRoot}/rokum.sqlite`);
  const uploadDirectory = resolve(process.env.UPLOAD_DIR ?? `${dataRoot}/uploads`);
  requireDirectory(dirname(databasePath));
  requireDirectory(uploadDirectory);

  return {
    port: Number(process.env.PORT ?? 3000),
    city: process.env.CITY ?? "Munich",
    databasePath,
    uploadDirectory,
    nominatimBaseUrl:
      process.env.NOMINATIM_BASE_URL ?? "https://nominatim.openstreetmap.org",
    overpassBaseUrl:
      process.env.OVERPASS_BASE_URL ?? "https://overpass-api.de/api/interpreter",
    walkingBaseUrl:
      process.env.WALKING_ROUTER_BASE_URL ?? "https://router.project-osrm.org",
    transitBaseUrl: process.env.TRANSIT_BASE_URL ?? null,
    transitMode: process.env.TRANSIT_MODE === "otp1" ? "otp1" : "heuristic",
  };
}
