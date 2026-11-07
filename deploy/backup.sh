#!/bin/sh
# Backup med pg_dump (ADR-0168, steg 6; steg 45; ADR-0186: dygnet runt, före migrering, kopia utanför servern, bevakning).
#
#   sh /backup.sh                 tjänsten: en dump direkt vid start, sedan var BACKUP_INTERVAL_MINUTES:e minut (förval 60,
#                                 på hela timmen) dygnet runt.
#   sh /backup.sh dump            en dump nu (till exempel före och efter ett arrangemang), sedan klart.
#   sh /backup.sh dump <namn>     en dump nu i $BACKUP_DIR/<namn>/ (tjänsten backup-before-migrate: "fore-migrering"), de 10
#                                 senaste sparas.
#   sh /backup.sh restore-map-content
#                                 efter en pg_restore: läser in kartinnehållet ur $BACKUP_DIR/map-content (se nedan).
#
# Timdumparna hamnar i $BACKUP_DIR/hourly och de BACKUP_KEEP_HOURLY senaste (förval 24, ADR-0216; tidigare 48) sparas. Varje dag sparas
# dessutom dagens senaste dump i $BACKUP_DIR/daily, i BACKUP_KEEP_DAYS dagar (förval 14). En dump skrivs först till en
# dold fil och byter namn när pg_dump är klar, så en avbruten dump syns aldrig som en hel. Ett misslyckande loggas som
# "BACKUP MISSLYCKADES" och försöks igen nästa gång.
#
# Kopia utanför servern (valfri): med RESTIC_REPOSITORY och RESTIC_PASSWORD skickas hela $BACKUP_DIR krypterat med restic
# efter varje dump (bara det som är nytt går över nätet) och gamla ögonblicksbilder gallras en gång per dygn. Utan dem
# fungerar allt som förut. Bevakning (valfri): OTID_HEARTBEAT_BACKUP_URL pingas efter en lyckad backup och med /fail när
# något misslyckades (t.ex. healthchecks.io).
#
# ADR-0216: kartinnehållet (map_content_part, kartfilerna och kartbilderna) ändras aldrig och är adresserat (content_id), så det
# sparas EN gång per innehåll i $BACKUP_DIR/map-content/<content_id>.copy (PostgreSQL:s binära COPY) i stället för i varje dump.
# Bredvid varje dump står <dump>.contents med innehållen som dumpen pekar på; en fil tas bort först när ingen sparad dump och
# inte databasen pekar på den. Saknas en fil för något innehåll i dumpen (det skapades och togs bort under dumpen) tas dumpen om
# med kartinnehållet i, så varje dump går alltid att återställa. Data som går att skapa igen tas inte med: utskriftsjobbens PDF:er
# (steg 65) och klubbarkivets miniatyrer och kartkontroller (ADR-0196; ritas om i administratörens webbläsare när de saknas).
# Efter varje körning skrivs `<epok>\t<ok|fail>\t<text>` i $BACKUP_DIR/.backup-status (webbens serverbevakning läser den).
set -u
dir="${BACKUP_DIR:-/backups}"
keep_hourly="${BACKUP_KEEP_HOURLY:-24}"
keep_days="${BACKUP_KEEP_DAYS:-14}"
interval="${BACKUP_INTERVAL_MINUTES:-60}"
case "$interval" in ''|*[!0-9]*) interval=60 ;; esac
[ "$interval" -ge 5 ] || interval=5
mkdir -p "$dir/hourly" "$dir/daily" "$dir/map-content"

# Behåller de N nyaste filerna (namnen sorteras som tid) som matchar mönstret i katalogen.
prune() {
  folder="$1"; pattern="$2"; keep="$3"
  count=$(find "$folder" -maxdepth 1 -type f -name "$pattern" | wc -l)
  excess=$((count - keep))
  [ "$excess" -gt 0 ] || return 0
  find "$folder" -maxdepth 1 -type f -name "$pattern" | sort | head -n "$excess" | while read -r old; do
    rm -f "$old" "$old.contents" && echo "Borttagen: $(basename "$old")"
  done
}

# Webbens serverbevakning (ADR-0216): resultatet av senaste körningen.
status() {
  printf '%s\t%s\t%s\n' "$(date +%s)" "$1" "$(printf '%s' "${2:-}" | tr '\t\n' '  ')" > "$dir/.backup-status.tmp" \
    && mv -f "$dir/.backup-status.tmp" "$dir/.backup-status"
}

uuid_ok() { printf '%s' "$1" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; }

# Sparar ett kartinnehåll (alla delar) en gång. Ger fel om innehållet inte finns (längre) eller är ofullständigt.
save_content() {
  id="$1"; file="$dir/map-content/$id.copy"
  [ -s "$file" ] && return 0
  uuid_ok "$id" || return 1
  complete=$(psql -X -Atq -v ON_ERROR_STOP=1 -c "select count(*) from map_content c where c.content_id = '$id'
    and c.byte_length = (select coalesce(sum(octet_length(p.data)), 0) from map_content_part p where p.content_id = c.content_id)") || return 1
  [ "$complete" = "1" ] || return 1
  psql -X -q -v ON_ERROR_STOP=1 -c "\\copy (select content_id, part, data, created_at from map_content_part where content_id = '$id' order by part) to '$dir/map-content/.$id.partial' with (format binary)" \
    && mv -f "$dir/map-content/.$id.partial" "$file" || { rm -f "$dir/map-content/.$id.partial"; return 1; }
}

# Innehållen som en dump pekar på: content_id ur dumpens rader i map_content, till filen $2.
dump_contents() {
  pg_restore --data-only --table=map_content --file="$2.sql" "$1" || { rm -f "$2.sql"; return 1; }
  awk '
    /^COPY .*map_content \(/ { line = $0; sub(/^[^(]*\(/, "", line); sub(/\).*$/, "", line); n = split(line, cols, ", ");
      for (i = 1; i <= n; i++) if (cols[i] == "content_id") col = i; copying = 1; next }
    copying && $0 == "\\." { copying = 0; next }
    copying && col { split($0, f, "\t"); print f[col] }' "$2.sql" > "$2"
  result=$?
  rm -f "$2.sql"
  return $result
}

# Sparar innehållen som saknas (alla i databasen, eller listan på stdin). Skriver hur många som inte gick att spara.
save_missing() {
  failed=0
  while read -r id; do
    [ -n "$id" ] || continue
    save_content "$id" || failed=$((failed + 1))
  done
  echo "$failed"
}

# Tar bort kartinnehåll som varken databasen eller någon sparad dump pekar på.
prune_contents() {
  keep="$dir/map-content/.keep.tmp"
  { psql -X -Atq -c "select content_id from map_content" || return 1
    find "$dir" -type f -name 'otid-*.dump.contents' -exec cat {} + 2>/dev/null; } | sort -u > "$keep" || return 1
  find "$dir/map-content" -maxdepth 1 -type f -name '*.copy' | while read -r file; do
    id=$(basename "$file" .copy)
    grep -qx "$id" "$keep" || { rm -f "$file" && echo "Kartinnehåll borttaget: $id"; }
  done
  rm -f "$keep"
}

# ADR-0216: efter en pg_restore läses kartinnehållet in för varje innehåll i databasen som saknar sina delar.
restore_map_content() {
  loaded=0; missing=0
  for id in $(psql -X -Atq -v ON_ERROR_STOP=1 -c "select c.content_id from map_content c
      where not exists (select 1 from map_content_part p where p.content_id = c.content_id)"); do
    file="$dir/map-content/$id.copy"
    if [ -s "$file" ] && psql -X -q -v ON_ERROR_STOP=1 -c "\\copy map_content_part (content_id, part, data, created_at) from '$file' with (format binary)"; then
      loaded=$((loaded + 1))
    else
      missing=$((missing + 1)); echo "Kartinnehåll saknas: $id" >&2
    fi
  done
  echo "Kartinnehåll inläst: $loaded, saknas: $missing."
  [ "$missing" -eq 0 ]
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
  if ! restic backup --quiet --host otid --tag otid --exclude '.*.partial' --exclude '.*.tmp' "$dir"; then
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
  # ADR-0216: kartinnehållet som finns nu sparas före dumpen (resten, som skapas under dumpen, efter).
  psql -X -Atq -c "select content_id from map_content" 2>/dev/null | save_missing >/dev/null
  # Steg 65 och ADR-0216: utskriftsjobbens PDF:er, klubbarkivets miniatyrer och kartkontroller (kan skapas igen) och
  # kartinnehållets delar (sparas en gång i map-content/) tas inte med; tabellerna gör det.
  if ! pg_dump --format=custom --exclude-table-data=course_setting_print_job --exclude-table-data=club_archive_entry_thumbnail \
      --exclude-table-data=club_map_version_check --exclude-table-data=map_content_part --file="$partial"; then
    rm -f "$partial"
    echo "BACKUP MISSLYCKADES $(date +%FT%T%z)" >&2
    heartbeat fail "pg_dump misslyckades $(date +%FT%T%z)"
    status fail "pg_dump misslyckades"
    return 1
  fi
  if ! dump_contents "$partial" "$partial.contents"; then
    rm -f "$partial" "$partial.contents"
    echo "BACKUP MISSLYCKADES (dumpens kartinnehåll kunde inte läsas) $(date +%FT%T%z)" >&2
    heartbeat fail "pg_restore -l misslyckades $(date +%FT%T%z)"
    status fail "dumpens kartinnehåll kunde inte läsas"
    return 1
  fi
  failed=$(save_missing < "$partial.contents")
  if [ "$failed" -gt 0 ]; then
    # Ett innehåll i dumpen fanns inte kvar att spara: ta om dumpen med kartinnehållet i (den går då att återställa ensam).
    echo "Kartinnehåll ändrades under dumpen ($failed); dumpen tas om med kartinnehållet i."
    if ! pg_dump --format=custom --exclude-table-data=course_setting_print_job --exclude-table-data=club_archive_entry_thumbnail \
        --exclude-table-data=club_map_version_check --file="$partial"; then
      rm -f "$partial" "$partial.contents"
      echo "BACKUP MISSLYCKADES $(date +%FT%T%z)" >&2
      heartbeat fail "pg_dump misslyckades $(date +%FT%T%z)"
      status fail "pg_dump misslyckades (med kartinnehåll)"
      return 1
    fi
    : > "$partial.contents"
  fi
  mv "$partial.contents" "$target/$name.contents"
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
      cp -f "$dir/hourly/$name.contents" "$dir/daily/$day.contents"
    else
      echo "BACKUP MISSLYCKADES (dagsbackup) $(date +%FT%T%z)" >&2
    fi
    prune "$dir/hourly" 'otid-*.dump' "$keep_hourly"
    prune "$dir/daily" 'otid-*.dump' "$keep_days"
  fi
  prune_contents || echo "Gallringen av kartinnehållet misslyckades; försöker igen nästa gång." >&2
  status ok "Backup klar: $name"

  if ! offsite; then
    heartbeat fail "Kopian utanför servern misslyckades $(date +%FT%T%z)"
    status fail "Dumpen lyckades men kopian utanför servern misslyckades"
    return 0
  fi
  heartbeat ok
  return 0
}

if [ "${1:-}" = "dump" ]; then
  dump "${2:-}"
  exit $?
fi
if [ "${1:-}" = "restore-map-content" ]; then
  restore_map_content
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
