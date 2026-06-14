include .env
export

SSH := ssh $(VPS_USER)@$(VPS_HOST)
COMPOSE := docker compose -f docker-compose.prod.yml

.PHONY: deploy status logs

deploy:
	git push origin main
	$(SSH) "cd $(DEPLOY_PATH) && git pull && $(COMPOSE) up -d --build --remove-orphans --wait --wait-timeout 120"

status:
	$(SSH) "cd $(DEPLOY_PATH) && $(COMPOSE) ps && echo && docker stats --no-stream --filter name=rokum"

logs:
	$(SSH) "cd $(DEPLOY_PATH) && $(COMPOSE) logs -f --tail 100 app"
