# Drift

O-Tid körs med `docker-compose.prod.yml` på en vanlig VPS:

- PostgreSQL 17 (den officiella bilden, fast version `postgres:17.11-trixie`, finns för både x86 och ARM),
- `backup-before-migrate` och `migrate` (ADR-0186): vid varje `up` tas först en dump och sedan migreras databasen, i var sin
  engångstjänst; webben startar först när båda har lyckats,
- webben (Next standalone) i två slags instanser (steg 54, [ADR-0177](adr/ADR-0177-tavlingen-forst.md)):
  - `web` – tävlingen: arbetsytan, avläsningen, funktionärerna, inloggningen och admin-API:t. Hämtar radiostämplingar.
  - `web-public` och `web-public2` – publiken: publika sidor och API:er, Live och resultatströmmen. Två, eftersom en
    Node-process bara använder en kärna (steg 51). Startar när `web` har migrerat.
  Se [Tävlingen först](#tävlingen-först),
- Caddy (HTTPS med Let's Encrypt och HSTS, skickar publika anrop till `web-public`/`web-public2` och allt annat till `web`),
- utskriftsarbetaren `print-worker`,
- en backuptjänst (dump varje timme, valfri krypterad kopia utanför servern) och hälsokontrollen `monitor` (ADR-0186).

All data, även kartbilder, kartfiler från OCAD och Mapper (steg 59, högst 60 MB per tävling) och GPS-rutter för vägval
(PLAN.md steg 16), ligger i PostgreSQL och kommer med i backupen. MinIO behövs inte. Kartfilens uppladdning är den enda
stora bodyn; `deploy/Caddyfile` tillåter 100 MB för just den sökvägen.

## Starta

Krav: en Linux-server (x86 eller ARM) med Docker och Compose (1 vCPU och 1–2 GB minne räcker
till en klubbträning; att bygga webben på servern kräver omkring 2 GB). Du behöver också ett domännamn vars A/AAAA-post pekar
på servern (se [Server och domän](#server-och-domän)). Portarna 80 och 443 ska vara öppna.

```bash
git clone https://github.com/joelberring/otid.git && cd otid
cp deploy/prod.env.example .env      # fyll i OTID_DOMAIN och POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Bygg först och starta sedan (steg 45): då körs den gamla webben vidare medan den nya byggs, och ett misslyckat bygge
stoppar ingenting. Bygget behöver omkring 2 GB minne. På en server med 4 GB (Hetzner CX23/CAX11) räcker det oftast, men
lägg till 2 GB swap så att bygget inte dödas när databasen och webben redan använder minnet:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h                               # Swap ska visa 2,0Gi
```

Öppna `https://<OTID_DOMAIN>/organizer` och skapa det första kontot (e-post, namn och lösenord).
Gör sedan dig själv till superadmin (se nedan).

**Uppdatera:**

```bash
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

(eller `git pull && docker compose -f docker-compose.prod.yml up -d --build`). ADR-0186: `up` tar först en dump
(`./backups/fore-migrering/`, de 10 senaste sparas) och kör sedan nya migreringar i tjänsten `migrate`; först därefter
startas den nya webben. Misslyckas dumpen eller en migrering fortsätter den gamla webben att köra (se
[Om en migrering misslyckas](#om-en-migrering-misslyckas)); `docker compose -f docker-compose.prod.yml logs backup-before-migrate migrate`
visar varför.

Loggarna begränsas till fem filer på 10 MB per tjänst (`logging` i `docker-compose.prod.yml`), så de fyller inte disken.

**Baslinjen i steg 23 (2026-10-18):** de 106 gamla migrationerna (och borttagningen av tolv döda
tabeller) är ihopslagna till `0000_baseline.sql` (ADR-0173; det fanns ingen produktionsdata). En databas som skapats med de gamla
migrationerna kan inte uppgraderas. Skapa den på nytt: `docker compose -f docker-compose.prod.yml down -v`
(driftmiljön; raderar databasen och Caddys
certifikat men inte `./backups`, vars dumpar hör till det gamla schemat) eller `docker compose down -v` (lokalt), och starta igen.
Testdatabaser (`otid_test`, `otid_e2e`) tas bort med `DROP DATABASE` och skapas tomma igen.

**Vanlig PostgreSQL i steg 28 (2026-10-20):** `postgis/postgis:17-3.5` (bara amd64) är utbytt mot `postgres:17`.
Samma huvudversion och samma datakatalog (`/var/lib/postgresql/data`), så den befintliga volymen används som den är
och datan finns kvar. `git pull && docker compose -f docker-compose.prod.yml up -d --build` byter bild, och webben kör
migrering 0007 som tar bort det oanvända PostGIS-tillägget. Den nya bilden har nyare glibc (Debian trixie i stället
för bullseye); 0007 bygger då om textindexen och uppdaterar databasens sorteringsversion (annars varnar PostgreSQL för
"collation version mismatch"). Lokalt: se README (säkerhetskopia, `git pull`, `docker compose up -d postgres`,
`pnpm db:migrate`). Dumpar från före steg 28 innehåller `CREATE EXTENSION postgis`; vid återställning på den nya
bilden skriver `pg_restore` fel för just tillägget, och de kan ignoreras.

## Tävlingen först

Steg 54 ([ADR-0177](adr/ADR-0177-tavlingen-forst.md), mätt i [lasttest.md](lasttest.md)): när många tittar ska
avläsningen, arbetsytan och funktionärerna fungera som vanligt, och resultatredovisningen till publiken får bli
långsammare. Servern skalas inte upp (CX23 räcker), utan tävlingen får gå före:

- **Uppdelning (Caddy, `deploy/Caddyfile`):** publika sökvägar (`/`, `/om`, `/integritet`, `/results/…`, `/starts/…`, `/t/…`,
  `/fest/…`, `/api/public/…`, den publika startlistan och Nexts statiska filer) går till `web-public` eller `web-public2`
  (färst pågående anrop; svarar den ena inte prövas den andra) för den som inte är inloggad. Allt annat, och allt för
  den som är inloggad (arrangörer och funktionärer, även speakern och de publika sidorna), går till `web`. Varje instans
  klarar alla sökvägar: lokalt och med `pnpm dev` finns bara en (`OTID_INSTANCE_ROLE` saknas, `all`).
- **Processortid:** `cpu_shares` i `docker-compose.prod.yml` är 1024 för `postgres`, `web` och Caddy, 256 för var och en av
  `web-public` och `web-public2`, 128 för backupen och 64 för utskriftsarbetaren (`print-worker`, steg 65, som dessutom
  kör med nice 19). Vikterna gäller bara när processorn inte räcker till alla: då går
  tävlingen och databasen före publiken. Annars får publiken all ledig tid.
- **Minne (CX23, 4 GB):** `postgres` 1 GB, `web` 1 GB (Node 768 MB), `web-public` och `web-public2` 640 MB var (Node
  448 MB), utskriftsarbetaren 384 MB (huvudprocessen 96 MB, varje jobb i en barnprocess med 256 MB; 300 kartor per löpare
  på Högdalen 2026 tog 130 MB), Caddy och backupen 192 MB var, hälsokontrollen 64 MB. Summan 4,1 GB (taken är gränser, inte
  reserverat minne); swappen räcker till bygget.
- **Utskrift (steg 65, ADR-0184):** PDF:er för tryck skrivs av `print-worker`, ett jobb i taget ur tabellen
  `course_setting_print_job`. Klara PDF:er sparas 7 dagar (högst 10 per tävling) och tas inte med i säkerhetskopian;
  raden om jobbet sparas 30 dagar. ADR-0186: varje jobb körs i en barnprocess med tidsgräns (`OTID_PRINT_JOB_TIMEOUT_MS`,
  förval 600000 = 10 minuter); ett jobb som hänger eller tar slut på minnet blir FAILED med en förklaring och kön går vidare.
  Står tjänsten stilla väntar jobben i kön och hälsokontrollen larmar efter 15 minuter;
  `docker compose -f docker-compose.prod.yml logs print-worker` visar vad den gör.
- **Databasen:** separata pooler. `web` har tävlingens pool (högst 10 anslutningar, inga tidsgränser) och en liten pool
  för de publika listorna (3). `web-public` och `web-public2` har bara publikens pool (8 var). Publikens frågor avbryts
  efter 5 s (`statement_timeout`), väntar högst 2 s på lås och en transaktion får inte stå öppen i mer än 10 s. Totalt
  högst ungefär 30 av PostgreSQL:s 100 anslutningar; publiken kan aldrig ta tävlingens.
- **Lastavlastning i `web-public` och `web-public2`:** när processen inte hinner (händelseloopen ligger mer än 150 ms efter, eller anrop
  köar) ges den senast färdiga listan i upp till 10 s när bara nya resultat kommit in, listorna räknas om högst var tredje
  sekund, resultatströmmen väcker publiken högst var tredje sekund och sidan ombeds hämta igen först efter 5 s. Högst 24
  publika anrop åt gången; nästa väntar i kö (högst 600, högst 8 s). Som sista utväg svarar servern 503 med Retry-After
  och sidan försöker igen tyst med det den redan visar. Högst 3 000 öppna resultatströmmar per instans; nästa får 503,
  och sidan hämtar själv tills den ansluter igen efter 10–30 s.
- **Avläsningar går aldrig förlorade:** avläsningsdatorn lägger varje avläsning i sin lokala kö och tar bort den först
  när servern har kvitterat den. Avläsningen läser bara löparens eller lagets del av tävlingen (steg 54).

Gränserna kan ändras i `.env` (förvalen räcker för CX23): `OTID_PUBLIC_CONCURRENCY`, `OTID_PUBLIC_QUEUE`,
`OTID_PUBLIC_MAX_WAIT_MS`, `OTID_PUBLIC_STREAMS_MAX`, `OTID_PUBLIC_LAG_MS`, `OTID_DB_POOL_MAX`, `OTID_PUBLIC_DB_POOL_MAX` och
`OTID_PUBLIC_STATEMENT_TIMEOUT_MS`. Lägg i så fall till dem under `environment` i `docker-compose.prod.yml`.

**Se läget under tävlingen:**

```bash
docker stats otid-web-1 otid-web-public-1 otid-web-public2-1 otid-postgres-1   # CPU och minne per tjänst
docker compose -f docker-compose.prod.yml exec postgres psql -U otid -c \
  "select application_name, state, count(*) from pg_stat_activity group by 1, 2 order by 1"   # otid-web / otid-public
```

## Server och domän

O-Tid behöver en liten Linux-server med Docker. Alla bilder (webben, `postgres:17`, Caddy) finns för både x86 och
ARM sedan steg 28, så ARM-servrar fungerar också (bygget är inte provat på en ARM-server ännu). Priserna är ungefärliga
(oktober 2026):

| Alternativ | Vad | Att tänka på |
| --- | --- | --- |
| Hetzner CX23 | 2 vCPU (x86), 4 GB, ≈6 €/mån | Betalas per timme: skapa servern före tävlingen och radera den efteråt (spara `backups/` först). |
| Hetzner CAX11 | 2 vCPU (ARM), 4 GB, ungefär samma pris | Som CX23, men ARM. |
| Oracle Cloud Always Free | ARM (Ampere), upp till 4 vCPU och 24 GB, gratis | Region Stockholm finns. Registreringen kan nekas, och ledig ARM-kapacitet saknas ibland. |
| Google Cloud e2-micro | 2 delade vCPU, 1 GB, gratis | Bara amerikanska regioner. 1 GB räcker inte för att bygga på servern: bygg bilden på en annan dator eller lägg till swap. |
| Lokalt med Cloudflare Tunnel | Din egen dator, gratis | `cloudflared` ger en HTTPS-adress utan öppna portar (domänen måste ligga hos Cloudflare). Datorn måste vara på och ha nät hela tävlingen. Inte provat med O-Tid; Caddy behövs inte då. |

**DNS:** lägg en A-post (och gärna AAAA för IPv6) för ett namn under klubbens domän som pekar på serverns adress,
till exempel hos domänleverantören:

```text
tid.exempelklubb.se.   3600   IN   A      203.0.113.10
tid.exempelklubb.se.   3600   IN   AAAA   2001:db8::10
```

Sätt sedan `OTID_DOMAIN=tid.exempelklubb.se` i `.env`. Kontrollera med `dig +short tid.exempelklubb.se` att namnet
pekar rätt innan du startar; Caddy hämtar certifikatet från Let's Encrypt första gången någon öppnar adressen.

## Eventor

Klubbens Eventor-nyckel klistras in av administratören under Inställningar → Eventor
och sparas krypterad i databasen. Krypteringen kräver en masternyckel som bara finns
i serverns `.env` (aldrig i databasen eller dess backup):

```bash
echo "OTID_EVENTOR_MASTER_KEY=$(openssl rand -base64 32)" >> .env
docker compose -f docker-compose.prod.yml up -d
```

Utan masternyckel startar O-Tid ändå; Inställningar visar då att Eventor inte är
påslaget, och serverns logg säger "Eventor: servern saknar OTID_EVENTOR_MASTER_KEY". De gamla namnen
`OTID_EVENTOR_MASTER_KEY_ID` och `OTID_EVENTOR_MASTER_KEY_BASE64` används inte längre; står de kvar i `.env`
varnar servern vid start. Byt dem mot raden ovan. Spara masternyckeln separat från backupen. Byts eller tappas den kan de
sparade Eventor-nycklarna inte läsas, och administratören klistrar in klubbens nyckel igen.
`OTID_EVENTOR_BASE_URL` används bara för test (pekar O-Tid mot en falsk Eventor) och
ska inte sättas i drift.

## Spärrar mot upprepade försök

Inloggning, registrering, återställning av lösenord och självregistrering räknas per IP-adress (och e-post eller tävling).
Adresserna sparas bara som HMAC med en hemlighet: `OTID_THROTTLE_SECRET` om den finns i `.env`, annars härleds den ur
`DATABASE_URL` (databasens lösenord), så en befintlig server behöver inte ändras. Vill du ha en egen hemlighet:

```bash
echo "OTID_THROTTLE_SECRET=$(openssl rand -base64 32)" >> .env
docker compose -f docker-compose.prod.yml up -d
```

Ett byte nollställer bara räknarna. Raderna tas bort efter två dygn.

## Superadmin

Superadmin ser alla konton och tävlingar på `/superadmin` och kan dölja eller ta bort en tävling,
spärra eller ta bort ett konto och skapa en återställningslänk. Varje åtgärd loggas med vem, när och varför.
Rollen sätts bara med kommando på servern, aldrig i appen. Kontot måste finnas först:

```bash
docker compose -f docker-compose.prod.yml exec web node superadmin.mjs grant anna@exempelklubb.se
docker compose -f docker-compose.prod.yml exec web node superadmin.mjs revoke anna@exempelklubb.se
```

Ett skäl kan läggas sist (`… grant anna@exempelklubb.se "Driftansvarig"`); det syns i loggen på
`/superadmin` med "Serverkommando" som utförare. Lokalt: `pnpm account:superadmin grant <e-post>`.

## E-post och glömt lösenord

Med e-post inställd skickar O-Tid en återställningslänk till den som har glömt sitt lösenord. Länken gäller
en timme och en gång, och alla kontots inloggningar slutar gälla när lösenordet byts. Svaret på sidan är
detsamma oavsett om adressen har ett konto, och mejlet skickas efter svaret (ADR-0186).

ADR-0186: med e-post bekräftar nya konton sin adress med en länk (gäller ett dygn) innan de kan logga in, och registreringen
svarar likadant oavsett om adressen redan har ett konto. Behörigheter som andra ger ett konto (administratör, funktionär,
banläggning, gruppledare och gruppmedlem) gäller först när adressen är bekräftad; under Personer med behörighet står
"väntar på bekräftad e-post". Konton från före 2026-11-02 räknas som bekräftade. **Utan e-post** loggar registreringen in
direkt som förut, men då måste superadmin bekräfta adressen för hand innan någon annans behörighet gäller:

```bash
docker compose -f docker-compose.prod.yml exec web node superadmin.mjs verify anna@exempelklubb.se
```

(ett lösenordsbyte med en återställningslänk från superadmin bekräftar också adressen). Lägg till e-post i `.env` och starta om:

```bash
OTID_SMTP_URL=smtp://användare:lösenord@smtp.exempelklubb.se:587   # STARTTLS; eller smtps://…:465
OTID_MAIL_FROM=O-Tid <noreply@exempelklubb.se>
```

Utan `OTID_SMTP_URL` säger sidan "Glömt lösenordet" att man ska kontakta den som driver O-Tid. Superadmin
skapar då en länk på `/superadmin` (Konton → Återställningslänk) och ger den till personen. Länken visas
en gång. En felaktig inställning stänger av e-posten och skrivs i `logs web` (utan lösenord eller adresser).

`OTID_CONTACT_EMAIL` (valfri, förval otid@berring.se) visas på sidan om personuppgifter (`/integritet`) och på "Glömt lösenordet".
Adressen för frågor om programmet (sidfoten, Om O-Tid och Hjälp) är fast i `apps/web/src/lib/contact.ts`.
`OTID_REGISTRATION_LIMIT_PER_HOUR` (valfri, förval 10) är hur många konton som får skapas per IP-adress och timme.

Endast test: CI pekar `OTID_SMTP_URL` mot en falsk SMTP-server på värden (`tests/e2e/fake-smtp.ts`), på samma
sätt som `OTID_EVENTOR_BASE_URL`. Appen har ingen särskild testväg för e-post.

## Radiokontroller (ROC/OResults)

Administratören kopplar tävlingen under Inställningar → Radiokontroller: källa (ROC eller OResults), enhetens id
och vilka kontroller som är radiokontroller. Webbprocessen hämtar sedan nya stämplingar själv:

- Pollern startar med servern (`apps/web/src/instrumentation.ts`, inte under `next build`) och går var tionde sekund.
  Den frågar bara tävlingar med radion påslagen och tävlingsdagen i tävlingens tidszon; "Hämta nu" fungerar alla dagar.
- Bara en instans hämtar: den som håller PostgreSQL-låset (`pg_try_advisory_lock`, egen anslutning). Dör den tar
  nästa instans över inom tio sekunder. Varje hämtning frågar med tävlingens `lastId` och sparar stämplingarna och det
  nya `lastId` i samma transaktion; samma stämpling sparas aldrig två gånger.
- Fel (tjänsten svarar inte, nekar, fel enhet, oläsbart svar) sparas och visas i klartext för admin. Efter fel väntar
  pollern längre: 20, 40 och sedan 60 sekunder. `logs web` visar felkoden, aldrig bricknummer eller namn.
- `OTID_RADIO_POLLER=off` stänger av hämtningen i en instans (t.ex. om en annan process ska hämta).
- Adresserna: OResults `https://api.oresults.eu/roc?unitId=…&lastId=…` (dokumenterad) och ROC
  `https://roc.olresultat.se/ver7.1/getpunches.php?unitId=…&lastId=…`. **ROC-adressen är inte provad mot den
  riktiga tjänsten** – kontrollera den med en riktig enhet före första tävlingen (konstanterna finns i
  `packages/roc/src/client.ts`).

Endast test: `OTID_ROC_BASE_URL` pekar O-Tid mot en falsk ROC (`tests/e2e/fake-roc.ts`, port 4331 i CI) och ska inte
sättas i drift.

## Backup

Tjänsten `backup` (`deploy/backup.sh`, avbildningen `otid-backup` = `postgres:17.11-trixie` med restic och curl) tar en
`pg_dump` direkt vid start och sedan varje hel timme **dygnet runt** (ADR-0186; tidigare bara 08–23). Före varje start av
webben tar `backup-before-migrate` dessutom en dump (`./backups/fore-migrering/`, de 10 senaste).

- `./backups/hourly/otid-<tid>.dump`: de 48 senaste timdumparna (två dygn).
- `./backups/daily/otid-<datum>.dump`: dagens senaste dump, sparad i 14 dagar.
- En dump skrivs först till en dold fil (`.….partial`) och byter namn när `pg_dump` är klar, så en avbruten dump ser
  aldrig ut som en hel.
- Ett misslyckat försök loggas som `BACKUP MISSLYCKADES` i `docker compose -f docker-compose.prod.yml logs backup` och
  görs om nästa timme. Med bevakning (nedan) får du också ett mejl.

Intervallet och antalen ställs in i `.env` (`BACKUP_INTERVAL_MINUTES`, förval 60; `BACKUP_KEEP_HOURLY`, `BACKUP_KEEP_DAYS`).
Dumpar från före steg 45 ligger kvar direkt i `./backups/` och tas inte bort av tjänsten.

**Dump nu** (före och efter ett arrangemang):

```bash
docker compose -f docker-compose.prod.yml exec backup sh /backup.sh dump
```

Kommandot skriver `Backup klar: hourly/otid-<tid>.dump` och avslutas med fel om dumpen misslyckades.

### Kopia utanför servern (valfri, krypterad)

En backup på samma server skyddar inte mot att servern försvinner. Med restic skickas hela `./backups` krypterad efter varje
dump (bara det som är nytt går över nätet). restic gallrar en gång per dygn: en kopia per timme i två dygn, en per dag i 30
dagar och en per månad i 12 månader. Lösenordet krypterar kopian; **utan det går kopian inte att läsa**, så spara det
också utanför servern (t.ex. i en lösenordshanterare). Utan `RESTIC_REPOSITORY` görs ingen kopia och allt fungerar som förut.

Lägg i `.env` (ett av målen) och kör `docker compose -f docker-compose.prod.yml up -d`:

```bash
RESTIC_PASSWORD=<långt slumpat lösenord, t.ex. openssl rand -base64 32>

# Backblaze B2 (en "Application Key" med åtkomst till en egen bucket):
RESTIC_REPOSITORY=b2:<bucket>:otid
B2_ACCOUNT_ID=<keyID>
B2_ACCOUNT_KEY=<applicationKey>

# eller S3 (t.ex. AWS, Hetzner Object Storage):
RESTIC_REPOSITORY=s3:https://<endpoint>/<bucket>/otid
AWS_ACCESS_KEY_ID=<nyckel>
AWS_SECRET_ACCESS_KEY=<hemlighet>

# eller Hetzner Storage Box över SFTP (port 23). Lägg en egen SSH-nyckel utan lösenfras i deploy/backup-ssh/
# (id_ed25519 och en known_hosts-rad för boxen) och lägg den publika nyckeln i Storage Boxens inställningar:
RESTIC_REPOSITORY=sftp:u123456@u123456.your-storagebox.de:23/otid
```

För Storage Box: `mkdir -p deploy/backup-ssh && ssh-keygen -t ed25519 -N '' -f deploy/backup-ssh/id_ed25519` och
`ssh-keyscan -p 23 u123456.your-storagebox.de > deploy/backup-ssh/known_hosts` (katalogen är inte med i git).

Kontrollera efter en timme: `docker compose -f docker-compose.prod.yml logs backup | grep -E "Kopia|KOPIA"` ska visa
`Kopia klar (restic).` Lista kopiorna:

```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint restic backup snapshots
```

### Bevakning (valfri)

Skapa två kontroller hos t.ex. [healthchecks.io](https://healthchecks.io) (gratis upp till 20 kontroller) och lägg deras
ping-adresser i `.env`:

```bash
OTID_HEARTBEAT_BACKUP_URL=https://hc-ping.com/<uuid-1>    # period 1 timme, grace 1 timme
OTID_HEARTBEAT_HEALTH_URL=https://hc-ping.com/<uuid-2>    # period 15 minuter, grace 15 minuter
```

- Backupen pingar efter varje lyckad dump (och kopia), och `…/fail` när något misslyckades.
- Hälsokontrollen (`monitor`) pingar var 15:e minut (`OTID_HEALTH_INTERVAL_MINUTES`) när webben och databasen svarar
  (`/api/health`), publikens instanser svarar, inget utskriftsjobb har väntat mer än 15 minuter, disken är högst 80 % full
  (`OTID_DISK_ALERT_PERCENT`) och den senaste dumpen är färsk; annars `…/fail` med vad som är fel.
- Går servern ner kommer inga pingar alls, och tjänsten mejlar dig när perioden och grace har gått.

Utan adresserna skriver tjänsterna bara i loggen (`logs monitor`, `HÄLSOKONTROLL MISSLYCKADES`). Prova nu:
`docker compose -f docker-compose.prod.yml exec monitor sh /monitor.sh once`.

Webben skriver också fel inställningar i loggen när den startar (`KONFIGURATIONSFEL: …`, t.ex. fel `O_TID_PUBLIC_ORIGIN`
eller `OTID_SMTP_URL`): `docker compose -f docker-compose.prod.yml logs web | grep KONFIGURATIONSFEL`.

**Kopiera till din Mac** (behövs inte med kopian utanför servern, men skadar inte). Kör på din Mac, med serverns adress och
användare:

```bash
mkdir -p ~/otid-backup
rsync -av otid@tid.exempelklubb.se:otid/backups/ ~/otid-backup/
```

## Återställa

Provat lokalt 2026-10-03 och 2026-11-02 (dagens schema med migration 0040, dump som ägarrollen `otid_owner`, återställd i en
tom databas: samma antal anmälda, konton, avläsningar, resultatrevisioner och tävlingar). Så här gör du på samma server:

```bash
docker compose -f docker-compose.prod.yml stop web web-public web-public2 print-worker
docker compose -f docker-compose.prod.yml exec -T backup \
  pg_restore --clean --if-exists --no-owner -d otid /backups/daily/otid-<datum>.dump
docker compose -f docker-compose.prod.yml start web web-public web-public2 print-worker
```

Välj en fil i `/backups/hourly/` för en senare tidpunkt samma dag. `pg_restore -l <fil> | head` visar när dumpen togs.
Efter övergången till databasroller körs kommandot som `otid_owner` (backuptjänstens användare); kör sedan
`sh deploy/db-roles.sh setup` igen så att rättigheterna gäller också för det återställda.

### Till en ny server

1. Skapa servern och starta O-Tid enligt [Starta](#starta) med **samma** `.env` som den gamla servern (spara den, och
   `OTID_EVENTOR_MASTER_KEY`, utanför servern) men **utan** raderna `OTID_DB_*`: rollerna finns inte än i en ny databas.
   Vänta tills sidan svarar. Databasen är då tom men migrerad.
2. Hämta dumpen till `./backups/` på den nya servern: från din Mac (`scp ~/otid-backup/daily/otid-<datum>.dump
   otid@<ny-server>:otid/backups/`) eller från kopian utanför servern:

   ```bash
   docker compose -f docker-compose.prod.yml run --rm --entrypoint restic backup snapshots
   docker compose -f docker-compose.prod.yml run --rm --entrypoint restic -v ./backups/aterstallt:/aterstallt backup \
     restore latest --target /aterstallt --include /backups/daily
   ls backups/aterstallt/backups/daily/       # dagsbackuperna; flytta den du vill ha till backups/daily/
   ```

3. Återställ som superusern i en tom databas och starta webben:

   ```bash
   docker compose -f docker-compose.prod.yml stop web web-public web-public2 print-worker
   docker compose -f docker-compose.prod.yml exec postgres dropdb -U otid otid
   docker compose -f docker-compose.prod.yml exec postgres createdb -U otid otid
   docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U otid --no-owner -d otid < backups/daily/otid-<datum>.dump
   sh deploy/db-roles.sh setup      # skapar rollerna igen (nya lösenord i .env) och ger dem ägarskap och rättigheter
   docker compose -f docker-compose.prod.yml up -d
   ```

4. Peka DNS-posten på den nya serverns adress (se [Server och domän](#server-och-domän)).

## Arrangörens säkerhetskopia

ADR-0187 ([docs/export.md](export.md)): utöver serverns backup kan arrangören själv ladda ner hela tävlingen under
Inställningar → Säkerhetskopia (bara administratör). Filen (`otid-sakerhetskopia-…zip`) har banor, kartfil, deltagare, brickor,
starttider, avläsningar, resultat och journal, men inga konton, lösenord, sessioner eller Eventor-nycklar. Den ersätter inte
serverns backup: konton, andra tävlingar och behörigheternas historik finns bara i dumpen. Råd till arrangören:

- ladda ner efter lottningen, före start och efter sista målgång (Inställningar visar när den senast laddades ner),
- spara filen på en dator som följer med till tävlingen och utanför servern, och ta bort gamla kopior: **filen innehåller
  personuppgifter, och kopior på arrangörens dator är arrangörens ansvar** (står också på `/integritet`).

**Servern går sönder på tävlingsdagen.** Det går snabbare än att återställa hela databasen när bara en tävling behövs:

1. Starta O-Tid på en annan server (se [Starta](#starta) och [Server och domän](#server-och-domän)), eller använd en annan
   installation som redan finns. Den behöver inte samma `.env`; Eventor-nyckeln klistras in igen.
2. Skapa ett konto (eller logga in) och välj Mina tävlingar → **Återställ tävling från säkerhetskopia**. Välj filen och
   "Kontrollera filen": servern kontrollerar kontrollsummorna och varje rad och visar tävlingen, datum, antal klasser,
   deltagare och avläsningar och formatversionen innan något sparas.
3. "Skapa tävlingen". Det blir en **ny** tävling (nya id, ny kort adress, opublicerad) med samma resultat och sträcktider;
   en befintlig tävling skrivs aldrig över. Med "Ge dem samma behörighet här" får administratörer och funktionärer med konto
   (samma e-post) på servern sin roll igen; övriga räknas upp och läggs till under Personer med behörighet när de har konto.
4. Publicera tävlingen, slå på radiokontrollerna och klistra in Eventor-nyckeln under Inställningar om de användes. Avläsningen
   kopplas till den nya tävlingen (öppna Avläsning i den nya arbetsytan). Det som lästes ut efter att kopian togs finns inte i
   den: läs ut de brickorna igen i den nya tävlingen. Avläsningsdatorns kö (IndexedDB) hör till den gamla tävlingens id och
   skickas **aldrig** till den återställda; inget i den tas bort. Har datorn avläsningar som inte kom fram till den gamla
   tävlingen visar avläsningssidan för den nya tävlingen "Avläsningar till en annan tävling har inte skickats" med bricka och
   tid för var och en och "Ladda ner listan" (Playwright `aterstallning`). Kön finns bara i webbläsaren på samma adress: på en
   ny domän syns den inte alls. Provat på servern (integrationstestet `aterstallning`): skickas den gamla köns sats ändå till
   den återställda tävlingen avvisas den på samma server (`SEQUENCE_CONTEXT_CONFLICT`, enheten finns i den gamla tävlingen);
   på en ny server tas den emot som en ny avläsning av samma bricka (en dubblett i avläsningarna och en ny resultatrevision
   med samma tid och sträcktider).
5. Peka om domänen eller ge funktionärerna den nya adressen.

En kopia med en formatversion som servern inte känner till (gjord med en nyare O-Tid) avvisas med versionen i beskedet:
uppdatera servern och försök igen. Uppladdningen får vara högst 200 MB; Caddy har ingen lägre gräns.

## Databasroller

ADR-0186: före övergången använder alla tjänster databasens superuser (`otid`, `POSTGRES_USER`). Efter den har varje tjänst
bara det den behöver:

| Roll | Tjänster | Får |
| --- | --- | --- |
| `otid_owner` | `migrate`, `backup`, `backup-before-migrate` | äger tabellerna, ändrar schemat, läser allt för dumpen |
| `otid_app` | `web`, `web-public`, `web-public2` | läsa och skriva data, inte ändra schemat |
| `otid_print` | `print-worker` | utskriftskön, tävlingens namn och kartfilen, inget annat |

Superusern finns kvar för `deploy/db-roles.sh` och underhåll för hand. Ingen data flyttas, bara ägare och rättigheter.
Provat 2026-11-02 mot en kopia med data (PostgreSQL 16, 1 286 anmälda och 689 konton): övergången, migrering 0040 som
`otid_owner`, appens vanliga flöden som `otid_app` (registrering, tävling, IOF-import, publicering, borttagning av konto
med tävling), utskriftsarbetaren som `otid_print`, dump som ägaren och återställning, tillbakagång och övergång igen. CI gör
övergången på den körande driftmiljön och kör sedan alla webbläsartester med rollerna.

**Övergången** (på servern, i repots katalog, gärna inte under en tävling):

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build      # den nya versionen, fortfarande som superuser
docker compose -f docker-compose.prod.yml exec backup sh /backup.sh dump  # en dump för säkerhets skull
sh deploy/db-roles.sh setup     # skapar rollerna, lägger OTID_DB_*-raderna i .env, ger ägarskap och rättigheter
sh deploy/db-roles.sh check     # sex rader som börjar med OK
docker compose -f docker-compose.prod.yml up -d                           # tjänsterna byter till rollerna
docker compose -f docker-compose.prod.yml ps                              # alla "running"/"healthy"; migrate och backup-before-migrate "exited (0)"
docker compose -f docker-compose.prod.yml exec postgres psql -U otid -d otid -c \
  "select usename, application_name, count(*) from pg_stat_activity where datname = 'otid' group by 1, 2"
```

Den sista frågan ska visa `otid_app` (otid-web, otid-public), `otid_print` (otid-print-worker) och inga anslutningar från
tjänsterna som `otid`. Logga in och öppna en tävling för att se att allt fungerar. Spärrarnas räknare (inloggning,
registrering) börjar om, eftersom deras hemlighet härleds ur `DATABASE_URL` när `OTID_THROTTLE_SECRET` saknas.

**Tillbaka** (om något inte fungerar): ta bort raderna `OTID_DB_OWNER_*`, `OTID_DB_APP_*` och `OTID_DB_PRINT_*` ur `.env`
och kör `docker compose -f docker-compose.prod.yml up -d`; då använder alla tjänster superusern igen och allt fungerar som
före övergången (superusern når allt oavsett ägare). Vill du också ta bort rollerna: `sh deploy/db-roles.sh rollback`.

Index som byggs med `CREATE INDEX CONCURRENTLY` (ADR-0185) bygger ägarrollen, som äger tabellerna (provat 2026-11-02 med
migration 0038–0040 som `otid_owner` på kopian). En framtida migrering som kräver superuser (t.ex. `CREATE EXTENSION`) misslyckas i `migrate`; kör den då för hand med
`docker compose -f docker-compose.prod.yml exec postgres psql -U otid -d otid`. Det står i så fall i STATUS.md.

## Om en migrering misslyckas

Tjänsten `migrate` migrerar databasen innan webben startar (`node migrate.mjs`, ADR-0186; före det gjorde webben det själv).
Varje migrering körs i en egen transaktion, så en som misslyckas lämnar inga halva ändringar; den nya webben startar inte,
och den gamla kör vidare om den var igång (annars svarar sidan 502). En dump togs strax före (`./backups/fore-migrering/`).

1. Läs felet: `docker compose -f docker-compose.prod.yml logs --tail=100 migrate`.
2. Gå tillbaka till förra versionen, som fungerade med databasen:

   ```bash
   git log --oneline -5                  # hitta förra versionen
   git checkout <förra-commit>
   docker compose -f docker-compose.prod.yml build
   docker compose -f docker-compose.prod.yml up -d
   ```

3. Startar den inte heller (en tidigare migrering i samma uppdatering hann köras): återställ dumpen i
   `./backups/fore-migrering/` enligt [Återställa](#återställa), med förra versionen igång.
4. Skicka felet till den som driver O-Tid. När det är rättat: `git checkout main`, `git pull`, bygg och starta igen.

## Prova driftuppsättningen lokalt

Sätt `OTID_DOMAIN=localhost` i `.env`. Caddy ger då ett lokalt certifikat.
Kör sedan webbläsartesterna mot den körande miljön:

```bash
E2E_BASE_URL=https://localhost pnpm test:e2e
```

CI-jobbet `production` gör samma sak vid varje push.

## Export av en tävling

Inställningar → "Exportera tävlingen" ger en JSON-fil med allt om loppet, för att spara efter tävlingen
(format i `docs/export.md`). Databasens backup är fortfarande den som gäller för hela servern.
