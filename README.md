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
CADDY_EMAIL=you@example.com
BASIC_AUTH_USER=rokum
BASIC_AUTH_HASH=replace-with-bcrypt-hash
```

`TRANSIT_MODE=otp1` and `TRANSIT_BASE_URL` can be used if you have an OpenTripPlanner-compatible `/plan` endpoint. Otherwise the app uses a transit-time heuristic based on distance and U-Bahn access.

Set `JAWG_API` to enable the vector map view. If it is missing, Rokum keeps the map tab visible but shows a disabled-state message instead of loading the basemap.

## Production deploy

Production runs in Docker Compose behind Caddy. Caddy terminates HTTPS and protects the whole site, including `/api/...`, with HTTP basic auth.

### What you need

- A VPS with Docker and Docker Compose installed
- A domain name pointing at that VPS
- Docker installed on your Mac, only for generating the auth hash
- GitHub repo access so you can add workflow secrets

### Create the bcrypt hash on Mac

Pick the username and password you want to use for the site, then run:

```bash
docker run --rm caddy:2.8.4-alpine caddy hash-password --plaintext 'your-password-here'
```

That prints a bcrypt hash. Put the username and that hash into your production env file or GitHub Secrets. Do not store the plaintext password in the repo.

### Deploy with GitHub Actions

1. Provision the VPS and make sure ports `80` and `443` are open.
2. Clone this repo on the VPS at the path you want to deploy from.
3. Create these GitHub Secrets in the repository:
   - `VPS_HOST`
   - `VPS_USER`
   - `VPS_SSH_KEY`
   - `VPS_PATH`
   - `APP_DOMAIN`
   - `CADDY_EMAIL`
   - `BASIC_AUTH_USER`
   - `BASIC_AUTH_PASSWORD`
4. Push to `main`. The workflow will:
   - run typecheck and tests
   - hash `BASIC_AUTH_PASSWORD`
   - write `.env` on the VPS
   - pull the latest code
   - run `docker compose -f docker-compose.prod.yml up -d --build --remove-orphans`

### Deploy manually

If you do not want GitHub Actions to write the env file, copy `.env.example` to `.env` on the VPS and fill in the production values, including `BASIC_AUTH_HASH`.

Then start the stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

For manual updates, run the same command after pulling the latest code.

## Backup

Create a consistent SQLite backup with:

```bash
bun run backup:db
```

It writes a timestamped snapshot under `data/backups/` by default.
To restore, stop the stack and replace `data/rokum.sqlite` with the chosen backup file.

## Test

```bash
bun test
bun run test:browser
```
