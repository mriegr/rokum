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
- Compare listings in a list view and inspect one apartment at a time in a map view

## Environment

Optional environment variables:

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
```

`TRANSIT_MODE=otp1` and `TRANSIT_BASE_URL` can be used if you have an OpenTripPlanner-compatible `/plan` endpoint. Otherwise the app uses a transit-time heuristic based on distance and U-Bahn access.

## Test

```bash
bun test
```

## Docker

```bash
docker compose up --build
```

Data is stored in `./data`.
