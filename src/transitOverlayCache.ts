import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { AppConfig, UbahnRoute } from "./types";

export type MunichTransitOverlayCache = {
  version: 1;
  ubahnRoutes: UbahnRoute[];
};

const runtimeCaches = new Map<string, MunichTransitOverlayCache>();
const loadPromises = new Map<string, Promise<MunichTransitOverlayCache>>();

export function getTransitOverlayCachePath(config: Pick<AppConfig, "databasePath">) {
  const databaseFile = basename(config.databasePath);
  const databaseStem = databaseFile.endsWith(extname(databaseFile))
    ? databaseFile.slice(0, -extname(databaseFile).length)
    : databaseFile;
  return join(dirname(config.databasePath), `${databaseStem}.transit-overlay-cache.json`);
}

export function hasTransitOverlayCache(config: Pick<AppConfig, "databasePath">) {
  return existsSync(getTransitOverlayCachePath(config));
}

function normalizeCacheFile(value: unknown): MunichTransitOverlayCache {
  if (!value || typeof value !== "object") {
    return { version: 1, ubahnRoutes: [] };
  }

  const candidate = value as Partial<MunichTransitOverlayCache>;
  if (candidate.version !== 1 || !Array.isArray(candidate.ubahnRoutes)) {
    return { version: 1, ubahnRoutes: [] };
  }

  return {
    version: 1,
    ubahnRoutes: candidate.ubahnRoutes,
  };
}

async function readCacheFile(path: string) {
  const existing = runtimeCaches.get(path);
  if (existing) {
    return existing;
  }

  const inflight = loadPromises.get(path);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    if (!existsSync(path)) {
      return { version: 1, ubahnRoutes: [] } satisfies MunichTransitOverlayCache;
    }

    try {
      const contents = await Bun.file(path).text();
      return normalizeCacheFile(JSON.parse(contents));
    } catch {
      return { version: 1, ubahnRoutes: [] } satisfies MunichTransitOverlayCache;
    }
  })();

  loadPromises.set(path, promise);
  try {
    const file = await promise;
    runtimeCaches.set(path, file);
    return file;
  } finally {
    loadPromises.delete(path);
  }
}

async function writeCacheFile(path: string, file: MunichTransitOverlayCache) {
  mkdirSync(dirname(path), { recursive: true });
  await Bun.write(path, `${JSON.stringify(file, null, 2)}\n`);
  runtimeCaches.set(path, file);
}

export async function loadMunichTransitOverlayCache(
  config: Pick<AppConfig, "databasePath">,
) {
  const path = getTransitOverlayCachePath(config);
  return await readCacheFile(path);
}

export async function getMunichUbahnRoutes(
  config: Pick<AppConfig, "databasePath">,
) {
  const cache = await loadMunichTransitOverlayCache(config);
  return cache.ubahnRoutes;
}

export async function saveMunichUbahnRoutes(
  config: Pick<AppConfig, "databasePath">,
  ubahnRoutes: UbahnRoute[],
) {
  const path = getTransitOverlayCachePath(config);
  const file: MunichTransitOverlayCache = {
    version: 1,
    ubahnRoutes,
  };
  await writeCacheFile(path, file);
  return file;
}
