# Rokum

Slim Bun app for saving Munich apartment listings, uploading photos, and comparing them with automatic neighborhood and transit scoring.

## Run locally

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

## What it does

- Save apartment listings with address, area, rooms, rent, floor, description, and photos
- Compute total score from price per square meter, room count, walking convenience, and public-transport travel time
- Track reusable custom places such as work and include them in apartment scoring
- Compare listings in a list view, inspect apartments on the map, or search any Munich address with autocomplete

## Environment

Optional runtime variables:

```bash
PORT=3000
CITY=Munich
DATA_DIR=./data
DB_PATH=./data/rokum.sqlite
UPLOAD_DIR=./data/uploads
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
OVERPASS_BASE_URL=https://overpass-api.de/api/interpreter
WALKING_ROUTER_BASE_URL=https://router.project-osrm.org
TRANSIT_MODE=heuristic
TRANSIT_BASE_URL=
JAWG_API=
JAWG_STYLE_ID=jawg-streets
```

For production deploys, the Docker Compose stack also expects:

```bash
APP_DOMAIN=rokum.example.com
BASIC_AUTH_USER=rokum
BASIC_AUTH_HASH='replace-with-bcrypt-hash'
```

`TRANSIT_MODE=otp1` and `TRANSIT_BASE_URL` can be used if you have an OpenTripPlanner-compatible `/plan` endpoint. Otherwise the app uses a transit-time heuristic based on distance and U-Bahn access.

Set `JAWG_API` to enable the vector map view and its Jawg Places address autocomplete. If it is missing, Rokum keeps the map tab visible but shows a disabled-state message instead of loading map services.

## Production deploy

Production runs as an app stack behind an existing Traefik ingress. Traefik terminates HTTPS and protects the whole site, including `/api/...`, with HTTP basic auth.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for the complete VPS prerequisites, Traefik setup, GitHub secrets, automated and manual deployment flows, security model, verification, backup/restore, rollback, and troubleshooting procedures.

## Backup

Create a consistent SQLite backup with:

```bash
bun run backup:db
```

It writes a timestamped snapshot under `data/backups/` by default.
To restore, stop the stack and replace `data/rokum.sqlite` with the chosen backup file.
Production backup and restore procedures are documented in [DEPLOYMENT.md](./DEPLOYMENT.md#backup-and-restore).

## Test

```bash
bun test
bun run test:browser
```
