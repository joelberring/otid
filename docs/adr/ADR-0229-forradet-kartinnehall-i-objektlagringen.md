# ADR-0229: Förrådet – kartinnehåll i objektlagringen, servern som mellanlager

Status: beslutad av ägaren 2026-11-21, första delen byggd (PLAN.md steg M1, migration 0133). Ändrar ADR-0216 beslut 6
(kartinnehållet i backupen) och ADR-0224 (arkivet blir förrådet för allt kartinnehåll). Bygger på ADR-0189.

## Bakgrund

Servern (Hetzner CX23, 40 GB disk) låg nära 80 % fast bara ägaren arbetade i den. Kartinnehållet ligger som `bytea` i
PostgreSQL (`map_content_part`), så borttaget innehåll krymper inte disken; allt finns dessutom en gång till i
`./backups/map-content`, och arkivet (L5) tar bara laserkörningar. Ägaren ska bjuda in fler, och lagringen måste då växa utan
att han köper disk eller städar för hand.

## Beslut

1. **Objektlagringen är förrådet** för kartinnehåll, och serverns disk ett mellanlager. Förrådet är samma S3-lagring som
   arkivet (`OTID_ARCHIVE_*`, objektet `map-content/<sha256>`); ingen ny bucket och inga nya nycklar.
2. **Läget `OTID_STORE_MODE`** = `off` (förval, allt som i dag) eller `on`. På kräver fullständiga `OTID_ARCHIVE_*` och ett
   skrivbart mellanlager; annars en varning i loggen och samma beteende som `off`. Inget slås på av sig självt.
3. **Skrivning med läget på:** uppladdningen strömmas till en fil i mellanlagret (`.staging/`), laddas upp till förrådet med
   längden som Content-Length, läses tillbaka och jämförs (längd och sha256), och först därefter skrivs raden i `map_content`
   med `stored_in = 'STORE'`. Inga delar skrivs i `map_content_part`. Uppladdningen sker före det gemensamma låset för
   kartinnehåll (kvoten förhandsprövas), så att en stor fil inte köar alla andra; under låset kontrolleras att objektet finns.
4. **Registret:** `map_content` får `stored_in` ('DB' för alla befintliga rader), `last_used_at` (högst var 10:e minut) och
   `regenerable` (fylls i M4). Varje innehåll i förrådet har också en rad i `map_content_archive` med `cold_at` satt. Arkivets
   städning gäller då också förrådet (objektet raderas `OTID_ARCHIVE_ORPHAN_DAYS` efter att innehållet släppts, under samma lås
   som sparandet), och en äldre kodversion läser det som arkiverat innehåll.
5. **Läsning** avgörs av raden, inte av läget: 'DB' läses som förut (också arkiverat, ADR-0224); 'STORE' ur mellanlagret,
   annars hämtat ur förrådet till en temporär fil, kontrollerat och flyttat på plats atomiskt. Allt går via `readMapContent`,
   `rowContent` och `streamMapContentParts`; säkerhetskopian av en tävling (ADR-0187) hämtar på samma sätt. Avläsning och
   publika sidor beror alltså inte på förrådet för innehåll som redan finns.
6. **Mellanlagret** (`OTID_CACHE_DIR`, volymen `./map-cache` i web, web-public, web-public2 och print-worker) har ett tak som
   är en installationsinställning på superadminsidan (förval 10 240 MB eller `OTID_CACHE_MAX_MB`), i den nya tabellen
   `installation_setting`. Var 5:e minut och direkt efter en skrivning som passerar taket tas de minst nyligen använda filerna
   bort tills det är under 90 %. En fil som läses förstörs inte: den öppnas före namnbytet och läses ur den öppna filen, och
   Linux behåller en öppen fil efter unlink. Hämtningar ur förrådet räknas per dygn (`map_store_fetch_day`).
7. **Backupen** (ändrar ADR-0216 beslut 6): innehåll med `stored_in = 'STORE'` sparas inte i `backups/map-content`, räknas inte
   som saknat och läses inte in av `restore-map-content`. Efter ett haveri måste både databasen och bucketen finnas.
8. **Gränser på superadminsidan** (ägaren: han vill justera dem själv, också för sitt eget konto): per konto kartlagring för
   eget material (`map_quota_mb`), återskapbart (`regenerable_quota_mb`, ny, förval 10 240 MB, används från M4) och laserrutor;
   för installationen mellanlagrets tak och kartlagringens totala gräns, med mellanlagrets fyllnad och hämtningarna ur
   förrådet. Ändringarna loggas i `superadmin_action` (målet `INSTALLATION`).
9. **Kvoterna:** förvalet per konto höjs från 2048 till 5120 MB (ägarens beslut). Installationens totalgräns behålls, eftersom
   den skyddar mot att ett fel eller missbruk fyller lagringen, men den mäter nu det som betalas för och inte serverns disk:
   med förrådet påslaget är förvalet 1 048 576 MB (1 TB, det som Hetzner Object Storages grundpris omfattar), och superadmin
   kan ändra den (0 = ingen gräns) utan att röra `.env`. Utan förrådet är förvalet 20 480 MB som förut, eftersom allt då
   ligger på disken.

## Ordning (PLAN.md steg M)

M1 detta. M2 fastspikning av tävlingars och träningars kartor i mellanlagret dagen före till dagen efter. M3 flytt av
befintligt innehåll ur PostgreSQL i omgångar nattetid, bort med `backups/map-content`, VACUUM/pg_repack. M4 recept för
återskapbart underlag, gräns per konto för återskapbart (äldst använt bort först, skydd för projekt öppnade de senaste 3
dygnen och projektets senaste klara laserkörning), borttagning ur förrådet efter 90 dagar orört. M5 larm via mejl till
superadmin, flera superadmin, automatisk rensning av docker-avbildningar.

## Följder

- Med läget på blir objektlagringen en beroendepunkt för nytt innehåll: utan anslutning misslyckas en uppladdning (med ett
  fel, inget sparas till hälften), och nytt innehåll som trängts ur mellanlagret går inte att läsa. Före M2 gäller det också
  en tävlings karta som laddats upp efter påslagningen.
- Publikens instanser och utskriftsarbetaren får objektlagringens nycklar och mellanlagrets volym. Utskriftsrollen får läsa
  mellanlagrets tak och skriva `last_used_at` och hämtningarna (`deploy/db-roles.sh setup`); utan det hoppar den bara över det.
- Ett objekt som laddats upp men inte blev innehåll (kvoten tog slut under tiden) märks som släppt och raderas efter fristen.
