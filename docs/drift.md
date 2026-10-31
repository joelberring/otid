# Drift

O-Tid körs med `docker-compose.prod.yml` på en vanlig VPS:

- PostgreSQL 17 (den officiella bilden `postgres:17`, finns för både x86 och ARM),
- webben (Next standalone) i två slags instanser (steg 54, [ADR-0177](adr/ADR-0177-tavlingen-forst.md)):
  - `web` – tävlingen: arbetsytan, avläsningen, funktionärerna, inloggningen och admin-API:t. Migrerar databasen vid start
    och hämtar radiostämplingar.
  - `web-public` och `web-public2` – publiken: publika sidor och API:er, Live och resultatströmmen. Två, eftersom en
    Node-process bara använder en kärna (steg 51). Startar när `web` har migrerat.
  Se [Tävlingen först](#tävlingen-först),
- Caddy (HTTPS med Let's Encrypt, skickar publika anrop till `web-public`/`web-public2` och allt annat till `web`),
- en backuptjänst.

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
docker compose -f docker-compose.prod.yml exec backup sh /backup.sh dump   # dump före uppdateringen
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Webben kör nya migreringar innan den startar. Om en migrering misslyckas startar webben inte, och sidan svarar
502 (se [Om en migrering misslyckas](#om-en-migrering-misslyckas)).

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
  `web-public` och `web-public2` och 128 för backupen. Vikterna gäller bara när processorn inte räcker till alla: då går
  tävlingen och databasen före publiken. Annars får publiken all ledig tid.
- **Minne (CX23, 4 GB):** `postgres` 1 GB, `web` 1 GB (Node 768 MB), `web-public` och `web-public2` 768 MB var (Node
  512 MB), Caddy och backupen 192 MB var. Summan 3,9 GB; swappen räcker till bygget.
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
detsamma oavsett om adressen har ett konto. Lägg till i `.env` och starta om:

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

Tjänsten `backup` (`deploy/backup.sh`) tar en `pg_dump` direkt vid start och sedan varje hel timme kl. 08–23 svensk
tid (steg 45; tidigare bara en gång per natt). Den kör hela tiden, så på tävlingsdagen finns det högst en timme gammal
dump.

- `./backups/hourly/otid-<tid>.dump`: de 48 senaste timdumparna.
- `./backups/daily/otid-<datum>.dump`: dagens senaste dump, sparad i 14 dagar.
- En dump skrivs först till en dold fil (`.….partial`) och byter namn när `pg_dump` är klar, så en avbruten dump ser
  aldrig ut som en hel.
- Ett misslyckat försök loggas som `BACKUP MISSLYCKADES` i `docker compose -f docker-compose.prod.yml logs backup` och
  görs om nästa timme.

Tiderna och antalen ställs in i `docker-compose.prod.yml` (`TZ`, `BACKUP_FIRST_HOUR`, `BACKUP_LAST_HOUR`,
`BACKUP_KEEP_HOURLY`, `BACKUP_KEEP_DAYS`). Dumpar från före steg 45 ligger kvar direkt i `./backups/` och tas inte bort
av tjänsten.

**Dump nu** (före och efter ett arrangemang, och före en uppdatering):

```bash
docker compose -f docker-compose.prod.yml exec backup sh /backup.sh dump
```

Kommandot skriver `Backup klar: hourly/otid-<tid>.dump` och avslutas med fel om dumpen misslyckades.

**Kopiera till din Mac.** En backup på samma server skyddar inte mot att servern försvinner (eller raderas efter
tävlingen). Kör på din Mac, med serverns adress och användare:

```bash
mkdir -p ~/otid-backup
scp 'otid@tid.exempelklubb.se:otid/backups/daily/*.dump' ~/otid-backup/       # dagsbackuperna
scp 'otid@tid.exempelklubb.se:otid/backups/hourly/*.dump' ~/otid-backup/      # alla timdumpar
# eller allt på en gång, och bara det som är nytt:
rsync -av otid@tid.exempelklubb.se:otid/backups/ ~/otid-backup/
```

Gör det efter varje arrangemang, och alltid innan en server som betalas per timme raderas.

## Återställa

Provat lokalt 2026-10-03: dump och återställning gav samma antal deltagare,
resultatrevisioner och råavläsningar. Så här gör du:

```bash
docker compose -f docker-compose.prod.yml stop web web-public web-public2
docker compose -f docker-compose.prod.yml exec -T backup \
  pg_restore --clean --if-exists --no-owner -d otid /backups/daily/otid-<datum>.dump
docker compose -f docker-compose.prod.yml start web web-public web-public2
```

Välj en fil i `/backups/hourly/` för en senare tidpunkt samma dag. `pg_restore -l <fil> | head` visar när dumpen
togs. För att återställa på en ny server: starta enligt ovan, kopiera filen från din Mac till serverns `./backups/`
(`scp ~/otid-backup/otid-<datum>.dump otid@<server>:otid/backups/`) och kör kommandona med `/backups/otid-<datum>.dump`.

## Om en migrering misslyckas

Webben migrerar databasen innan den startar (`node migrate.mjs` i `Dockerfile`). Varje migrering körs i en egen
transaktion, så en som misslyckas lämnar inga halva ändringar, men webben startar inte och sidan svarar 502.

1. Läs felet: `docker compose -f docker-compose.prod.yml logs --tail=100 web`.
2. Gå tillbaka till förra versionen, som fungerade med databasen:

   ```bash
   git log --oneline -5                  # hitta förra versionen
   git checkout <förra-commit>
   docker compose -f docker-compose.prod.yml build
   docker compose -f docker-compose.prod.yml up -d
   ```

3. Startar den inte heller (en tidigare migrering i samma uppdatering hann köras): återställ dumpen som togs före
   uppdateringen enligt [Återställa](#återställa), med förra versionen igång.
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
