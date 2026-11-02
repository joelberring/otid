#!/bin/sh
# Backup med pg_dump (ADR-0168, steg 6; steg 45; ADR-0186: dygnet runt, före migrering, kopia utanför servern, bevakning).
#
#   sh /backup.sh                 tjänsten: en dump direkt vid start, sedan var BACKUP_INTERVAL_MINUTES:e minut (förval 60,
#                                 på hela timmen) dygnet runt.
#   sh /backup.sh dump            en dump nu (till exempel före och efter ett arrangemang), sedan klart.
#   sh /backup.sh dump <namn>     en dump nu i $BACKUP_DIR/<namn>/ (tjänsten backup-before-migrate: "fore-migrering"), de 10
#                                 senaste sparas.
#
# Timdumparna hamnar i $BACKUP_DIR/hourly och de BACKUP_KEEP_HOURLY senaste (förval 48) sparas. Varje dag sparas
# dessutom dagens senaste dump i $BACKUP_DIR/daily, i BACKUP_KEEP_DAYS dagar (förval 14). En dump skrivs först till en
# dold fil och byter namn när pg_dump är klar, så en avbruten dump syns aldrig som en hel. Ett misslyckande loggas som
# "BACKUP MISSLYCKADES" och försöks igen nästa gång.
#
# Kopia utanför servern (valfri): med RESTIC_REPOSITORY och RESTIC_PASSWORD skickas hela $BACKUP_DIR krypterat med restic
# efter varje dump (bara det som är nytt går över nätet) och gamla ögonblicksbilder gallras en gång per dygn. Utan dem
# fungerar allt som förut. Bevakning (valfri): OTID_HEARTBEAT_BACKUP_URL pingas efter en lyckad backup och med /fail när
# något misslyckades (t.ex. healthchecks.io).
set -u
dir="${BACKUP_DIR:-/backups}"
keep_hourly="${BACKUP_KEEP_HOURLY:-48}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
interval="${BACKUP_INTERVAL_MINUTES:-60}"
case "$interval" in ''|*[!0-9]*) interval=60 ;; esac
[ "$interval" -ge 5 ] || interval=5
mkdir -p "$dir/hourly" "$dir/daily"

# Behåller de N nyaste filerna (namnen sorteras som tid) som matchar mönstret i katalogen.
prune() {
  folder="$1"; pattern="$2"; keep="$3"
  count=$(find "$folder" -maxdepth 1 -type f -name "$pattern" | wc -l)
  excess=$((count - keep))
  [ "$excess" -gt 0 ] || return 0
  find "$folder" -maxdepth 1 -type f -name "$pattern" | sort | head -n "$excess" | while read -r old; do
    rm -f "$old" && echo "Borttagen: $(basename "$old")"
  done
}

# Bevakningens ping: "ok" eller "fail" med en kort text (aldrig lösenord eller personuppgifter).
heartbeat() {
  url="${OTID_HEARTBEAT_BACKUP_URL:-}"
  [ -n "$url" ] || return 0
  command -v curl >/dev/null 2>&1 || { echo "Bevakningen kräver curl (avbildningen otid-backup)." >&2; return 0; }
  if [ "$1" = "ok" ]; then
    curl -fsS -m 10 --retry 3 -o /dev/null "$url" || echo "Bevakningens ping misslyckades." >&2
  else
    curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$2" "$url/fail" || echo "Bevakningens ping misslyckades." >&2
  fi
}

# Krypterad kopia utanför servern med restic. Skapar förrådet första gången och gallrar en gång per dygn.
offsite() {
  [ -n "${RESTIC_REPOSITORY:-}" ] || return 0
  if [ -z "${RESTIC_PASSWORD:-}" ]; then
    echo "KOPIA MISSLYCKADES: RESTIC_PASSWORD saknas (krypteringens lösenord)." >&2
    return 1
  fi
  command -v restic >/dev/null 2>&1 || { echo "KOPIA MISSLYCKADES: restic saknas i avbildningen." >&2; return 1; }
  if ! restic cat config >/dev/null 2>&1; then
    restic init >/dev/null || { echo "KOPIA MISSLYCKADES: förrådet kunde inte skapas eller nås." >&2; return 1; }
    echo "Förrådet för kopian skapat."
  fi
  if ! restic backup --quiet --host otid --tag otid --exclude '.*.partial' "$dir"; then
    echo "KOPIA MISSLYCKADES $(date +%FT%T%z)" >&2
    return 1
  fi
  echo "Kopia klar (restic)."
  today=$(date +%Y-%m-%d)
  if [ "$(cat "$dir/.restic-gallrad" 2>/dev/null)" != "$today" ]; then
    if restic forget --quiet --host otid --tag otid --keep-hourly 48 --keep-daily 30 --keep-monthly 12 --prune; then
      echo "$today" > "$dir/.restic-gallrad"
    else
      echo "Gallringen av kopian misslyckades; försöker igen nästa gång." >&2
    fi
  fi
}

dump() {
  label="${1:-}"
  stamp=$(date +%Y-%m-%dT%H%M%S%z)
  name="otid-$stamp.dump"
  target="$dir/hourly"
  [ -n "$label" ] && { target="$dir/$label"; mkdir -p "$target"; }
  partial="$target/.$name.partial"
  # Steg 65: utskriftsjobbens PDF:er tas inte med (de kan skapas igen och skulle göra varje dump stor); tabellen gör det.
  if ! pg_dump --format=custom --exclude-table-data=course_setting_print_job --file="$partial"; then
    rm -f "$partial"
    echo "BACKUP MISSLYCKADES $(date +%FT%T%z)" >&2
    heartbeat fail "pg_dump misslyckades $(date +%FT%T%z)"
    return 1
  fi
  mv "$partial" "$target/$name"
  if [ -n "$label" ]; then
    echo "Backup klar: $label/$name"
    prune "$target" 'otid-*.dump' 10
  else
    echo "Backup klar: hourly/$name"
    # Dagens senaste dump som dagsbackup: en hård länk (ingen kopia av datan), bytt atomärt.
    day="otid-$(date +%Y-%m-%d).dump"
    if ln -f "$dir/hourly/$name" "$dir/daily/.$day.partial" 2>/dev/null || cp "$dir/hourly/$name" "$dir/daily/.$day.partial"; then
      mv -f "$dir/daily/.$day.partial" "$dir/daily/$day"
    else
      echo "BACKUP MISSLYCKADES (dagsbackup) $(date +%FT%T%z)" >&2
    fi
    prune "$dir/hourly" 'otid-*.dump' "$keep_hourly"
    prune "$dir/daily" 'otid-*.dump' "$keep_days"
  fi
  if ! offsite; then
    heartbeat fail "Kopian utanför servern misslyckades $(date +%FT%T%z)"
    return 0
  fi
  heartbeat ok
  return 0
}

if [ "${1:-}" = "dump" ]; then
  dump "${2:-}"
  exit $?
fi

dump || true
while true; do
  now=$(date +%s)
  step=$((interval * 60))
  # Nästa jämna intervall (60 = varje hel timme; svensk tid har hela timmars skillnad mot UTC).
  sleep $(( (now / step + 1) * step - now ))
  dump || true
done
