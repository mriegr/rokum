
Use Bun by default.

- Use `bun`, `bun run`, `bun test`, `bunx`, and `bun build`; do not switch to `node`, `npm`, `yarn`, `pnpm`, `vite`, `webpack`, or `ts-node` unless the repo already requires it.
- Prefer Bun-native APIs: `Bun.serve`, `bun:sqlite`, `Bun.redis`, `Bun.sql`, built-in `WebSocket`, `Bun.file`, and `Bun.$`.
- Bun loads `.env` automatically. Treat `.env` as secret material and never print or paste secret values.

## Workflow

- Prefer a TDD loop when practical: failing test, small fix, targeted rerun, then broader verification.
- After non-trivial changes, run `bunx tsc --noEmit` and `bun test`.
- Prefer small local patches and avoid broad refactors unless they clearly reduce complexity or duplicate remote calls.

## Code Organization

The `src/` directory is split into three areas. Place new code in the right location from the start.

### `src/shared/` — Types, config, and constants

`types.ts`, `config.ts`, `munich.ts`.

**Rules:**
- If a type, constant, or utility is imported by both `src/backend/` and `src/frontend/`, it belongs here.
- Must not import from `src/backend/` or `src/frontend/`.
- No DB access, remote calls, DOM logic, or rendering code.

### `src/backend/` — Server-side code

`server.ts` (API handlers, validation, scoring orchestration), `db.ts` (schema + persistence, no business logic), `services.ts` (remote integrations, caching, uploads), `scoring.ts` (pure math, no DB/network), `routeSimplifier.ts`, `transitOverlayCache.ts`.

**Rules:**
- `db.ts` imports only from `src/shared/`. No imports from other backend modules.
- `services.ts` must not import from `db.ts` or `server.ts`. It provides data upstream.
- `scoring.ts`: pure functions only.
- New handlers go in `server.ts`. Extract to a new file under `src/backend/` only when complex — never cross the frontend/backend boundary.

### `src/frontend/` — Client-side code

`main.ts` (boot + CSS), `state.ts` (types, initial state, constants, pure accessor helpers), `helpers.ts` (formatting, API fetch, popup HTML, map utilities — no DOM or state), `mapFeatures.ts` (GeoJSON builders, pure, no side effects), `map.ts` (MapLibre lifecycle, sources/layers, popups), `views.ts` (all HTML rendering — no event binding, no fetch), `events.ts` (render orchestrator, event binding, data loading/refresh), `poiFilters.ts` (POI filtering/indexing).

**Rules:**
- Rendering → `views.ts`. Event binding → `events.ts`. Map code → `map.ts` / `mapFeatures.ts`.
- State shape changes: update `state.ts` first, then `views.ts`, then `events.ts`.
- All client data flows through `state`. No UI-only data on DOM elements or closures.
- Never import from `src/backend/`. Frontend talks to backend exclusively via HTTP to `/api/...`.

### Map behavioral rules

- Do not recreate the MapLibre instance for filter-only changes. Use `syncMapSources` in `map.ts`.
- Preserve viewport for display/filter toggles (`renderMap({ preserveViewport: true })`). Refit only on apartment/payload change.
- Keep map resources behind `/api/map/...`. Never expose provider URLs or API keys to the browser.
- Keep map constrained to Munich greater-area bounds.

### Tests

- Colocate with source: `src/backend/scoring.test.ts` next to `src/backend/scoring.ts`.
- Browser tests (Playwright) live in `src/frontend/`.
- Run `bun test` for all; `bun run test:browser` for browser tests.

## Documentation

- Keep `README.md` focused on setup and user-facing summaries.
- Keep `ARCHITECTURE.md` as source of truth for architecture, data flow, quirks, and constraints.
- Update docs in the same task as any behavior/structure change. Do not defer documentation.
- If a change doesn't warrant doc edits, verify existing docs still describe the system accurately.

## Remote Data

- Nominatim, Overpass, OSRM, OTP, and Jawg are rate-limited. Cache aggressively, deduplicate requests, and use stale-cache fallback.
- Prefer server-side caching, graceful degradation, and conservative retries.
- Never expose provider URLs or API keys to the client. Proxy through `/api/map/...` on the server.

## Verification

- Favor regression coverage for map state, caching, and API-failure fallbacks.
- For map changes, verify browser and network behavior.
- Confirm filter toggles don't trigger unnecessary `/api/apartments/:id/map` reloads or tile bursts.
- Verify basemap responses come from the local proxy and preserve provider cache headers.

## Multi-Agent

- Coordinator: plan, decompose, delegate, review. No large code edits.
- Implementer: coding, refactoring, bug fixes.
- Validator: Playwright testing, browser debugging, screenshots, traces, root-cause analysis, code/security review.
- No subagents for trivial tasks. No nested subagents.
- Prefer one implementer and one validator per task.
- Use the validator only when tests, browser interaction, screenshots, or verification are required.

## Validator Workflow

1. Execute Playwright tests.
2. Inspect failures.
3. Inspect screenshots and traces.
4. Classify root cause as `implementation bug`, `flaky test`, `environment issue`, or `product defect`.
5. Provide an actionable report with recommended fix.
6. Rerun validation if required.
