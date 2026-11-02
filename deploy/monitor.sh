#!/bin/sh
# Hälsokontrollen (ADR-0186): tjänsten monitor i docker-compose.prod.yml. Var OTID_HEALTH_INTERVAL_MINUTES:e minut (förval 15):
#   - webben och databasen: http://web:3000/api/health (frågar databasen och utskriftskön),
#   - publikens instanser: /om på web-public och web-public2,
#   - utskriftskön: inget jobb får vänta längre än 15 minuter (då står utskriftsarbetaren still),
#   - disken: larm när filsystemet med ./backups är fullare än OTID_DISK_ALERT_PERCENT (förval 80 %),
#   - backupen: den senaste dumpen i ./backups/hourly får inte vara äldre än två intervall.
# När allt är bra pingas OTID_HEARTBEAT_HEALTH_URL; annars pingas .../fail med vad som är fel. Uteblir pingarna (servern eller
# tjänsten är nere) larmar bevakningstjänsten själv. Loggen (`logs monitor`) säger alltid vad som kontrollerades.
#
#   sh /monitor.sh          tjänsten (kör tills den stoppas)
#   sh /monitor.sh once     en kontroll nu, sedan klart (avslutas med fel om något är fel)
set -u
dir="${BACKUP_DIR:-/backups}"
interval="${OTID_HEALTH_INTERVAL_MINUTES:-15}"
case "$interval" in ''|*[!0-9]*) interval=15 ;; esac
[ "$interval" -ge 1 ] || interval=1
disk_limit="${OTID_DISK_ALERT_PERCENT:-80}"
backup_interval="${BACKUP_INTERVAL_MINUTES:-60}"
case "$backup_interval" in ''|*[!0-9]*) backup_interval=60 ;; esac
web="${OTID_MONITOR_WEB:-http://web:3000}"
publics="${OTID_MONITOR_PUBLIC:-http://web-public:3000 http://web-public2:3000}"

check() {
  problems=""
  add() { problems="${problems}${problems:+; }$1"; }
  health=$(curl -fsS -m 10 "$web/api/health" 2>/dev/null) || { add "webben eller databasen svarar inte ($web/api/health)"; health=""; }
  if [ -n "$health" ]; then
    case "$health" in *'"database":true'*) ;; *) add "webben når inte databasen" ;; esac
    waiting=$(printf '%s' "$health" | sed -n 's/.*"oldestQueuedSeconds":\([0-9]*\).*/\1/p')
    if [ -n "$waiting" ] && [ "$waiting" -gt 900 ]; then add "ett utskriftsjobb har väntat $((waiting / 60)) min (står utskriftsarbetaren still?)"; fi
  fi
  for base in $publics; do
    curl -fsS -m 10 -o /dev/null "$base/om" 2>/dev/null || add "publikens instans svarar inte ($base)"
  done
  used=$(df -P "$dir" 2>/dev/null | awk 'NR==2 { gsub("%", "", $5); print $5 }')
  if [ -z "$used" ]; then add "diskens fyllnadsgrad kunde inte läsas"
  elif [ "$used" -gt "$disk_limit" ]; then add "disken är ${used} % full (gräns ${disk_limit} %)"; fi
  newest=$(find "$dir/hourly" -maxdepth 1 -type f -name 'otid-*.dump' -exec stat -c %Y {} \; 2>/dev/null | sort -n | tail -n 1)
  if [ -z "$newest" ]; then add "ingen dump i $dir/hourly"
  else
    age=$(( $(date +%s) - newest ))
    if [ "$age" -gt $((backup_interval * 120 + 600)) ]; then add "senaste dumpen är $((age / 60)) min gammal"; fi
  fi
  if [ -z "$problems" ]; then
    echo "Hälsokontroll ok $(date +%FT%T%z): webben, databasen, publiken, utskriftskön, disken ${used:-?} %, backupen."
    [ -n "${OTID_HEARTBEAT_HEALTH_URL:-}" ] && { curl -fsS -m 10 --retry 3 -o /dev/null "$OTID_HEARTBEAT_HEALTH_URL" || echo "Bevakningens ping misslyckades." >&2; }
    return 0
  fi
  echo "HÄLSOKONTROLL MISSLYCKADES $(date +%FT%T%z): $problems" >&2
  [ -n "${OTID_HEARTBEAT_HEALTH_URL:-}" ] && { curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$problems" "$OTID_HEARTBEAT_HEALTH_URL/fail" || echo "Bevakningens ping misslyckades." >&2; }
  return 1
}

if [ "${1:-}" = "once" ]; then
  check
  exit $?
fi

# Webben och backupen får starta först.
sleep 60
while true; do
  check || true
  sleep $((interval * 60))
done
