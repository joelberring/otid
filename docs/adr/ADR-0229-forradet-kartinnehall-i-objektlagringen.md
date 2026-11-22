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

## Tillägg 2026-11-21: fastspikning för tävlingar och träningar (PLAN.md steg M2)

Ägaren: en tävlingskarta får aldrig behöva hämtas ur objektlagringen på tävlingsdagen.

- **Urvalet** (`map-pin.ts`, `pinWindowDays` = en dag före, en dag efter): innehåll i förrådet som ett lopp vars tävlingsdag
  i eventets tidszon är i går, i dag eller i morgon pekar på genom `race_map` och `race_map_source` (bilden och kartfilen som
  gafflingar, banor, utskrift och kartritarens länk ritas ur), och träningsbibliotekets karta som loppet kom ifrån
  (`race_map_agreement.source_map_id` → `training_group_map`, `training_group_map_source`). En träning är ett lopp, så den
  följer samma regel. Andra tabeller med `content_sha256` (klubbarkivet, kartprojekten) hör inte till ett lopp. En okänd
  tidszon räknas som spikad.
- **Markeringar i stället för en tabell:** en tom fil `.pinned/<sha256>` i mellanlagret. Alla processer som delar katalogen
  (web, publikens instanser, utskriftsarbetaren, som inte får läsa `event`) ser dem utan att fråga databasen. Ingen migration.
  Städningen läser markeringarna efter genomgången av filerna, så det som spikats före läsningen skyddas alltid.
- **Löparen** (tävlingsinstansen, var 5:e minut före städningen): spikar fast, hämtar det som saknas (kontrollerat), släpper
  markeringar som inte längre ska finnas (efter 15 minuter, så att en markering från en skrivning som pågår får vara kvar).
  Misslyckas en hämtning prövas den nästa varv; loggen säger antal och storlek, aldrig namn.
- **Vid skrivningen:** en kartbild eller kartfil som laddas upp till ett lopp i fönstret spikas innan den läggs i
  mellanlagret (sha256 är känd före uppladdningen); en karta ur biblioteket och en kopia av ett lopp spikas efter skrivningen.
- **Gränsen** `pin_max_mb` (installationsinställning, förval 3 072 MB, bredvid taket på superadminsidan): det fastspikade
  räknas utanför taket. Passeras gränsen spikas allt ändå (tävlingen går först), med varning i loggen och på superadminsidan.
- **Läsningen** av ett spikat innehåll som finns i mellanlagret går aldrig till förrådet (test med ett förråd som kastar fel).
- Med `OTID_STORE_MODE=off` görs ingenting av detta (innehållet ligger i databasen).
- Kvar: ett lopp som flyttas in i fönstret spikas vid nästa varv (högst 5 minuter). Utträngningen mellan skrivningen och
  markeringen kan inte inträffa för uppladdningar; för en kopia eller en bibliotekskarta finns innehållet oftast inte i
  mellanlagret ännu och hämtas nästa varv.

## Tillägg 2026-11-21 (M3): flytten av befintligt innehåll (PLAN.md steg M3)

Ägaren 2026-11-21 kl. 23: förrådet är på sedan i kväll; disken 78 % full (backups/map-content 5,0 GB, Postgres 4,7 GB).

- **Löparen** (`map-store-migrate.ts`, i förrådets löpare i tävlingsinstansen): var 10:e minut kl. 01–06 svensk tid, högst
  2 048 MB uppladdat per varv (ett större innehåll flyttas ensamt), aldrig på tävlingsdygnet (ADR-0178), bara med förrådet i bruk.
  Inställningar `OTID_STORE_MIGRATE` (`off` stänger av), `_HOURS`, `_RUN_MB`, `_GRACE_HOURS`. Ordning: laserkörningars resultat,
  underlag, grundfiler och övrigt, sist tävlingars och träningars kartor; störst först inom varje.
- **Ett innehåll:** delarna strömmas till en fil i mellanlagret och kontrolleras, laddas upp och läses tillbaka; sedan, i en
  transaktion som låser raden och prövar igen (fortfarande 'DB', samma `content_id`, hela delar), `stored_in = 'STORE'` och
  arkivets rad med `cold_at`, som också är fristens början. Delarna tas bort efter fristen (24 h) när objektets längd kontrollerats
  igen; saknas objektet laddas det upp igen ur delarna och fristen börjar om. Under fristen läses delarna, och en ström vars delar
  försvinner mitt i fortsätter ur förrådet där den slutade (`streamMapContentParts`).
- **Arkivet (L5) blir överflödigt:** innehåll som arkivet laddat upp kontrolleras i förrådet (längd och sha256) i stället för att
  laddas upp igen, och innehåll som arkivet redan tagit bort här (`cold_at`) blir 'STORE' när objektets längd stämmer. Med
  förrådet i bruk startas arkivets löpare inte; förrådets löpare tar bort släppta objekt (beslut 4). `restoreMapContent` finns
  kvar för 'DB'-innehåll med `cold_at` tills det flyttats, och arkivets kod tas bort när förrådet är förval.
- **Fastspikat:** en tävlings- eller träningskarta i fastspikningsfönstret (M2) läggs i mellanlagret och spikas i samma varv som
  den flyttas.
- **Återkopplingen:** en rad 'DB' utan delar och utan `cold_at`, vars objekt finns i förrådet med rätt längd, blir 'STORE' (var
  10:e minut, hela dygnet). Det är så en återställd äldre dump (där innehållet ännu var 'DB') hittar det som flyttats sedan.
- **Manuell start:** `node superadmin.mjs map-store migrate-now [--mb N]` (skriver förloppet) och «Flytta nu» på
  superadminsidan (en rad `map_migrate_request` i `installation_setting`, som löparen tar inom en minut; åtgärden loggas).
  Tävlingsdygnet gäller, nattfönstret inte. Ett varv i taget (`map_migrate_lease`, 15 minuter). Senaste varvet sparas i
  `map_migrate_last` och visas med kvar i databasen, i förrådet och väntar på frist. Ingen migration.
- **Backupen** (beslut 7): när innehåll blivit 'STORE' tar `prune_contents` bort dess fil i `backups/map-content` också om äldre
  dumpar pekar på det, och dess id sparas i `map-content/.store-ids`; `restore-map-content` räknar dem som flyttade, inte saknade.
- **Efteråt:** `map-store status` skriver `map_content_part`-tabellens storlek och när VACUUM FULL rekommenderas (docs/drift.md,
  "Efter flytten: frigör databasens utrymme"). Inget pg_repack (ett beroende till för en engångsåtgärd).
- Kvar: med träningar nästan varje dag kan tävlingsdygnet stoppa flytten flera nätter i rad; då `migrate-now` en dag utan.

## Följder

- Med läget på blir objektlagringen en beroendepunkt för nytt innehåll: utan anslutning misslyckas en uppladdning (med ett
  fel, inget sparas till hälften), och nytt innehåll som trängts ur mellanlagret går inte att läsa. Före M2 gäller det också
  en tävlings karta som laddats upp efter påslagningen.
- Publikens instanser och utskriftsarbetaren får objektlagringens nycklar och mellanlagrets volym. Utskriftsrollen får läsa
  mellanlagrets tak och skriva `last_used_at` och hämtningarna (`deploy/db-roles.sh setup`); utan det hoppar den bara över det.
- Ett objekt som laddats upp men inte blev innehåll (kvoten tog slut under tiden) märks som släppt och raderas efter fristen.

## Tillägg 2026-11-22: kontrollen efter uppladdningen och nya försök

Ägaren 2026-11-22: laserkörningarna gick långsamt, och en etapp föll med «Arkivet: hämtningen misslyckades (504 GatewayTimeout)».
Kontrollen efter uppladdningen läste tillbaka hela objektet, så varje resultatfil från geo-servern (upp till 77 MB) gick upp och ner
igen medan geo-serverns anrop väntade.

- **Beslut:** `uploadToStore` kontrollerar med en HEAD att objektet finns med rätt längd. Innehållet kontrolleras redan vid
  uppladdningen: PUT signeras med innehållets sha256 (`x-amz-content-sha256`), och objektlagringen nekar en kropp som inte stämmer.
- **Beslut:** anropen till objektlagringen provas igen vid 429, 500, 502, 503, 504 och nätfel (tre försök, 1 s och 4 s emellan).
  Andra svar (403, 404) provas inte igen.
- Flytten (M3) och arkivet läser fortfarande hela objektet där de behöver det (`download`, `digest`).

## Tillägg 2026-11-22 (granskningen runda 2, A och B): uppladdningen utanför transaktionen

`storeMapContent` laddade upp till objektlagringen, tog bort den strömmade filen och flyttade den till mellanlagret inne i
anroparens transaktion, som görs om vid 40001/40P01, och kontrollerade objektet under kartinnehållets gemensamma lås.

- **Beslut:** transaktionen gör bara databasarbete. Behövs en uppladdning kastar `storeMapContent` `OutsideTransactionWork`
  (`@o-tid/database`): transaktionen rullas tillbaka, uppladdningen görs utan öppen transaktion och transaktionen görs om
  (högst sex gånger). Behörigheten och kvoten prövas alltså före uppladdningen, i det första försöket.
- **Beslut:** före uppladdningen reserveras innehållet: arkivets rad markeras som släppt (`orphaned_at` = nu). Rullas
  transaktionen tillbaka städas objektet efter fristen som andra släppta objekt. Städningen prövar fristen igen när den tar
  bort och ordnas mot en ny uppladdning med radlåset, inte med det gemensamma låset; registreringen kräver att reservationen
  står kvar (`storeReservationHolds`, under radlåset), annars laddas innehållet upp igen.
- **Beslut:** den strömmade filen länkas in i mellanlagret och tas bort av anroparen efter transaktionen
  (`discardStagedMapContent`), också när innehållet sparades.
- Filens början för en klubbkarta i förrådet läses ur mellanlagret eller med HTTP Range (`readHead`), efter transaktionen.
- Säkerhetskopian läser innehåll i förrådet eller arkivet och bygger zip-filen efter sin ögonblicksbild; tryck-PDF:en läses i
  en egen fråga efter behörigheten. Båda hålls fortfarande hela i minnet (strömmande zip och PDF är inte gjort).
