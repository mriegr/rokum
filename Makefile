include .env
export

SSH := ssh $(VPS_USER)@$(VPS_HOST)
COMPOSE := docker compose -f docker-compose.prod.yml
LOCAL_REV := $(shell git rev-parse HEAD)
STYLE_URL := https://$(APP_DOMAIN)/api/map/style.json
AUTH_CURL := curl -fsS --max-time 20 -u "$$BASIC_AUTH_USER:$$BASIC_AUTH_PASS"

.PHONY: deploy verify-deploy status logs

deploy:
	git push origin main
	$(SSH) "cd $(DEPLOY_PATH) && git pull && $(COMPOSE) up -d --build --remove-orphans --wait --wait-timeout 120"
	$(MAKE) verify-deploy

verify-deploy:
	$(SSH) 'cd $(DEPLOY_PATH) && test "$$(git rev-parse HEAD)" = "$(LOCAL_REV)"'
	$(SSH) "cd $(DEPLOY_PATH) && $(COMPOSE) ps"
	$(AUTH_CURL) "$(STYLE_URL)" | python3 -c 'import json, sys; payload=json.load(sys.stdin); source=next(iter(payload.get("sources", {}).values()), {}); tile=(source.get("tiles") or [None])[0]; glyphs=payload.get("glyphs"); sprite=payload.get("sprite"); values=[("tile", tile), ("glyphs", glyphs), ("sprite", sprite)]; bad=[(name, value) for name, value in values if not (isinstance(value, str) and value.startswith("https://$(APP_DOMAIN)/api/map/"))]; \
if bad: raise SystemExit("invalid live map asset URLs: " + ", ".join(f"{name}={value}" for name, value in bad)); \
print("verified live style asset URLs"); \
print("tile:", tile); \
print("glyphs:", glyphs); \
print("sprite:", sprite)'

status:
	$(SSH) "cd $(DEPLOY_PATH) && $(COMPOSE) ps && echo && docker stats --no-stream --filter name=rokum"

logs:
	$(SSH) "cd $(DEPLOY_PATH) && $(COMPOSE) logs -f --tail 100 app"
