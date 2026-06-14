# Travel Time Calculation Source

This note captures the current routing/source decision for POI travel times in the map shortlist so future Codex work can resume the discussion without reloading the whole history.

## Context

- The map shortlist uses per-POI walking and transit metrics.
- Transit is queried at a representative weekday work-hour slot: Wednesday at 09:00 local time.
- Travel metrics are cached per apartment, POI, and `weekday-09:00` reference so repeated map opens do not rerun route lookups.
- The app rejects implausible walking speeds before caching or displaying results.
- If all remote walking providers fail or return bad data, the app falls back to a local haversine estimate.

## Decisions

- Keep transit and walking as separate sources.
- Use `OTP` for transit-time calculations.
- Use a dedicated walking router as the primary walking source.
- Keep `OSRM` as walking fallback.
- Keep the local haversine estimate as the last fallback when remote providers fail or return implausible results.
- Keep the plausibility check for walking speed before caching or displaying results.
- Cache computed travel metrics per apartment, POI, and weekday-09:00 transit reference.
- Keep the public map data flow server-side; the browser should only see the proxied result.

## Current Recommendation

- Primary walking router: `Valhalla`
- Walking fallback router: `OSRM`
- Transit router: `OTP`

## Current Implementation

- Walking provider selection is controlled by `WALKING_ROUTER_MODE`, `WALKING_ROUTER_BASE_URL`, `WALKING_ROUTER_FALLBACK_MODE`, and `WALKING_ROUTER_FALLBACK_BASE_URL`.
- Supported walking provider modes are `osrm` and `valhalla`.
- `Valhalla` is called with pedestrian costing over `POST /route`.
- `OSRM` is called with `GET /route/v1/walking/...`.
- The provider chain is primary walking source, optional fallback walking source, then haversine.
- The code checks for an impossible walking speed before accepting provider output.
- Cached rows are reused only when the stored walking metrics are still plausible.

## Open Questions

- Do we want to self-host `Valhalla`, or use a hosted endpoint?
- Should `OTP` also be used for walking-only routes, or kept strictly for transit?
- Do we want one provider for both walking and transit consistency, or best-in-class separate providers?
- What geographic coverage do we need for the walking router: Munich only, Germany, or broader?
- Do we want to keep the current `OSRM` public demo as fallback, or replace it with a private/self-hosted instance?
- Do we want to keep `OSRM` as fallback at all, or use `OTP` walking or a second dedicated walking provider instead?
- Do we want the weekday-09:00 reference to stay fixed, or make it configurable per deployment?

## Notes

- The public OSRM demo returned implausible walking durations for at least one Munich example: `Ehrenbreitsteiner Strasse 27 -> body + soul Center München Nord` showed about `2.4 min` for a roughly `1.26 km` walk.
- That failure was not just UI formatting. The upstream route response itself was bad enough to be rejected by the plausibility guard.
- The current walking guard rejects routes that imply unrealistic walking speed, then falls back to the next provider or to haversine.
- For a long-term setup, `Valhalla` is the better primary walking source than public OSRM because it is meant for pedestrian routing and is less dependent on the transit stack.
- `OTP` remains the best fit for schedule-aware public transport; using it for walking-only queries is possible, but it couples walking to a transit-focused system and is not the best primary design.
