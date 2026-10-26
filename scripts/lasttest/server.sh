#!/bin/sh
# Lasttestets server (PLAN.md steg 51, docs/lasttest.md): produktionsbygget och PostgreSQL 17 med samma resurser som en
# Hetzner CX23 (2 vCPU, 4 GB) tillsammans.
#
#   scripts/lasttest/server.sh docker   # postgres:17 och otid-web i Docker, --cpus 2 och --memory 4g var (som compose)
#   scripts/lasttest/server.sh cgroup   # utan Docker-bilder: lokala binärer i en gemensam cgroup (2 kärnor, 4 GB)
#   scripts/lasttest/server.sh stop
#
# Docker-läget är inte provat i lasttestets miljö (bilderna gick inte att hämta där); mät då med `docker stats`.
# cgroup-läget (Linux, root, cgroup v1) kräver PG_BIN (katalog med postgres och initdb för PostgreSQL 17) och ett
# färdigt produktionsbygge (pnpm --filter @o-tid/web build). Web och databas delar maskinens kärnor (kör på en maskin med 2) och 4 GB, som på servern.
# Mätningen läser cgroup-vägarna otid/web och otid/db (load.ts --cgroups web=otid/web,db=otid/db). Webben och databasen
# får högre CPU-vikt än resten av maskinen (cpu.shares), så att andra processer inte stjäl av de 2 kärnorna.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DATA=${LASTTEST_DATA:-/var/tmp/otid-lasttest}
PORT=${LASTTEST_WEB_PORT:-3000}
DB_PORT=${LASTTEST_DB_PORT:-5440}
ORIGIN=${LASTTEST_ORIGIN:-https://otid.lasttest}
DB_NAME=${LASTTEST_DB:-otid}
PGDIR=${LASTTEST_PGDATA:-$DATA/pg}
DB_URL="postgresql://otid@127.0.0.1:$DB_PORT/$DB_NAME"
mode=${1:-}

cgroup_create() {
  for controller in cpu cpuacct memory; do
    mkdir -p "/sys/fs/cgroup/$controller/otid/web" "/sys/fs/cgroup/$controller/otid/db" "/sys/fs/cgroup/$controller/otid/public"
  done
  # Steg 54: samma vikter och minnestak som docker-compose.prod.yml (cpu_shares 1024/1024/256, mem_limit).
  echo 1024 > /sys/fs/cgroup/cpu/otid/db/cpu.shares
  echo 1024 > /sys/fs/cgroup/cpu/otid/web/cpu.shares
  echo 512 > /sys/fs/cgroup/cpu/otid/public/cpu.shares   # två instanser med 256 var
  echo $((1024 * 1024 * 1024)) > /sys/fs/cgroup/memory/otid/db/memory.limit_in_bytes
  echo $((1024 * 1024 * 1024)) > /sys/fs/cgroup/memory/otid/web/memory.limit_in_bytes
  echo $((1536 * 1024 * 1024)) > /sys/fs/cgroup/memory/otid/public/memory.limit_in_bytes
  # Steg 54: ingen kvot. På en maskin med 2 kärnor (som CX23, där compose inte sätter --cpus) är kärnorna gränsen; en
  # kvot på gruppen stoppar annars också web när publiken har använt upp den (steg 51 hade 2 kärnor i kvot).
  echo -1 > /sys/fs/cgroup/cpu/otid/cpu.cfs_quota_us
  echo 4096 > /sys/fs/cgroup/cpu/otid/cpu.shares
  echo $((4 * 1024 * 1024 * 1024)) > /sys/fs/cgroup/memory/otid/memory.limit_in_bytes
}

# Kommandot efter `sh -c "$IN_CGROUP" sh <grupp> …` startar i cgroupen web eller db. (Ett vanligt kommando i bakgrunden,
# inte en skalfunktion: då ärver processen inte skalets sparade fildeskriptorer och håller inte terminalen öppen.)
IN_CGROUP='group=$1; shift; for c in cpu cpuacct memory; do echo $$ > /sys/fs/cgroup/$c/otid/$group/cgroup.procs; done; exec "$@"'


case "$mode" in
  cgroup)
    : "${PG_BIN:?Sätt PG_BIN till katalogen med PostgreSQL 17 (postgres, initdb, pg_ctl)}"
    cgroup_create
    mkdir -p "$DATA"
    if [ ! -d "$PGDIR" ]; then
      mkdir -p "$PGDIR" && chown postgres "$PGDIR"
      su postgres -s /bin/sh -c "$PG_BIN/initdb -D $PGDIR -U otid --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null"
    fi
    # Samma inställningar som bilden postgres:17 (standardvärden), lyssnar bara lokalt.
    sh -c "$IN_CGROUP" sh db su postgres -s /bin/sh -c "exec $PG_BIN/postgres -D $PGDIR -p $DB_PORT -k /tmp -c listen_addresses=127.0.0.1" \
      > "$DATA/postgres.log" 2>&1 &
    for _ in $(seq 1 30); do
      if psql -h 127.0.0.1 -p "$DB_PORT" -U otid -d postgres -tAc "select 1" >/dev/null 2>&1; then break; fi
      sleep 1
    done
    psql -h 127.0.0.1 -p "$DB_PORT" -U otid -d postgres -tAc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1 ||
      psql -h 127.0.0.1 -p "$DB_PORT" -U otid -d postgres -c "create database $DB_NAME" >/dev/null
    # Produktionsbygget som i Dockerfile: standalone med statiska filer bredvid.
    # LASTTEST_STANDALONE = ett sparat bygge (t.ex. före en ändring, för jämförelse), med statiska filer och migrate.mjs bredvid.
    STANDALONE=${LASTTEST_STANDALONE:-$ROOT/apps/web/.next/standalone}
    if [ -z "${LASTTEST_STANDALONE:-}" ]; then
      cp -r "$ROOT/apps/web/.next/static" "$STANDALONE/apps/web/.next/"
      cp -r "$ROOT/apps/web/public" "$STANDALONE/apps/web/"
      cp "$ROOT/apps/web/.next/migrate.mjs" "$STANDALONE/../migrate.mjs"
    fi
    DATABASE_URL=$DB_URL MIGRATIONS_DIR="$ROOT/packages/database/migrations" node "$STANDALONE/../migrate.mjs" > "$DATA/migrate.log" 2>&1
    # Steg 54 (förval, som docker-compose.prod.yml): web (tävlingen, cgroup otid/web) på porten och web-public och
    # web-public2 (publiken, otid/public, lägre CPU-vikt) på porten + 1 och + 2. Lastgeneratorn delar upp som Caddy:
    #   --base http://127.0.0.1:3000 --public-base http://127.0.0.1:3001,http://127.0.0.1:3002
    #   --cgroups web=otid/web,public=otid/public,db=otid/db
    # LASTTEST_ROLES=off: som steg 51, LASTTEST_INSTANCES likadana instanser (port, port + 1, …) i otid/web.
    if [ "${LASTTEST_ROLES:-on}" = "off" ]; then
      for instance in $(seq 1 "${LASTTEST_INSTANCES:-1}"); do
        (cd "$STANDALONE" && sh -c "$IN_CGROUP" sh web env NODE_ENV=production PORT=$((PORT + instance - 1)) HOSTNAME=127.0.0.1 NEXT_TELEMETRY_DISABLED=1 \
          DATABASE_URL="$DB_URL" O_TID_PUBLIC_ORIGIN="$ORIGIN" OTID_RADIO_POLLER=off node apps/web/server.js > "$DATA/web$instance.log" 2>&1 &)
      done
    else
      (cd "$STANDALONE" && sh -c "$IN_CGROUP" sh web env NODE_ENV=production PORT=$PORT HOSTNAME=127.0.0.1 NEXT_TELEMETRY_DISABLED=1 \
        DATABASE_URL="$DB_URL" O_TID_PUBLIC_ORIGIN="$ORIGIN" OTID_RADIO_POLLER=off OTID_INSTANCE_ROLE=competition \
        NODE_OPTIONS=--max-old-space-size=768 node apps/web/server.js > "$DATA/web1.log" 2>&1 &)
      for instance in 1 2; do
        (cd "$STANDALONE" && sh -c "$IN_CGROUP" sh public env NODE_ENV=production PORT=$((PORT + instance)) HOSTNAME=127.0.0.1 \
          NEXT_TELEMETRY_DISABLED=1 DATABASE_URL="$DB_URL" O_TID_PUBLIC_ORIGIN="$ORIGIN" OTID_RADIO_POLLER=off OTID_INSTANCE_ROLE=public \
          NODE_OPTIONS=--max-old-space-size=512 node apps/web/server.js > "$DATA/public$instance.log" 2>&1 &)
      done
    fi
    for _ in $(seq 1 60); do
      if curl -fsS "http://127.0.0.1:$PORT/organizer" >/dev/null 2>&1; then break; fi
      sleep 1
    done
    echo "Webben: http://127.0.0.1:$PORT (Origin $ORIGIN), databasen: $DB_URL"
    ;;
  docker)
    docker build -t otid-web "$ROOT"
    docker network create otid-lasttest >/dev/null 2>&1 || true
    docker run -d --name otid-lasttest-db --network otid-lasttest --cpus 2 --memory 4g -e POSTGRES_USER=otid \
      -e POSTGRES_PASSWORD=otid -e POSTGRES_DB=otid -p "127.0.0.1:$DB_PORT:5432" postgres:17
    sleep 5
    docker run -d --name otid-lasttest-web --network otid-lasttest --cpus 2 --memory 4g -p "127.0.0.1:$PORT:3000" \
      -e DATABASE_URL=postgresql://otid:otid@otid-lasttest-db:5432/otid -e O_TID_PUBLIC_ORIGIN="$ORIGIN" -e OTID_RADIO_POLLER=off otid-web
    echo "Webben: http://127.0.0.1:$PORT (Origin $ORIGIN), databasen: postgresql://otid:otid@127.0.0.1:$DB_PORT/otid"
    echo "Resurser: docker stats otid-lasttest-web otid-lasttest-db (eller --cgroups med containrarnas cgroup-vägar)"
    ;;
  stop)
    docker rm -f otid-lasttest-web otid-lasttest-db >/dev/null 2>&1 || true
    # Bara lasttestets egna processer (cgroupen otid/web), aldrig andra Next-servrar på maskinen.
    for group in web public; do
      [ -f /sys/fs/cgroup/cpuacct/otid/$group/cgroup.procs ] && xargs -r kill < /sys/fs/cgroup/cpuacct/otid/$group/cgroup.procs || true
    done
    [ -n "${PG_BIN:-}" ] && [ -d "$PGDIR" ] && su postgres -s /bin/sh -c "$PG_BIN/pg_ctl -D $PGDIR stop -m fast" || true
    ;;
  *)
    echo "Användning: $0 cgroup|docker|stop" >&2
    exit 2
    ;;
esac
