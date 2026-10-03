#!/bin/sh
# Nattlig backup med pg_dump (ADR-0168, steg 6). Tar en dump direkt vid start
# och sedan varje natt kl. BACKUP_HOUR_UTC. Dumpar äldre än BACKUP_KEEP_DAYS tas bort.
# Ett misslyckande loggas och försöks igen nästa natt; ofullständiga filer sparas inte.
set -u
dir="${BACKUP_DIR:-/backups}"
keep="${BACKUP_KEEP_DAYS:-14}"
hour="${BACKUP_HOUR_UTC:-2}"
mkdir -p "$dir"

dump() {
  name="otid-$(date -u +%Y-%m-%dT%H%MZ).dump"
  if pg_dump --format=custom --file="$dir/.$name.partial"; then
    mv "$dir/.$name.partial" "$dir/$name"
    echo "Backup klar: $name"
  else
    rm -f "$dir/.$name.partial"
    echo "BACKUP MISSLYCKADES $(date -u +%FT%TZ)" >&2
  fi
  find "$dir" -name 'otid-*.dump' -type f -mtime +"$((keep - 1))" -print -delete
}

dump
while true; do
  now=$(date -u +%s)
  next=$(( (now / 86400) * 86400 + hour * 3600 ))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  dump
done
