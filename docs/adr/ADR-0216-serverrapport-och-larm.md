# ADR-0216: Serverrapport, larm, mindre säkerhetskopior och belastningstest

Status: beslutad 2026-11-07 (grenen `b4-serverrapport`, migration 0085). Bygger på ADR-0186 beslut 7–8 (bevakning och backup)
och ADR-0189 (kartinnehållet).

## Bakgrund

Ägaren: "hur många samtidiga arr klarar servern idag? … statusnotiser till mig som superanvändare en gång i veckan och om det
börjar bli problem?" och "ska jag köpa större disk redan nu om folk lägger upp kartor?". Servern är en Hetzner CX23 (2 kärnor,
4 GB, 40 GB disk). Hälsokontrollen (`monitor`) pingade bara en valfri bevakningstjänst, och backupen tog hela databasen med alla
kartfiler varje timme (48 timdumpar och 14 dagliga), så säkerhetskopiorna växte med 62 gånger kartornas storlek.

## Beslut

1. **Bevakningen körs i `web`** (tävlingens instans, som underhållet; `lib/server-watch-runner.ts`), inte i en ny container
   eller cron: var `OTID_HEALTH_INTERVAL_MINUTES`:e minut (förval 15) sparas en mätning (`server_sample`), larm skickas och
   veckorapporten går när det är dags. Allt i en transaktion med ett PostgreSQL-lås; misslyckas e-posten görs varvet om.
   Belastningen och det lediga minnet mäts varje minut i processen och topparna sparas med mätningen.
2. **Mottagare** är kontona med systemrollen superadmin som inte är spärrade, ett mejl per mottagare, med den befintliga
   e-posten (`mail.ts`). Utan e-post skrivs larmen och rapporten i loggen.
3. **Veckorapport** söndag kl. 19 svensk tid (`OTID_SERVER_REPORT_DAY`/`_HOUR`, `OTID_SERVER_REPORT=off`): disken med prognos
   (veckor till full disk ur mätningarna), kartornas kvot och om den ryms, databasens storlek uppdelad, säkerhetskopiornas
   storlek, antal konton/klubbar/tävlingar och de kommande 14 dagarna (bara antal), larmen och hälsokontrollens fel, belastningens
   topp och minsta lediga minne. Första gången sparas bara tidpunkten (`server_notice`), så den skickas aldrig dubbelt eller
   mitt i veckan efter en uppdatering.
4. **Larm** för disken, kartornas kvot, säkerhetskopian (misslyckad eller äldre än `OTID_BACKUP_ALERT_HOURS`), hälsokontrollen
   (tre misslyckade i rad eller tyst i en timme) och minnet: högst ett per sort och dygn (en påminnelse per dygn medan det står
   kvar) och ett "löst" när det gått över, bara om det larmades. Läget per sort i `server_notice`, det skickade i
   `server_notice_log` (inga personuppgifter, 180 dagar).
5. **Hälsokontrollen byggs vidare på**, inte dupliceras: `monitor.sh` skriver varje kontroll med felkoder i `./status/monitor.log`
   och `backup.sh` sitt resultat i `./backups/.backup-status`; `web` monterar `./backups` och `./status` skrivskyddat. Diskens och
   backupens fel har egna larm och räknas inte också som "hälsokontrollen". Pingarna till bevakningstjänsten finns kvar (de
   fångar att hela servern är nere, då inget kan mejlas).
6. **Säkerhetskopiorna**: `map_content_part` (kartinnehållet, oföränderligt och adresserat) sparas en gång per innehåll i
   `./backups/map-content/<content_id>.copy` (binär COPY) i stället för i varje dump; varje dump har en lista över innehållen den
   pekar på, och en fil tas bort först när ingen sparad dump och inte databasen pekar på den. Saknas något (togs bort under
   dumpen) tas dumpen om med kartinnehållet i. Återställningen är `pg_restore` som förut plus `sh /backup.sh restore-map-content`.
   Klubbarkivets miniatyrer och kartkontroller (ADR-0196, ritas om i webbläsaren när de saknas) tas inte med, liksom
   utskrifternas PDF:er (steg 65). `BACKUP_KEEP_HOURLY` sänks till 24.
7. **Belastningstest** `scripts/load-test.ts` (`pnpm load-test`): N samtidiga tävlingar skapade via API:t, med avläsningar,
   besökare och speaker, mot valfri adress; bara Node (fetch). Bedömningen för CX23 står i docs/drift.md.

## Följder

- Inget måste läggas till i `.env`; efter den vanliga uppdateringen fungerar allt med förvalen. Den första rapporten kommer
  söndagen efter, och prognosen när det finns två dygns mätningar.
- Första dumpen efter uppdateringen sparar allt kartinnehåll en gång (tar några sekunder extra).
- Den gamla återställningen utan `restore-map-content` ger kartor utan bild och fil tills steget körs.
