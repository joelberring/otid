#!/bin/sh
# Uppdateringen i ett kommando (PLAN.md steg M5): hämtar repot och avbildningarna, startar om det som ändrats och städar
# gamla docker-avbildningar efteråt. Körs på servern, som den som äger repot:
#
#   sh deploy/update.sh              uppdatera (git pull, pull, up -d, Caddy vid ändrad Caddyfile, städning)
#   sh deploy/update.sh prune        bara städningen (t.ex. när disklarmet kommer)
#
# Städningen görs här, av den som kör uppdateringen, och inte av en tjänst i compose: en behållare som ska radera avbildningar
# måste ha Docker-uttaget (/var/run/docker.sock), och det är i praktiken root på servern. Ingen av O-Tids tjänster har det,
# och ingen ska få det för en städning som ändå bara behövs efter en uppdatering.
#
# Städningen tar bara avbildningar som ingen behållare använder och som är äldre än OTID_PRUNE_HOURS (förval 72, tre dygn,
# så att en tillbakagång till förra versionen går utan ny nedladdning), och byggcachen. Körande behållares avbildningar rörs aldrig.
# Ingen driftsättning på en tävlingsdag (AGENTS.md, ADR-0178).
set -eu
cd "$(dirname "$0")/.."
compose="docker compose -f ${COMPOSE_FILE:-docker-compose.prod.yml}"
hours="${OTID_PRUNE_HOURS:-72}"
case "$hours" in ''|*[!0-9]*) hours=72 ;; esac

prune() {
  echo "Städar docker-avbildningar äldre än ${hours} timmar som ingen behållare använder ..."
  docker image prune -af --filter "until=${hours}h"
  docker builder prune -f --filter "until=${hours}h"
  df -h / | tail -n 1
}

if [ "${1:-}" = "prune" ]; then
  prune
  exit 0
fi

before=$(git rev-parse HEAD)
git pull --ff-only
$compose pull
$compose up -d
# up -d startar inte om Caddy när bara Caddyfile ändrats (filen är monterad som en enskild fil, docs/drift.md, Uppdatera).
if ! git diff --quiet "$before" HEAD -- deploy/Caddyfile; then
  echo "deploy/Caddyfile har ändrats: startar om Caddy."
  $compose restart caddy
fi
$compose ps
prune
