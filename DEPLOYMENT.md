# Rokum Deployment

This guide deploys Rokum to a VPS behind a shared Traefik ingress. Hostnames,
usernames, email addresses, and credentials are deliberately not included in
this repository.

Before running commands from this guide, define the deployment values in your
current shell or load them from a private password manager. Do not commit them:

```bash
export VPS_HOST='<vps-hostname-or-ip>'
export VPS_USER='<ssh-deploy-user>'
export APP_DOMAIN='<application-domain>'
export DEPLOY_PATH='/opt/apps/rokum'
export TRAEFIK_PATH='/opt/traefik'
export ACME_EMAIL='<certificate-contact-email>'
export BASIC_AUTH_USER='<basic-auth-user>'
export SSH_TARGET="$VPS_USER@$VPS_HOST"
```

Load `BASIC_AUTH_PASSWORD` only when it is needed, preferably from a password
manager or an interactive prompt rather than shell history:

```bash
read -rsp 'Basic Auth password: ' BASIC_AUTH_PASSWORD
export BASIC_AUTH_PASSWORD
printf '\n'
```

The application lives under `$DEPLOY_PATH`. The shared Traefik ingress lives
under `$TRAEFIK_PATH` and owns ports 80 and 443, TLS certificates, HTTPS
routing, and HTTP Basic Auth.

## Production topology

```text
Internet
  -> DNS: $APP_DOMAIN
  -> VPS ports 80/443
  -> Traefik on external Docker network "proxy"
  -> Rokum container port 3000
  -> $DEPLOY_PATH/data on the host
```

The Bun port is never published on the host. Traefik is the only public entry
point. Basic Auth covers the UI, API, uploads, map proxy, and `/healthz`.

## Security model

The production configuration provides:

- HTTPS through Traefik and Let's Encrypt
- HTTP-to-HTTPS redirect for `$APP_DOMAIN`
- bcrypt-backed HTTP Basic Auth on every HTTPS request
- removal of the `Authorization` header before proxying to Bun
- HSTS, frame denial, MIME sniffing protection, and restrictive browser headers
- a non-root application process with all Linux capabilities dropped
- a read-only container filesystem except for `/data` and an in-memory `/tmp`
- no host port for the Bun process
- container health checks, bounded logs, and automatic restart
- a consistent SQLite backup before each update
- commit-SHA image tags and automatic rollback after a failed deployment

Important limitations:

- Basic Auth is a shared credential. It has no MFA, account lockout, or per-user
  audit trail. Use a long random password and rotate it if it is shared.
- The bcrypt hash is stored in a Docker label. Anyone with Docker API access can
  read it and attempt offline cracking. Docker access already grants effectively
  root-level control of this VPS.
- Traefik needs Docker API access to discover labeled containers. A read-only
  socket mount does not make the Docker API itself read-only. A Docker socket
  proxy is recommended if this VPS will host untrusted workloads or multiple
  administrators.
- Application rollback does not reverse database schema changes. The application
  currently uses backward-compatible inline migrations, but restore the SQLite
  backup if a future release introduces an incompatible migration.

## Prerequisites

### DNS and network

1. Create an `A` record for `$APP_DOMAIN` pointing to the VPS IPv4 address.
2. Create an `AAAA` record only if the VPS has working public IPv6.
3. Allow inbound TCP ports 22, 80, and 443 in the VPS firewall.
4. Do not expose port 3000.

Verify DNS before deploying:

```bash
dig +short "$APP_DOMAIN" A
```

### VPS software

The VPS needs:

- Docker Engine
- Docker Compose v2 with support for `--wait`
- `rsync`
- an SSH server
- the deploy user in the `docker` group

Verify the current host:

```bash
ssh "$SSH_TARGET" \
  'docker version && docker compose version && rsync --version && id'
```

Logging out and back in is required after adding a user to the `docker` group.

### Shared Traefik ingress

Create the shared network once:

```bash
ssh "$SSH_TARGET" \
  'docker network inspect proxy >/dev/null 2>&1 || docker network create proxy'
```

The Traefik stack in `$TRAEFIK_PATH/docker-compose.yaml` must provide:

- Docker provider enabled
- `exposedByDefault=false`
- entrypoints named `web` on port 80 and `websecure` on port 443
- an ACME resolver named `letsencrypt`
- the external Docker network named `proxy`
- persistent ACME storage at `$TRAEFIK_PATH/letsencrypt/acme.json`
- `restart: unless-stopped`

Minimum relevant configuration:

```yaml
services:
  traefik:
    image: traefik:v3
    container_name: traefik
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=proxy
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --ping=true
      - --accesslog=true
    ports:
      - 80:80
      - 443:443
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./letsencrypt:/letsencrypt
    networks:
      - proxy
    healthcheck:
      test: [CMD, traefik, healthcheck, --ping]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  proxy:
    external: true
```

Store the ACME contact email in Traefik's private `.env` file, then prepare ACME
storage and start Traefik:

```bash
printf 'ACME_EMAIL=%s\n' "$ACME_EMAIL" | \
  ssh "$SSH_TARGET" "umask 077; cat > '$TRAEFIK_PATH/.env'"

ssh "$SSH_TARGET" "TRAEFIK_PATH='$TRAEFIK_PATH' bash -s" <<'REMOTE'
set -euo pipefail
cd "$TRAEFIK_PATH"
mkdir -p letsencrypt
touch letsencrypt/acme.json
chmod 600 .env letsencrypt/acme.json
docker compose config --quiet
docker compose up -d
docker compose ps
REMOTE
```

Pin Traefik to a tested minor or digest during routine maintenance rather than
allowing an unattended major-version upgrade. The abbreviated `v3` tag above
matches the current server, but a tested immutable digest is safer.

## First-time application setup

Create the deployment and persistent-data directories:

```bash
ssh "$SSH_TARGET" \
  "mkdir -p '$DEPLOY_PATH/data/backups' && chmod 700 '$DEPLOY_PATH/data' '$DEPLOY_PATH/data/backups'"
```

The app container runs as UID/GID `1000:1000`. Make sure `$DEPLOY_PATH/data`
remains writable by UID 1000 or adjust the Compose `user` setting deliberately.

## GitHub Actions setup

The workflow deploys only after type checking, unit tests, and the browser smoke
test pass on `main`.

### Create a dedicated deploy key

Generate a key specifically for this repository. Do not reuse a personal SSH key:

```bash
ssh-keygen -t ed25519 -C rokum-github-actions -f ./rokum_deploy_key
```

Append `rokum_deploy_key.pub` to the deploy user's `~/.ssh/authorized_keys` on
the VPS. Store the private key as the GitHub secret `VPS_SSH_KEY`, then securely
remove the local private-key copy after confirming the workflow works.

### Record the trusted SSH host key

Do not trust an `ssh-keyscan` result without verification. From the VPS console,
obtain the authoritative fingerprint:

```bash
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

From a trusted workstation, collect the matching host-key line:

```bash
ssh-keyscan -H "$VPS_HOST"
```

Verify its fingerprint, then store the complete known-hosts line as the GitHub
secret `VPS_KNOWN_HOSTS`. The workflow fails closed if the host key changes.

### Configure the production environment

Create a GitHub Environment named `production`. Add protection rules if the
repository requires manual approval before production deployments.

Required environment secrets:

| Name | Value |
| --- | --- |
| `VPS_HOST` | VPS hostname or IP address |
| `VPS_USER` | Dedicated SSH deployment username |
| `VPS_SSH_KEY` | Dedicated private deploy key |
| `VPS_KNOWN_HOSTS` | Verified hashed known-hosts line |
| `APP_DOMAIN` | Public application hostname |
| `BASIC_AUTH_USER` | Basic Auth username |
| `BASIC_AUTH_PASSWORD` | Long random Basic Auth password |

Optional environment secrets:

| Name | Purpose |
| --- | --- |
| `JAWG_API` | Enables the vector map and Jawg address autocomplete |
| `TRANSIT_BASE_URL` | OpenTripPlanner-compatible `/plan` endpoint |

Optional environment variable:

| Name | Default | Allowed values |
| --- | --- | --- |
| `TRANSIT_MODE` | `heuristic` | `heuristic`, `otp1` |

The workflow hashes `BASIC_AUTH_PASSWORD` with bcrypt. The plaintext password is
never written to the VPS. The generated `.env` file is installed with mode 600.

## Automated deployment process

A push to `main` performs these steps:

1. Install dependencies with Bun.
2. Run `bunx tsc --noEmit` and `bun test`.
3. Install Chromium and run the browser smoke test.
4. Prepare a pinned SSH key and verified `known_hosts` file.
5. Generate a bcrypt Basic Auth hash and a production `.env` file.
6. Sync source files to `$DEPLOY_PATH`, preserving `.env` and `data/`.
7. Upload the new environment file with mode 600.
8. Create a consistent SQLite backup when an old container exists.
9. Build the image as `rokum:<git-commit-sha>`.
10. Start the stack and wait for its container health check.
11. Confirm unauthenticated HTTPS returns 401.
12. Confirm authenticated `/healthz` returns `ok`.
13. Restore the previous `.env` and image automatically if deployment fails.
14. Retain the five newest locally built Rokum images for manual rollback.

Deployments are not canceled midway by newer pushes. They queue behind the active
deployment to avoid leaving a partially synchronized working directory.

## Manual deployment

Automated deployment is preferred. For an emergency manual deployment, run from
the repository root on a trusted workstation.

Generate a production environment file without committing it:

```bash
cp .env.example .env
docker run --rm httpd:2.4-alpine \
  htpasswd -nbB "$BASIC_AUTH_USER" "$BASIC_AUTH_PASSWORD"
```

Put only the generated hash, without the `username:` prefix, in
`BASIC_AUTH_HASH`. Keep the hash inside single quotes exactly as shown in
`.env.example`; otherwise Compose interprets parts of the bcrypt dollar-sign
syntax as environment-variable references. Set `APP_DOMAIN` to your private
`$APP_DOMAIN` value and fill optional provider settings. Keep `.env` mode 600:

```bash
chmod 600 .env
```

Sync code while preserving production state:

```bash
rsync -az --delete \
  --exclude-from '.dockerignore' \
  --exclude '.env' \
  ./ "$SSH_TARGET:$DEPLOY_PATH/"

scp .env "$SSH_TARGET:$DEPLOY_PATH/.env.next"
```

Validate, back up, and deploy:

```bash
ssh "$SSH_TARGET" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" <<'REMOTE'
set -euo pipefail
cd "$DEPLOY_PATH"
chmod 600 .env.next
test ! -f .env || cp .env .env.rollback
if [ -n "$(docker compose -f docker-compose.prod.yml ps --status running -q app)" ]; then
  docker compose -f docker-compose.prod.yml exec -T app bun run backup:db
fi
mv .env.next .env
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d --build --remove-orphans --wait --wait-timeout 120
REMOTE
```

## Post-deployment verification

Run all of these checks after the first deployment and after ingress changes:

```bash
# HTTP redirects to HTTPS.
curl -I "http://$APP_DOMAIN/"

# HTTPS is protected without credentials.
curl -o /dev/null -sS -w '%{http_code}\n' "https://$APP_DOMAIN/healthz"

# Authenticated health check returns "ok".
curl --fail-with-body -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASSWORD" \
  "https://$APP_DOMAIN/healthz"

# App is healthy and attached only to the proxy network.
ssh "$SSH_TARGET" \
  "cd '$DEPLOY_PATH' && docker compose -f docker-compose.prod.yml ps"

# Only Traefik, not Bun, is listening publicly.
ssh "$SSH_TARGET" \
  'sudo ss -ltnp | grep -E ":(80|443|3000)\\b"'
```

Expected results:

- HTTP returns a permanent redirect to HTTPS.
- HTTPS without credentials returns 401.
- Authenticated `/healthz` returns `ok`.
- `docker compose ps` reports the app as healthy.
- ports 80 and 443 are public; port 3000 is absent from the host listener list.

Also inspect Traefik and app logs:

```bash
ssh "$SSH_TARGET" 'docker logs --tail 100 traefik'
ssh "$SSH_TARGET" \
  "cd '$DEPLOY_PATH' && docker compose -f docker-compose.prod.yml logs --tail 100 app"
```

## Routine operations

### Status and logs

```bash
ssh "$SSH_TARGET" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" <<'REMOTE'
cd "$DEPLOY_PATH"
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail 100 app
docker stats --no-stream
REMOTE
```

### Restart

```bash
ssh "$SSH_TARGET" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" <<'REMOTE'
cd "$DEPLOY_PATH"
docker compose -f docker-compose.prod.yml restart app
docker compose -f docker-compose.prod.yml ps
REMOTE
```

### Rotate Basic Auth credentials

Update the `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` secrets in the GitHub
`production` environment, then rerun the workflow by pushing a commit to `main`.
The next deployment replaces the bcrypt hash.

### Update Traefik

Update Traefik independently from Rokum:

```bash
ssh "$SSH_TARGET" "TRAEFIK_PATH='$TRAEFIK_PATH' bash -s" <<'REMOTE'
cd "$TRAEFIK_PATH"
docker compose pull
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120
docker compose ps
docker logs --tail 100 traefik
REMOTE
```

Review Traefik release and migration notes before changing minor or major versions.

## Backup and restore

The deploy workflow creates a SQLite backup in `data/backups/` before replacing
an existing release. Uploaded photos are not copied because they already live in
the same persistent `data/` directory. An off-host backup must include the entire
directory, not only SQLite.

Create an on-host SQLite backup:

```bash
ssh "$SSH_TARGET" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" <<'REMOTE'
cd "$DEPLOY_PATH"
docker compose -f docker-compose.prod.yml exec -T app bun run backup:db
ls -lh data/backups
REMOTE
```

Create an off-host backup:

```bash
rsync -a "$SSH_TARGET:$DEPLOY_PATH/data/" ./rokum-data-backup/
```

Restore a SQLite backup:

```bash
ssh "$SSH_TARGET" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" <<'REMOTE'
set -euo pipefail
cd "$DEPLOY_PATH"
docker compose -f docker-compose.prod.yml stop app
cp data/rokum.sqlite data/rokum.sqlite.before-restore
cp data/backups/rokum-YYYY-MM-DDTHH-MM-SS.sqlite data/rokum.sqlite
chown 1000:1000 data/rokum.sqlite
docker compose -f docker-compose.prod.yml up -d --wait --wait-timeout 120
REMOTE
```

Restore uploads by restoring the corresponding `data/uploads/` tree from the same
off-host backup generation.

## Manual rollback

List locally retained image versions:

```bash
ssh "$SSH_TARGET" \
  'docker images rokum --format "{{.Repository}}:{{.Tag}} {{.CreatedSince}}"'
```

Set `APP_VERSION` in `$DEPLOY_PATH/.env` to a previous commit SHA, then run:

```bash
ssh "$SSH_TARGET" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" <<'REMOTE'
cd "$DEPLOY_PATH"
docker compose -f docker-compose.prod.yml up -d --no-build --remove-orphans --wait --wait-timeout 120
REMOTE
```

If the prior image has been pruned, check out that commit locally and perform a
manual deployment with `APP_VERSION` set to its commit SHA. Restore the matching
database backup when the release included an incompatible migration.

## Troubleshooting

### Traefik returns 404

- Confirm the app container is running and attached to `proxy`.
- Confirm `APP_DOMAIN` exactly matches the requested hostname.
- Run `docker inspect rokum-app-1` and inspect its Traefik labels.
- Check `docker logs traefik` for router or middleware errors.

### Traefik returns 502 or 504

- Run `docker compose ps`; the app must be healthy.
- Read the app logs for startup, SQLite-permission, or provider errors.
- Confirm `traefik.http.services.rokum.loadbalancer.server.port=3000`.
- Confirm Traefik and the app share the `proxy` network.

### Basic Auth always rejects credentials

- Regenerate the hash with bcrypt via `htpasswd -nbB`.
- Put only the hash in `BASIC_AUTH_HASH`; do not include `username:` twice.
- Keep the hash single-quoted in `.env` so Compose preserves every dollar sign.
- Validate with `docker compose config` without pasting its output into tickets or
  chat, because rendered labels contain the password hash.
- Redeploy after changing GitHub secrets.

### App cannot write SQLite or uploads

The container runs as UID/GID 1000. Repair ownership and permissions:

```bash
ssh "$SSH_TARGET" \
  "sudo chown -R 1000:1000 '$DEPLOY_PATH/data' && sudo chmod 700 '$DEPLOY_PATH/data'"
```

### Certificate issuance fails

- Confirm DNS points to this VPS.
- Confirm ports 80 and 443 are reachable.
- Confirm `acme.json` exists and has mode 600.
- Check Traefik logs for Let's Encrypt rate-limit or challenge errors.
- Do not repeatedly delete `acme.json`; that can trigger certificate rate limits.
