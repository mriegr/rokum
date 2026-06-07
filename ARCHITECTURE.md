# Rokum Architecture

This file is the internal development reference for Rokum. `README.md` stays focused on setup and running the app; this document captures structure, behavior, and quirks that matter when changing the code.

## What the app is

Rokum is a Bun-based single-process application for comparing Munich apartment listings.

It combines:

- Apartment CRUD with photo uploads
- Persisted scoring snapshots per apartment
- Standard POI scoring for a fixed category set
- User-managed custom POIs
- A MapLibre-based map view with proxied Jawg vector resources and transit overlays
- A POI management screen for enabling/disabling cached and custom POIs

## Runtime shape

The app is intentionally simple:

- `index.ts`: Bun entrypoint, route registration, JSON helpers, route-to-handler wiring
- `index.html`: single HTML shell imported directly by Bun
- `src/frontend.ts`: client app state, rendering, event binding, MapLibre integration
- `src/server.ts`: application orchestration, validation, rescoring, Jawg style/resource proxying
- `src/db.ts`: SQLite schema creation plus all persistence helpers
- `src/services.ts`: remote integrations, caching, seeding, routing, geocoding, overlays, uploads
- `src/scoring.ts`: pure scoring math and default weights
- `src/types.ts`: shared API and domain types
- `src/poiFilters.ts`: pure POI management filtering/indexing logic

There is no framework split between API server and SPA server. Bun serves both the shell and the JSON endpoints in one process.

## Request and data flow

### App bootstrap

`/api/bootstrap` is the main frontend bootstrap payload.

It returns:

- apartments
- custom POIs
- weight settings
- map config

The frontend uses this to initialize most of the application state. The POI management page is loaded separately through `/api/pois`.

### Apartment lifecycle

Typical flow for create/update:

1. Frontend sends apartment input to the API.
2. `server.ts` validates the payload.
3. `db.ts` persists the apartment row.
4. The app tries to geocode the address if coordinates are missing.
5. The app rescoring pipeline computes standard POI scores, custom POI scores, and total score.
6. The scoring snapshot is written back to SQLite and returned to the client.

Important consequence: apartment rows store both normalized apartment data and a persisted `scoring_payload`. The UI is mostly reading cached scoring state, not recomputing in the browser.

### Map view

`/api/apartments/:id/map` returns a dedicated `MapPayload` for the selected apartment:

- selected apartment
- standard POI scores
- custom POI scores
- nearby active POIs
- sport studio tags for filter chips
- transit stops
- U-Bahn route geometry

The map view should treat this payload as the source of truth for the focused apartment.

### POI management

`/api/pois` returns all managed POIs as a flattened `ManagedPoi[]` that merges:

- standard POIs from `pois`
- custom POIs from `custom_pois`

`/api/pois/status` updates active state in bulk and then rescoring is triggered for all apartments.

Important consequence: toggling POI activation is not a cheap UI-only setting. It changes scoring inputs and therefore intentionally forces a full rescore pass.

## Persistence model

SQLite is the only data store. WAL mode is enabled.

Main tables:

- `apartments`: apartment input plus coordinates, total score, persisted scoring snapshot
- `apartment_photos`: uploaded image metadata keyed by `storage_key`
- `pois`: cached standard POIs from external sources
- `custom_pois`: user-defined destinations
- `apartment_poi_scores`: persisted per-apartment standard POI score details
- `apartment_custom_poi_scores`: persisted per-apartment custom POI score details
- `settings`: currently used for weights JSON

Schema evolution is currently lightweight and inline. Example: `createDatabase()` adds `tags_json` and `is_active` to `pois` if missing. There is no formal migration framework yet.

Important consequence: schema changes should stay backward-compatible unless a proper migration mechanism is introduced.

## Core domain rules

### Standard POI categories

The standard category set is fixed in code:

- `supermarket`
- `sport_studio`
- `ubahn`
- `cafe`
- `park_or_river`

These categories drive:

- score calculation
- weight keys
- map filter UI
- POI admin UI
- remote fetch logic

If a new standard category is introduced, it must be wired through all of those places.

### Custom POIs

Custom POIs are distinct from standard POIs:

- They are user-created.
- They can be active/inactive.
- They are scored separately.
- They use a stronger transit weighting than standard POIs.

Custom POIs are not stored in `pois` and do not share the same schema.

### Weight settings

Weights are persisted as JSON in `settings.key = 'weights'`.

The naming mismatch is intentional and must be preserved carefully:

- domain category `sport_studio` maps to weight key `sportStudio`
- domain category `park_or_river` maps to weight key `parkOrRiver`

This mapping exists in both `server.ts` and `scoring.ts`.

## Scoring model

Scoring is server-side and persisted.

Components:

- price-per-square-meter score
- room-count score
- one score per standard POI category
- one score per active custom POI

Travel scoring rules:

- standard POIs: `55% walking + 45% transit`
- custom POIs: `30% walking + 70% transit`

Fallback behavior is important:

- missing route/travel data yields `0` for that component
- missing POIs produce default score entries instead of removing the category
- transit can fall back from OTP to heuristic
- walking can fall back from OSRM to haversine-based estimates

Important consequence: the scoring shape is intentionally stable even when remote services fail.

## Remote services and caching

### Geocoding

- Provider: Nominatim-compatible `/search`
- Used for apartment addresses and custom POIs
- City is appended to the query

### Standard POI fetching

- Provider: Overpass for all standard categories except `sport_studio`
- `sport_studio` is seeded locally from `urbansportsclub-venues-with-addresses.json`
- The app first tries local active POIs and only fetches remote POIs when the local category cache is too sparse

Important consequence: `sport_studio` is special. It is not fetched from Overpass and its subcategories come from Urban Sports Club `categories`, stored as `tags_json`.

### Walking routes

- Provider: OSRM-compatible `/route/v1/walking/...`
- Fallback: haversine distance times a walking multiplier

### Transit routes

- Preferred provider: OTP1-compatible `/plan` when configured
- Default mode: heuristic estimate based on direct distance and U-Bahn proximity

### Transit overlay

- Provider: Overpass
- Caches stops/routes in memory by rounded origin coordinate
- Normalizes route colors from Overpass before sending them to the browser so MapLibre can render them reliably
- Returns empty overlays on failure and caches that failure briefly

### Map tiles

- Browser always loads the basemap through local `/api/map/...` routes
- Server proxies Jawg style, tile, glyph, and sprite requests
- The proxy forwards upstream cache headers and only deduplicates simultaneous identical requests
- Rokum does not persist Jawg resources or extend provider cache durations

Important consequence: browser code must never use direct third-party tile URLs.

## Frontend structure

`src/frontend.ts` is a manual client app, not React/Vue/etc.

It owns:

- shared application state
- HTML string rendering
- event binding after render
- map rendering and sidebar updates
- API fetch helpers

Main views:

- list view
- map view
- POI management view

The map has special handling:

- MapLibre instance should not be recreated for filter-only changes
- viewport should be preserved for display/filter toggles
- refit should happen only when focused apartment or underlying payload changes
- map bounds should stay within the Munich greater-area limits
- when `JAWG_API` is missing, the map view renders a disabled state and skips map-resource requests

The POI management page has its own performance-sensitive path:

- `/api/pois` is loaded once and filtered client-side
- `poiFilters.ts` pre-indexes search text
- search/filter/selection updates should rerender only the POI regions, not the entire app shell
- typing in POI search must not trigger network traffic

## Known quirks and gotchas

### Rescoring is broad

Several actions call `rescoreAllApartments()`:

- weight changes
- custom POI changes
- POI activation changes

That is correct for current behavior, but it means these operations scale with apartment count.

### Managed POIs are a merged view

The POI admin page works on `ManagedPoi`, not raw DB rows. That view merges two different sources with different semantics:

- standard POIs have `kind: "standard"` and category from the fixed standard set
- custom POIs have `kind: "custom"` and category `"custom"`

Bulk status updates rely on `kind` plus `id` to route updates to the right table.

### Inline migrations exist

`createDatabase()` contains compatibility patches instead of a real migration system. Any schema change should account for existing local databases.

### Source labels are operationally meaningful

`PoiRecord.source` is not just display metadata. It helps explain whether a POI came from:

- `overpass`
- `urbansportsclub`
- `custom`

Preserve it when changing POI flows.

### Sport studio tags are multi-purpose

`tags_json` for sport studios is used for:

- POI admin subcategory filters
- map sidebar sport type filters
- search indexing on the POI page

Changing seed structure or tag normalization affects multiple surfaces.

### Map payload vs bootstrap payload

Do not try to derive map behavior purely from `/api/bootstrap`. The focused map view depends on `/api/apartments/:id/map`.

## File-level guidance

Prefer these boundaries when making changes:

- `types.ts`: shared contracts only
- `db.ts`: database access and schema only
- `services.ts`: remote calls, caching, external-data translation, file upload mechanics
- `server.ts`: orchestration, input validation, state-changing workflows, API payload assembly
- `scoring.ts`: pure calculations only
- `frontend.ts`: browser state/rendering/event handling only
- `poiFilters.ts`: pure POI page filtering/indexing logic only

If a change crosses several of these layers, keep the responsibilities separated instead of collapsing logic into one file.

## Testing guidance

Current automated coverage is strongest for pure logic and DB behavior:

- `scoring.test.ts`
- `db.test.ts`
- `poiFilters.test.ts`
- `server.test.ts`

There is also dedicated browser coverage for the map view:

- `mapView.browser.test.ts`
- run it explicitly with `bun run test:browser`

When extending the app, prefer tests around:

- scoring math
- POI active/inactive behavior
- map filter regressions
- fallback behavior when remote providers fail
- client-side POI filtering logic

For frontend map and POI work, browser verification matters because several key constraints are behavioral:

- no unnecessary `/api/apartments/:id/map` reloads
- no unnecessary tile bursts
- no API traffic while typing into POI search
- basemap requests must stay on the local proxy routes

## Documentation upkeep

Keep this file current when changes affect:

- module responsibilities
- API payloads or routes
- DB schema or persistence behavior
- scoring rules or default weights
- caching/fallback behavior
- map interaction rules
- POI categories, filtering, or activation behavior
