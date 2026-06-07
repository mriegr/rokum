export type StandardPoiCategory =
  | "supermarket"
  | "sport_studio"
  | "ubahn"
  | "cafe"
  | "park_or_river";

export type PoiCategory = StandardPoiCategory | "custom";

export type TravelMetrics = {
  distanceMeters: number | null;
  durationMinutes: number | null;
  source: string;
};

export type ApartmentInput = {
  address: string;
  squareMeters: number;
  kaltmiete: number;
  warmmiete: number;
  floorLevel: string;
  roomCount: number;
  description: string;
};

export type Apartment = ApartmentInput & {
  id: number;
  latitude: number | null;
  longitude: number | null;
  totalScore: number;
  scoring: ApartmentScoreSnapshot;
  photos: ApartmentPhoto[];
  createdAt: string;
  updatedAt: string;
};

export type ApartmentPhoto = {
  id: number;
  apartmentId: number;
  url: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sortOrder: number;
  createdAt: string;
};

export type PoiRecord = {
  id: number;
  category: StandardPoiCategory;
  name: string;
  address: string;
  isActive: boolean;
  latitude: number;
  longitude: number;
  source: string;
  externalId: string | null;
  tags: string[];
};

export type CustomPoiInput = {
  name: string;
  address: string;
  notes: string;
  isActive: boolean;
};

export type CustomPoi = CustomPoiInput & {
  id: number;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WeightSettings = {
  pricePerSqm: number;
  rooms: number;
  supermarket: number;
  sportStudio: number;
  ubahn: number;
  cafe: number;
  parkOrRiver: number;
  customPoi: number;
};

export type StandardPoiScore = {
  category: StandardPoiCategory;
  label: string;
  poiName: string;
  poiAddress: string;
  latitude: number;
  longitude: number;
  walking: TravelMetrics;
  transit: TravelMetrics;
  score: number;
};

export type CustomPoiScore = {
  customPoiId: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  walking: TravelMetrics;
  transit: TravelMetrics;
  score: number;
};

export type ApartmentScoreSnapshot = {
  pricePerSqm: number;
  roomScore: number;
  pricePerSqmValue: number | null;
  standardPoiScores: StandardPoiScore[];
  customPoiScores: CustomPoiScore[];
  totalScore: number;
  updatedAt: string | null;
};

export type MapPayload = {
  apartment: Apartment;
  standardPoiScores: StandardPoiScore[];
  customPoiScores: CustomPoiScore[];
  nearbyPois: PoiRecord[];
  sportStudioTags: string[];
  transitStops: TransitStop[];
  ubahnRoutes: UbahnRoute[];
};

export type TransitStop = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  modes: string[];
};

export type UbahnRoute = {
  id: string;
  name: string;
  ref: string;
  color: string | null;
  paths: Array<Array<{ latitude: number; longitude: number }>>;
};

export type BootstrapPayload = {
  apartments: Apartment[];
  customPois: CustomPoi[];
  settings: WeightSettings;
  mapConfig: MapConfig;
};

export type ManagedPoi = {
  id: number;
  kind: "standard" | "custom";
  category: StandardPoiCategory | "custom";
  categoryLabel: string;
  name: string;
  address: string;
  isActive: boolean;
  notes: string;
  source: string | null;
  tags: string[];
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string | null;
};

export type PoiManagementPayload = {
  pois: ManagedPoi[];
};

export type AppConfig = {
  port: number;
  city: string;
  databasePath: string;
  uploadDirectory: string;
  nominatimBaseUrl: string;
  overpassBaseUrl: string;
  walkingBaseUrl: string;
  transitBaseUrl: string | null;
  transitMode: "heuristic" | "otp1";
  jawgApiKey: string | null;
  jawgStyleId: string;
};

export type MapConfig =
  | {
      available: true;
      styleUrl: string;
      attribution: string;
      center: [number, number];
      bounds: [[number, number], [number, number]];
      minZoom: number;
      maxZoom: number;
    }
  | {
      available: false;
      unavailableReason: string;
      styleUrl: null;
    };
