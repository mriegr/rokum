import { Database } from "bun:sqlite";
import type {
  Apartment,
  ApartmentInput,
  ApartmentPhoto,
  AppConfig,
  ApartmentScoreSnapshot,
  CustomPoi,
  CustomPoiInput,
  CustomPoiScore,
  PoiCategoryLabelRecord,
  PoiIconRecord,
  PoiRecord,
  StandardPoiCategory,
  StandardPoiScore,
  WeightSettings,
} from "../shared/types";
import { STANDARD_POI_CATEGORIES } from "../shared/types";
import { DEFAULT_WEIGHTS } from "./scoring";

type SqlDatabase = Database;

function now() {
  return new Date().toISOString();
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as T | null;
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function mapApartmentPhoto(row: Record<string, unknown>): ApartmentPhoto {
  return {
    id: Number(row.id),
    apartmentId: Number(row.apartment_id),
    url: `/uploads/${String(row.storage_key)}`,
    storageKey: String(row.storage_key),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    sortOrder: Number(row.sort_order),
    createdAt: String(row.created_at),
  };
}

function mapApartment(row: Record<string, unknown>, photos: ApartmentPhoto[]): Apartment {
  const fallbackScoring: ApartmentScoreSnapshot = {
    pricePerSqm: 0,
    roomScore: 0,
    pricePerSqmValue: null,
    standardPoiScores: [],
    customPoiScores: [],
    totalScore: Number(row.total_score ?? 0),
    updatedAt: null,
  };

  const validCategories = new Set<string>(STANDARD_POI_CATEGORIES);
  const scoring = parseJson(
    row.scoring_payload === null ? null : String(row.scoring_payload),
    fallbackScoring,
  );
  scoring.standardPoiScores = scoring.standardPoiScores.filter((s) => validCategories.has(s.category));

  return {
    id: Number(row.id),
    address: String(row.address),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    squareMeters: Number(row.square_meters),
    kaltmiete: Number(row.kaltmiete),
    warmmiete: Number(row.warmmiete),
    floorLevel: String(row.floor_level ?? ""),
    roomCount: Number(row.room_count),
    description: String(row.description ?? ""),
    totalScore: Number(row.total_score ?? 0),
    scoring,
    photos,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapCustomPoi(row: Record<string, unknown>): CustomPoi {
  return {
    id: Number(row.id),
    name: String(row.name),
    address: String(row.address),
    notes: String(row.notes ?? ""),
    isActive: Boolean(row.is_active),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapPoi(row: Record<string, unknown>): PoiRecord {
  const rawSource = String(row.source);
  let source: string[];
  try {
    source = JSON.parse(rawSource);
    if (!Array.isArray(source)) source = [rawSource];
  } catch {
    source = [rawSource];
  }
  return {
    id: Number(row.id),
    category: String(row.category) as StandardPoiCategory,
    subcategory: String(row.subcategory ?? ""),
    name: String(row.name),
    address: String(row.address),
    isActive: Boolean(row.is_active),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    source,
    externalId: row.external_id === null ? null : String(row.external_id),
    tags: parseJson(row.tags_json === null ? null : String(row.tags_json), [] as string[]),
    note: String(row.note ?? ""),
  };
}

export function createDatabase(config: AppConfig) {
  const database = new Database(config.databasePath, { create: true });
  database.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS apartments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      square_meters REAL NOT NULL,
      kaltmiete REAL NOT NULL,
      warmmiete REAL NOT NULL,
      floor_level TEXT NOT NULL DEFAULT '',
      room_count REAL NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      total_score REAL NOT NULL DEFAULT 0,
      scoring_payload TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apartment_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      storage_key TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pois (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      source TEXT NOT NULL,
      external_id TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(category, name, latitude, longitude)
    );

    CREATE TABLE IF NOT EXISTS custom_pois (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      latitude REAL,
      longitude REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apartment_poi_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      poi_name TEXT NOT NULL,
      poi_address TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      walking_distance_meters REAL,
      walking_duration_minutes REAL,
      transit_duration_minutes REAL,
      score REAL NOT NULL,
      details_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS apartment_custom_poi_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      apartment_id INTEGER NOT NULL REFERENCES apartments(id) ON DELETE CASCADE,
      custom_poi_id INTEGER NOT NULL REFERENCES custom_pois(id) ON DELETE CASCADE,
      walking_distance_meters REAL,
      walking_duration_minutes REAL,
      transit_duration_minutes REAL,
      score REAL NOT NULL,
      details_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS poi_icons (
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL DEFAULT '',
      icon_path TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(category, subcategory)
    );

    CREATE TABLE IF NOT EXISTS poi_category_labels (
      category TEXT NOT NULL,
      subcategory TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(category, subcategory)
    );
  `);

  const poiColumns = database
    .query("PRAGMA table_info(pois)")
    .all() as Array<{ name: string }>;
  if (!poiColumns.some((column) => column.name === "tags_json")) {
    database.exec("ALTER TABLE pois ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';");
  }
  if (!poiColumns.some((column) => column.name === "is_active")) {
    database.exec("ALTER TABLE pois ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;");
  }
  if (!poiColumns.some((column) => column.name === "note")) {
    database.exec("ALTER TABLE pois ADD COLUMN note TEXT NOT NULL DEFAULT '';");
  }
  if (!poiColumns.some((column) => column.name === "subcategory")) {
    database.exec("ALTER TABLE pois ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';");
  }

  // Migrate legacy single-value source to JSON array
  const rowsWithLegacySource = database
    .query("SELECT id, source FROM pois WHERE source NOT LIKE '[%'")
    .all() as Array<{ id: number; source: string }>;
  for (const row of rowsWithLegacySource) {
    database
      .query("UPDATE pois SET source = ?1 WHERE id = ?2")
      .run(JSON.stringify([row.source]), row.id);
  }

  const existingWeights = database
    .query("SELECT value FROM settings WHERE key = 'weights'")
    .get() as { value: string } | null;

  if (!existingWeights) {
    database
      .query("INSERT INTO settings (key, value) VALUES ('weights', ?1)")
      .run(JSON.stringify(DEFAULT_WEIGHTS));
  }

  return database;
}

export function listApartments(database: SqlDatabase) {
  const apartmentRows = database
    .query("SELECT * FROM apartments ORDER BY total_score DESC, created_at DESC")
    .all() as Record<string, unknown>[];

  const photoRows = database
    .query("SELECT * FROM apartment_photos ORDER BY apartment_id, sort_order, id")
    .all() as Record<string, unknown>[];

  const photoMap = new Map<number, ApartmentPhoto[]>();
  for (const row of photoRows) {
    const photo = mapApartmentPhoto(row);
    const bucket = photoMap.get(photo.apartmentId) ?? [];
    bucket.push(photo);
    photoMap.set(photo.apartmentId, bucket);
  }

  return apartmentRows.map((row) => mapApartment(row, photoMap.get(Number(row.id)) ?? []));
}

export function getApartmentById(database: SqlDatabase, apartmentId: number) {
  const row = database
    .query("SELECT * FROM apartments WHERE id = ?1")
    .get(apartmentId) as Record<string, unknown> | null;

  if (!row) {
    return null;
  }

  const photoRows = database
    .query("SELECT * FROM apartment_photos WHERE apartment_id = ?1 ORDER BY sort_order, id")
    .all(apartmentId) as Record<string, unknown>[];

  return mapApartment(
    row,
    photoRows.map((photoRow) => mapApartmentPhoto(photoRow)),
  );
}

export function insertApartment(database: SqlDatabase, input: ApartmentInput) {
  const timestamp = now();
  const result = database
    .query(
      `
        INSERT INTO apartments (
          address, latitude, longitude, square_meters, kaltmiete, warmmiete,
          floor_level, room_count, description, total_score, scoring_payload,
          created_at, updated_at
        ) VALUES (?1, NULL, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 0, NULL, ?8, ?8)
      `,
    )
    .run(
      input.address,
      input.squareMeters,
      input.kaltmiete,
      input.warmmiete,
      input.floorLevel,
      input.roomCount,
      input.description,
      timestamp,
    );

  return Number(result.lastInsertRowid);
}

export function updateApartmentRecord(
  database: SqlDatabase,
  apartmentId: number,
  input: ApartmentInput,
) {
  database
    .query(
      `
        UPDATE apartments
        SET address = ?2,
            square_meters = ?3,
            kaltmiete = ?4,
            warmmiete = ?5,
            floor_level = ?6,
            room_count = ?7,
            description = ?8,
            updated_at = ?9
        WHERE id = ?1
      `,
    )
    .run(
      apartmentId,
      input.address,
      input.squareMeters,
      input.kaltmiete,
      input.warmmiete,
      input.floorLevel,
      input.roomCount,
      input.description,
      now(),
    );
}

export function deleteApartmentRecord(database: SqlDatabase, apartmentId: number) {
  database.query("DELETE FROM apartments WHERE id = ?1").run(apartmentId);
}

export function updateApartmentCoordinates(
  database: SqlDatabase,
  apartmentId: number,
  latitude: number,
  longitude: number,
) {
  database
    .query(
      "UPDATE apartments SET latitude = ?2, longitude = ?3, updated_at = ?4 WHERE id = ?1",
    )
    .run(apartmentId, latitude, longitude, now());
}

export function setApartmentScoring(
  database: SqlDatabase,
  apartmentId: number,
  scoring: ApartmentScoreSnapshot,
) {
  database
    .query(
      `
        UPDATE apartments
        SET total_score = ?2,
            scoring_payload = ?3,
            updated_at = ?4
        WHERE id = ?1
      `,
    )
    .run(apartmentId, scoring.totalScore, JSON.stringify(scoring), now());
}

export function replaceApartmentPoiScores(
  database: SqlDatabase,
  apartmentId: number,
  standardPoiScores: StandardPoiScore[],
) {
    database.query("DELETE FROM apartment_poi_scores WHERE apartment_id = ?1").run(apartmentId);
    const statement = database.query(
      `
        INSERT INTO apartment_poi_scores (
          apartment_id, category, poi_name, poi_address, latitude, longitude,
          walking_distance_meters, walking_duration_minutes, transit_duration_minutes,
          score, details_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      `,
    );

    for (const score of standardPoiScores) {
      statement.run(
        apartmentId,
        score.category,
        score.poiName,
        score.poiAddress,
        score.latitude,
        score.longitude,
        score.walking.distanceMeters,
        score.walking.durationMinutes,
        score.transit.durationMinutes,
        score.score,
        JSON.stringify(score),
      );
    }
}

export function replaceApartmentCustomPoiScores(
  database: SqlDatabase,
  apartmentId: number,
  customPoiScores: CustomPoiScore[],
) {
  database
    .query("DELETE FROM apartment_custom_poi_scores WHERE apartment_id = ?1")
    .run(apartmentId);
  const statement = database.query(
    `
      INSERT INTO apartment_custom_poi_scores (
        apartment_id, custom_poi_id, walking_distance_meters,
        walking_duration_minutes, transit_duration_minutes, score, details_json
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    `,
  );

  for (const score of customPoiScores) {
    statement.run(
      apartmentId,
      score.customPoiId,
      score.walking.distanceMeters,
      score.walking.durationMinutes,
      score.transit.durationMinutes,
      score.score,
      JSON.stringify(score),
    );
  }
}

export function addApartmentPhoto(
  database: SqlDatabase,
  apartmentId: number,
  storageKey: string,
  originalName: string,
  mimeType: string,
) {
  const row = database
    .query(
      "SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM apartment_photos WHERE apartment_id = ?1",
    )
    .get(apartmentId) as { max_sort: number };

  database
    .query(
      `
        INSERT INTO apartment_photos (
          apartment_id, storage_key, original_name, mime_type, sort_order, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      `,
    )
    .run(apartmentId, storageKey, originalName, mimeType, Number(row.max_sort) + 1, now());
}

export function getApartmentPhoto(
  database: SqlDatabase,
  apartmentId: number,
  photoId: number,
) {
  return (database
    .query("SELECT * FROM apartment_photos WHERE apartment_id = ?1 AND id = ?2")
    .get(apartmentId, photoId) ?? null) as Record<string, unknown> | null;
}

export function deleteApartmentPhotoRecord(
  database: SqlDatabase,
  apartmentId: number,
  photoId: number,
) {
  database
    .query("DELETE FROM apartment_photos WHERE apartment_id = ?1 AND id = ?2")
    .run(apartmentId, photoId);
}

export function getWeightSettings(database: SqlDatabase): WeightSettings {
  const row = database
    .query("SELECT value FROM settings WHERE key = 'weights'")
    .get() as { value: string } | null;
  return parseJson(row?.value ?? null, DEFAULT_WEIGHTS);
}

export function saveWeightSettings(database: SqlDatabase, settings: WeightSettings) {
  database
    .query(
      `
        INSERT INTO settings (key, value)
        VALUES ('weights', ?1)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
    )
    .run(JSON.stringify(settings));
}

export function listCustomPois(database: SqlDatabase) {
  const rows = database
    .query("SELECT * FROM custom_pois ORDER BY is_active DESC, name ASC")
    .all() as Record<string, unknown>[];
  return rows.map(mapCustomPoi);
}

export function getCustomPoiById(database: SqlDatabase, customPoiId: number) {
  const row = database
    .query("SELECT * FROM custom_pois WHERE id = ?1")
    .get(customPoiId) as Record<string, unknown> | null;
  return row ? mapCustomPoi(row) : null;
}

export function insertCustomPoi(database: SqlDatabase, input: CustomPoiInput) {
  const timestamp = now();
  const result = database
    .query(
      `
        INSERT INTO custom_pois (
          name, address, notes, latitude, longitude, is_active, created_at, updated_at
        ) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?5)
      `,
    )
    .run(input.name, input.address, input.notes, input.isActive ? 1 : 0, timestamp);

  return Number(result.lastInsertRowid);
}

export function updateCustomPoiRecord(
  database: SqlDatabase,
  customPoiId: number,
  input: CustomPoiInput,
) {
  database
    .query(
      `
        UPDATE custom_pois
        SET name = ?2,
            address = ?3,
            notes = ?4,
            is_active = ?5,
            updated_at = ?6
        WHERE id = ?1
      `,
    )
    .run(customPoiId, input.name, input.address, input.notes, input.isActive ? 1 : 0, now());
}

export function updateCustomPoiCoordinates(
  database: SqlDatabase,
  customPoiId: number,
  latitude: number,
  longitude: number,
) {
  database
    .query(
      "UPDATE custom_pois SET latitude = ?2, longitude = ?3, updated_at = ?4 WHERE id = ?1",
    )
    .run(customPoiId, latitude, longitude, now());
}

export function deleteCustomPoiRecord(database: SqlDatabase, customPoiId: number) {
  database.query("DELETE FROM custom_pois WHERE id = ?1").run(customPoiId);
}

export function insertOrIgnorePoi(database: SqlDatabase, poi: Omit<PoiRecord, "id">) {
  database
    .query(
      `
        INSERT INTO pois (
          category, subcategory, name, address, is_active, latitude, longitude, source, external_id, tags_json, note, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
        ON CONFLICT(category, name, latitude, longitude) DO UPDATE SET
          address = excluded.address,
          source = excluded.source,
          external_id = excluded.external_id,
          tags_json = excluded.tags_json,
          note = excluded.note,
          subcategory = excluded.subcategory
      `,
    )
    .run(
      poi.category,
      poi.subcategory,
      poi.name,
      poi.address,
      poi.isActive ? 1 : 0,
      poi.latitude,
      poi.longitude,
      JSON.stringify(poi.source),
      poi.externalId,
      JSON.stringify(poi.tags),
      poi.note,
      now(),
    );
}

export function listPoisByCategory(database: SqlDatabase, category: StandardPoiCategory) {
  return (database
    .query("SELECT * FROM pois WHERE category = ?1")
    .all(category) as Record<string, unknown>[]).map(mapPoi);
}

export function listAllPois(database: SqlDatabase) {
  return (database.query("SELECT * FROM pois").all() as Record<string, unknown>[]).map(mapPoi);
}

export function getPoiById(database: SqlDatabase, poiId: number) {
  const row = database.query("SELECT * FROM pois WHERE id = ?1").get(poiId) as Record<string, unknown> | null;
  return row ? mapPoi(row) : null;
}

export function updatePoiRecord(
  database: SqlDatabase,
  poiId: number,
  input: Pick<PoiRecord, "category" | "subcategory" | "name" | "address" | "note">,
) {
  database
    .query(
      `
        UPDATE pois
        SET category = ?2, subcategory = ?3, name = ?4, address = ?5, note = ?6
        WHERE id = ?1
      `,
    )
    .run(poiId, input.category, input.subcategory, input.name, input.address, input.note);
}

export function updatePoiCoordinates(database: SqlDatabase, poiId: number, latitude: number, longitude: number) {
  database.query("UPDATE pois SET latitude = ?2, longitude = ?3 WHERE id = ?1").run(poiId, latitude, longitude);
}

export function listActivePoisByCategory(database: SqlDatabase, category: string) {
  return (database
    .query("SELECT * FROM pois WHERE category = ?1 AND is_active = 1")
    .all(category) as Record<string, unknown>[]).map(mapPoi);
}

export function listActivePois(database: SqlDatabase) {
  return (database
    .query("SELECT * FROM pois WHERE is_active = 1")
    .all() as Record<string, unknown>[]).map(mapPoi);
}

export function updatePoiActiveState(
  database: SqlDatabase,
  poiId: number,
  isActive: boolean,
) {
  database.query("UPDATE pois SET is_active = ?2 WHERE id = ?1").run(poiId, isActive ? 1 : 0);
}

export function bulkUpdatePoiActiveState(
  database: SqlDatabase,
  payload: {
    standardPoiIds: number[];
    customPoiIds: number[];
    isActive: boolean;
  },
) {
  const standardStatement = database.query("UPDATE pois SET is_active = ?2 WHERE id = ?1");
  for (const poiId of payload.standardPoiIds) {
    standardStatement.run(poiId, payload.isActive ? 1 : 0);
  }

  const customStatement = database.query(
    "UPDATE custom_pois SET is_active = ?2, updated_at = ?3 WHERE id = ?1",
  );
  const timestamp = now();
  for (const customPoiId of payload.customPoiIds) {
    customStatement.run(customPoiId, payload.isActive ? 1 : 0, timestamp);
  }
}

export function listPoiIcons(database: SqlDatabase): PoiIconRecord[] {
  return (database
    .query("SELECT category, subcategory, icon_path FROM poi_icons ORDER BY category, subcategory")
    .all() as Array<{ category: string; subcategory: string; icon_path: string }>).map(
    (row) => ({
      category: row.category,
      subcategory: row.subcategory,
      iconPath: row.icon_path,
    }),
  );
}

export function getPoiIcon(
  database: SqlDatabase,
  category: string,
  subcategory: string,
): PoiIconRecord | null {
  const row = database
    .query("SELECT category, subcategory, icon_path FROM poi_icons WHERE category = ?1 AND subcategory = ?2")
    .get(category, subcategory) as { category: string; subcategory: string; icon_path: string } | null;
  if (!row) return null;
  return { category: row.category, subcategory: row.subcategory, iconPath: row.icon_path };
}

export function upsertPoiIcon(
  database: SqlDatabase,
  category: string,
  subcategory: string,
  iconPath: string,
) {
  database
    .query(
      `
      INSERT INTO poi_icons (category, subcategory, icon_path, updated_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(category, subcategory) DO UPDATE SET
        icon_path = excluded.icon_path,
        updated_at = excluded.updated_at
    `,
    )
    .run(category, subcategory, iconPath, now());
}

export function deletePoiIcon(
  database: SqlDatabase,
  category: string,
  subcategory: string,
) {
  database
    .query("DELETE FROM poi_icons WHERE category = ?1 AND subcategory = ?2")
    .run(category, subcategory);
}

export function listPoiCategoryLabels(database: SqlDatabase): PoiCategoryLabelRecord[] {
  return (database
    .query(
      "SELECT category, subcategory, label FROM poi_category_labels ORDER BY category, subcategory",
    )
    .all() as Array<{ category: string; subcategory: string; label: string }>).map((row) => ({
    category: row.category,
    subcategory: row.subcategory,
    label: row.label,
  }));
}

export function upsertPoiCategoryLabel(
  database: SqlDatabase,
  category: string,
  subcategory: string,
  label: string,
) {
  database
    .query(
      `
      INSERT INTO poi_category_labels (category, subcategory, label, updated_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(category, subcategory) DO UPDATE SET
        label = excluded.label,
        updated_at = excluded.updated_at
    `,
    )
    .run(category, subcategory, label, now());
}
