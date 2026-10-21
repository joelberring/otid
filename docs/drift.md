# Drift

O-Tid körs med `docker-compose.prod.yml` på en vanlig VPS:

- PostgreSQL 17 (den officiella bilden `postgres:17`, finns för både x86 och ARM),
- webben (Next standalone, migrerar databasen vid start),
- Caddy (HTTPS med Let's Encrypt),
- en backuptjänst.

All data, även kartbilder och GPS-rutter för vägval (PLAN.md steg 16), ligger i PostgreSQL och kommer
med i den nattliga backupen. MinIO behövs inte.

## Starta

Krav: en Linux-server (x86 eller ARM) med Docker och Compose (1 vCPU och 1–2 GB minne räcker
till en klubbträning; att bygga webben på servern kräver omkring 2 GB). Du behöver också ett domännamn vars A/AAAA-post pekar
på servern (se [Server och domän](#server-och-domän)). Portarna 80 och 443 ska vara öppna.

```bash
git clone https://github.com/joelberring/otid.git && cd otid
cp deploy/prod.env.example .env      # fyll i OTID_DOMAIN och POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up -d --build
```

Öppna `https://<OTID_DOMAIN>/organizer` och skapa det första kontot (e-post, namn och lösenord).
Gör sedan dig själv till superadmin (se nedan).

**Uppdatera:**

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build
```

Webben kör nya migreringar innan den startar. Om en migrering misslyckas
startar webben inte. Läs då `docker compose -f docker-compose.prod.yml logs web`.

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

Tjänsten `backup` tar en `pg_dump` direkt vid start och sedan varje natt kl.
02 UTC. Filerna hamnar i `./backups/otid-<tid>.dump`, och filer äldre än 14
dagar tas bort. Ett misslyckat försök loggas som `BACKUP MISSLYCKADES` i
`docker compose -f docker-compose.prod.yml logs backup`.

Kopiera katalogen `backups/` till en annan maskin regelbundet, till exempel
med `rsync` från din dator. En backup på samma server skyddar inte mot att
servern försvinner.

## Återställa

Provat lokalt 2026-10-03: dump och återställning gav samma antal deltagare,
resultatrevisioner och råavläsningar. Så här gör du:

```bash
docker compose -f docker-compose.prod.yml stop web
docker compose -f docker-compose.prod.yml exec -T backup \
  pg_restore --clean --if-exists --no-owner -d otid /backups/otid-<tid>.dump
docker compose -f docker-compose.prod.yml start web
```

För att återställa på en ny server: starta enligt ovan, kopiera filen till
`./backups/` och kör kommandona.

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
