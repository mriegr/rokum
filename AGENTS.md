
Use Bun by default.

- Use `bun`, `bun run`, `bun test`, `bunx`, and `bun build`; do not switch to `node`, `npm`, `yarn`, `pnpm`, `vite`, `webpack`, or `ts-node` unless the repo already requires it.
- Prefer Bun-native APIs: `Bun.serve`, `bun:sqlite`, `Bun.redis`, `Bun.sql`, built-in `WebSocket`, `Bun.file`, and `Bun.$`.
- Bun loads `.env` automatically. Treat `.env` as secret material and never print or paste secret values.

## Workflow

- Prefer a TDD loop when practical: failing test, small fix, targeted rerun, then broader verification.
- After non-trivial changes, run `bunx tsc --noEmit` and `bun test`.
- Prefer small local patches and avoid broad refactors unless they clearly reduce complexity or duplicate remote calls.

## Documentation

- Keep `README.md` focused on setup, running, and user-facing capability summaries.
- Keep `ARCHITECTURE.md` as the internal source of truth for architecture, code structure, data flow, quirks, and operational constraints.
- After any change that affects behavior, structure, APIs, persistence, scoring, caching, map interactions, POI handling, or developer workflow, update the relevant documentation in the same task.
- Do not leave documentation updates as follow-up work when the code change materially changes how the system works.
- If a change is too small to require documentation edits, make that a conscious decision and verify that existing docs still describe the system accurately.

## Frontend And Map

- For frontend entrypoints, prefer Bun HTML imports and `Bun.serve`; do not introduce Vite.
- Do not recreate the MapLibre map instance for filter-only UI changes. Update sources, layers, and sidebar state in place.
- Keep map resources behind `/api/map/...`; do not expose provider URLs or API keys in the browser.
- Preserve the current viewport for display toggles and filter changes. Refit only when apartment focus or the underlying map payload changes.
- Keep the map constrained to the Munich greater-area bounds unless requirements change.

## Remote Data

- Nominatim, Overpass, OSRM, OTP, and Jawg are rate-limited. Reuse cached data, avoid duplicate requests, and prefer coarse cache keys with bounded TTLs.
- Prefer server-side caching, request deduplication, graceful fallback behavior, conservative retries, and stale-cache fallback where reasonable.
- Do not move secret-bearing provider calls to the client when a server-side proxy is viable.
- If a remote dependency fails or returns `429`, degrade gracefully and keep the UI usable.

## Verification

- Favor regression coverage for map state, caching behavior, and API-failure fallbacks.
- For map changes, verify both browser behavior and network behavior.
- Confirm filter toggles do not trigger unnecessary `/api/apartments/:id/map` reloads or fresh tile bursts.
- If basemap resources are involved, verify responses come from the local proxy and preserve provider cache headers.

## Multi-Agent

- Coordinator: plan, decompose, delegate, review outputs, and make final decisions. Do not perform large code edits or duplicate delegated implementation.
- Implementer: always handle coding, refactoring, bug fixes, and implementation.
- Validator: always handle validation, Playwright testing, browser debugging, visual regression analysis, screenshot inspection, trace inspection, regression testing, root-cause analysis, code review, and security review.
- Do not spawn subagents for trivial tasks.
- No nested subagents.
- Prefer one implementer and one validator.
- Keep delegated summaries compact and avoid passing large transcripts between agents.
- Use the validator only when tests, browser interaction, screenshots, or verification are required.

## Validator Workflow

1. Execute Playwright tests.
2. Inspect failures.
3. Inspect screenshots.
4. Inspect traces.
5. Determine root cause.
6. Classify as `implementation bug`, `flaky test`, `environment issue`, or `product defect`.
7. Provide an actionable report.
8. Recommend a fix.
9. Rerun validation if required.
