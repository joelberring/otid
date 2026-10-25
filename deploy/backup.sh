#!/bin/sh
# Backup med pg_dump (ADR-0168, steg 6; steg 45: tätare på tävlingsdagen).
#
#   sh /backup.sh        tjänsten: en dump direkt vid start, sedan varje hel timme mellan BACKUP_FIRST_HOUR och
#                        BACKUP_LAST_HOUR (svensk tid med TZ=Europe/Stockholm, förval 08–23).
#   sh /backup.sh dump   en dump nu (till exempel före och efter ett arrangemang), sedan klart.
#
# Timdumparna hamnar i $BACKUP_DIR/hourly och de BACKUP_KEEP_HOURLY senaste (förval 48) sparas. Varje dag sparas
# dessutom dagens senaste dump i $BACKUP_DIR/daily, i BACKUP_KEEP_DAYS dagar (förval 14). En dump skrivs först till en
# dold fil och byter namn när pg_dump är klar, så en avbruten dump syns aldrig som en hel. Ett misslyckande loggas som
# "BACKUP MISSLYCKADES" och försöks igen nästa timme.
set -u
dir="${BACKUP_DIR:-/backups}"
keep_hourly="${BACKUP_KEEP_HOURLY:-48}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
first_hour="${BACKUP_FIRST_HOUR:-8}"
last_hour="${BACKUP_LAST_HOUR:-23}"
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

dump() {
  stamp=$(date +%Y-%m-%dT%H%M%S%z)
  name="otid-$stamp.dump"
  partial="$dir/hourly/.$name.partial"
  if pg_dump --format=custom --file="$partial"; then
    mv "$partial" "$dir/hourly/$name"
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
    return 0
  fi
  rm -f "$partial"
  echo "BACKUP MISSLYCKADES $(date +%FT%T%z)" >&2
  return 1
}

if [ "${1:-}" = "dump" ]; then
  dump
  exit $?
fi

dump || true
while true; do
  now=$(date +%s)
  # Nästa hela timme (svensk tid har hela timmars skillnad mot UTC).
  sleep $(( (now / 3600 + 1) * 3600 - now ))
  hour=$(date +%H | sed 's/^0//')
  if [ "${hour:-0}" -ge "$first_hour" ] && [ "${hour:-0}" -le "$last_hour" ]; then dump || true; fi
done
