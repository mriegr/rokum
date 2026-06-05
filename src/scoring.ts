import type {
  ApartmentInput,
  CustomPoi,
  CustomPoiScore,
  StandardPoiCategory,
  StandardPoiScore,
  TravelMetrics,
  WeightSettings,
} from "./types";

export const CATEGORY_LABELS: Record<StandardPoiCategory, string> = {
  supermarket: "Supermarket",
  sport_studio: "Sport studio",
  ubahn: "U-Bahn",
  cafe: "Cafes",
  park_or_river: "Park or river",
};

export const DEFAULT_WEIGHTS: WeightSettings = {
  pricePerSqm: 1.3,
  rooms: 0.9,
  supermarket: 1,
  sportStudio: 1,
  ubahn: 1.2,
  cafe: 0.7,
  parkOrRiver: 0.8,
  customPoi: 1.1,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

export function calculatePricePerSqm(apartment: ApartmentInput) {
  if (!apartment.squareMeters) {
    return null;
  }
  return apartment.warmmiete / apartment.squareMeters;
}

export function scorePricePerSqm(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return 0;
  }

  const best = 14;
  const worst = 40;
  const normalized = 10 - ((value - best) / (worst - best)) * 10;
  return roundScore(clamp(normalized, 0, 10));
}

export function scoreRooms(roomCount: number) {
  if (!Number.isFinite(roomCount)) {
    return 0;
  }

  const distanceFromIdeal = Math.abs(roomCount - 3);
  return roundScore(clamp(10 - distanceFromIdeal * 2.5, 0, 10));
}

export function scoreWalkingDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) {
    return 0;
  }

  const best = 4;
  const worst = 32;
  const normalized = 10 - ((minutes - best) / (worst - best)) * 10;
  return roundScore(clamp(normalized, 0, 10));
}

export function scoreTransitDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) {
    return 0;
  }

  const best = 8;
  const worst = 55;
  const normalized = 10 - ((minutes - best) / (worst - best)) * 10;
  return roundScore(clamp(normalized, 0, 10));
}

export function combineWalkAndTransitScore(
  walking: TravelMetrics,
  transit: TravelMetrics,
) {
  const walkingScore = scoreWalkingDuration(walking.durationMinutes);
  const transitScore = scoreTransitDuration(transit.durationMinutes);
  return roundScore(walkingScore * 0.55 + transitScore * 0.45);
}

export function combineCustomPoiScore(
  walking: TravelMetrics,
  transit: TravelMetrics,
) {
  const walkingScore = scoreWalkingDuration(walking.durationMinutes);
  const transitScore = scoreTransitDuration(transit.durationMinutes);
  return roundScore(walkingScore * 0.3 + transitScore * 0.7);
}

export function calculateTotalScore(
  pricePerSqmScore: number,
  roomScore: number,
  standardPoiScores: StandardPoiScore[],
  customPoiScores: CustomPoiScore[],
  weights: WeightSettings,
) {
  let weightedSum = pricePerSqmScore * weights.pricePerSqm;
  let totalWeight = weights.pricePerSqm;

  weightedSum += roomScore * weights.rooms;
  totalWeight += weights.rooms;

  for (const poiScore of standardPoiScores) {
    const key = categoryWeightKey(poiScore.category);
    const weight = weights[key];
    weightedSum += poiScore.score * weight;
    totalWeight += weight;
  }

  for (const poiScore of customPoiScores) {
    weightedSum += poiScore.score * weights.customPoi;
    totalWeight += weights.customPoi;
  }

  if (!totalWeight) {
    return 0;
  }

  return roundScore(weightedSum / totalWeight);
}

function categoryWeightKey(category: StandardPoiCategory) {
  switch (category) {
    case "sport_studio":
      return "sportStudio";
    case "park_or_river":
      return "parkOrRiver";
    default:
      return category;
  }
}

export function buildDefaultStandardPoiScore(
  category: StandardPoiCategory,
): StandardPoiScore {
  return {
    category,
    label: CATEGORY_LABELS[category],
    poiName: "Not available yet",
    poiAddress: "",
    latitude: 0,
    longitude: 0,
    walking: { distanceMeters: null, durationMinutes: null, source: "missing" },
    transit: { distanceMeters: null, durationMinutes: null, source: "missing" },
    score: 0,
  };
}

export function buildCustomPoiScore(customPoi: CustomPoi): CustomPoiScore {
  return {
    customPoiId: customPoi.id,
    name: customPoi.name,
    address: customPoi.address,
    latitude: customPoi.latitude ?? 0,
    longitude: customPoi.longitude ?? 0,
    walking: { distanceMeters: null, durationMinutes: null, source: "missing" },
    transit: { distanceMeters: null, durationMinutes: null, source: "missing" },
    score: 0,
  };
}
