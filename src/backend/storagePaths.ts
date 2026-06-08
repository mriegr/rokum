import { basename, resolve } from "node:path";

export function sanitizePathSegment(value: string, fallback: string) {
  const cleaned = basename(value)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  return cleaned || fallback;
}

export function resolveWithinDirectory(baseDir: string, relativePath: string) {
  try {
    const base = resolve(baseDir);
    const decoded = decodeURIComponent(relativePath).replace(/^\/+/, "");
    if (!decoded) {
      return null;
    }

    const target = resolve(base, decoded);
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    if (target !== base && !target.startsWith(normalizedBase)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}
