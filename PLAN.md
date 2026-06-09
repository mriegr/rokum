# POI Page Performance Plan

## Objective

Keep the POI management page responsive with 1,000+ entries while preserving local filtering, bulk actions, editing, and the existing dense inventory layout.

## Current Bottlenecks

- `renderPoiTable()` creates the full HTML for every matched POI and replaces the complete table region.
- Search, filter, select-all, and single-row selection updates can rebuild more than 1,000 rich rows.
- A single checkbox change rerenders the toolbar, statistics, and entire table even though only selection controls changed.
- Repeated filtering and selection helpers independently scan the same indexed POI collection during one render pass.
- CSS containment is not used to isolate row layout and paint work.

## Implementation

### 1. Establish a Performance Baseline

- Add a browser test fixture that returns at least 1,200 deterministic managed POIs.
- Measure initial POI view rendering, search-to-visible-update latency, rendered row count, and selection latency.
- Verify that search and filter interactions do not request `/api/pois` again.
- Record DOM node and `.poi-admin-row` counts before optimization for comparison.

### 2. Add Pure Windowing Calculations

- Add a small pure helper in `src/frontend/poiFilters.ts` that calculates the visible slice from:
  - total matched rows
  - scroll offset
  - viewport height
  - fixed row height
  - overscan row count
- Return start/end indexes and top/bottom spacer heights.
- Add unit tests for empty lists, top/middle/bottom positions, overscan, and clamped bounds.

### 3. Add POI Viewport State

- Add POI table scroll position and viewport height to `src/frontend/state.ts`.
- Reset the scroll position when search or filter criteria change.
- Preserve the scroll position for selection-only updates and status refreshes where practical.
- Keep selection state keyed against the complete filtered result, not only rendered rows.

### 4. Window the Inventory Rows

- Change `renderPoiTable()` to render only the calculated visible slice plus top and bottom spacer elements.
- Keep the column header and selection bar outside the scrollable row viewport.
- Use a stable fixed row height at desktop widths so spacer calculations remain deterministic.
- Use a bounded or non-windowed fallback at responsive breakpoints where rows wrap to variable heights.
- Keep “Select visible” semantics tied to all POIs matching the filters, not merely the current window.
- Show both matched and currently rendered counts in accessible status text when useful for debugging and tests.

### 5. Handle Scrolling Without Full-Page Renders

- Attach one delegated, passive scroll listener to the POI table viewport.
- Schedule window updates with `requestAnimationFrame` and skip updates while the calculated range is unchanged.
- Replace only the windowed row container and spacers during scrolling.
- Avoid rebuilding the toolbar, statistics, controls, filter drawer, or editor on scroll.

### 6. Reduce Selection Rerenders

- On a single row checkbox change, update state and patch only:
  - the changed checkbox
  - selected count
  - select-all state
  - bulk-action disabled states
- For select-all, update the rendered checkboxes and selection summaries without recreating row markup.
- Reserve a full POI region update for search, category, subcategory, status, data refresh, and editor lifecycle changes.

### 7. Avoid Duplicate Filtering Work

- Calculate the filtered indexed entries once per POI update and pass that result into toolbar/table/selection rendering helpers.
- Build selected-key sets once per update.
- Avoid repeated `filteredManagedPois()` and `visibleManagedPoiSelectionState()` scans in the same render cycle.
- Keep the existing precomputed search index and avoid adding remote filtering or new API calls.

### 8. Add Layout and Paint Containment

- Add `contain` and `content-visibility` only where they improve isolation without breaking sticky controls or accessibility.
- Add `contain-intrinsic-size` as a fallback estimate for off-screen row layout.
- Keep hover, inactive-state, editor, and responsive styles visually unchanged.

## Verification

### Unit Tests

- Run `bun test src/frontend/poiFilters.test.ts` during the TDD loop.
- Cover window calculation boundaries and selection behavior across non-rendered matched rows.

### Browser Tests

- Add a POI browser test under `src/frontend/` using 1,200+ records.
- Verify the DOM contains only a small bounded number of rows on initial render.
- Scroll to the end and verify the final records become available.
- Search for a record outside the initial window and verify it appears.
- Select a row, scroll it out of the window, return, and verify selection persists.
- Select all matched POIs and verify bulk actions target the full filtered set.
- Verify typing in search causes no `/api/pois` reload and no map/tile requests.
- Run `bun run test:browser` and inspect failures, screenshots, and traces.

### Full Checks

- Run `bunx tsc --noEmit`.
- Run `bun test`.
- Compare before/after row counts and interaction timings with the same 1,200-record fixture.

## Documentation

- Update `ARCHITECTURE.md` to document POI row windowing, scroll state, full-match selection semantics, and the requirement that scrolling/filtering remain network-free.
- Update `README.md` only if the user-visible POI workflow changes; no update should be needed for a transparent performance improvement.

## Acceptance Criteria

- The POI page remains responsive with at least 1,200 entries.
- The table renders a bounded number of `.poi-admin-row` elements instead of every matched POI.
- Search, filters, scrolling, and selection do not reload `/api/pois`.
- Bulk actions continue to operate on the complete filtered or selected set as labeled.
- Selection persists when selected rows leave and re-enter the rendered window.
- Existing editing, status changes, filter drawer behavior, and responsive layouts remain functional.
- Type checking, unit tests, and browser tests pass.
