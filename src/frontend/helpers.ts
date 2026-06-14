import type { MapConfig } from "../shared/types";
import { state, type FeatureCollection } from "./state";

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function formatScore(value: number) {
  return `${value.toFixed(1)}/10`;
}

export function formatMinutes(value: number | null) {
  return value === null ? "n/a" : `${value} min`;
}

export function scoreTone(value: number) {
  if (value >= 8) return "high";
  if (value >= 5) return "medium";
  return "low";
}

export function popupHtml(title: string, lines: string[]) {
  return [`<strong>${escapeHtml(title)}</strong>`, ...lines.map((line) => escapeHtml(line))]
    .join("<br />");
}

export function normalizeMapColor(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (/^#[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(trimmed)) {
    return trimmed;
  }

  if (/^[0-9a-f]{3}([0-9a-f]{3})?([0-9a-f]{2})?$/i.test(trimmed)) {
    return `#${trimmed}`;
  }

  if (/^[a-z]+$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  return null;
}

export function mapIsAvailable(config: MapConfig): config is Extract<MapConfig, { available: true }> {
  return config.available;
}

export function emptyFeatureCollection(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [],
  };
}

export async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

export function apartmentFormDefaults() {
  const apartment =
    state.editingApartmentId === null
      ? null
      : state.apartments.find((item) => item.id === state.editingApartmentId) ?? null;

  return {
    address: apartment?.address ?? "",
    squareMeters: apartment?.squareMeters ?? 65,
    kaltmiete: apartment?.kaltmiete ?? 1200,
    warmmiete: apartment?.warmmiete ?? 1450,
    floorLevel: apartment?.floorLevel ?? "",
    roomCount: apartment?.roomCount ?? 2.5,
    description: apartment?.description ?? "",
  };
}

export function customPoiDefaults() {
  const poi =
    state.editingCustomPoiId === null
      ? null
      : state.customPois.find((item) => item.id === state.editingCustomPoiId) ?? null;

  return {
    name: poi?.name ?? "",
    address: poi?.address ?? "",
    notes: poi?.notes ?? "",
    isActive: poi?.isActive ?? true,
  };
}
