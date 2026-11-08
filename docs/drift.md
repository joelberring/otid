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
- en backuptjänst (dump varje timme, valfri krypterad kopia utanför servern) och hälsokontrollen `monitor` (ADR-0186),
- serverns bevakning i `web` (ADR-0216): veckorapport och larm till superadmin per e-post (se
  [Serverrapport och larm](#serverrapport-och-larm)).

All data, även kartbilder, kartfiler från OCAD och Mapper (steg 59, högst 75 MB per tävling) och GPS-rutter för vägval
(PLAN.md steg 16), ligger i PostgreSQL och kommer med i backupen. MinIO behövs inte. Kartfilens uppladdning är den enda
stora bodyn; `deploy/Caddyfile` tillåter 110 MB för just den sökvägen.

## Starta

Krav: en Linux-server (x86) med Docker och Compose (1 vCPU och 1–2 GB minne räcker till en klubbträning; servern bygger
inget själv, se [Uppdatera](#uppdatera)). Du behöver också ett domännamn vars A/AAAA-post pekar på servern (se
[Server och domän](#server-och-domän)). Portarna 80 och 443 ska vara öppna.

```bash
git clone https://github.com/joelberring/otid.git && cd otid
cp deploy/prod.env.example .env      # fyll i OTID_DOMAIN och POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Öppna `https://<OTID_DOMAIN>/organizer` och skapa det första kontot (e-post, namn och lösenord).
Gör sedan dig själv till superadmin (se nedan).

## Uppdatera

ADR-0195: GitHub Actions bygger webben och backupen när CI är grön för en push till `main` (arbetsflödet `Avbildningar`,
`.github/workflows/images.yml`) och lägger dem i GitHub Container Registry som publika paket, så servern behöver ingen
inloggning:

- `ghcr.io/joelberring/otid-web` och `ghcr.io/joelberring/otid-backup`, var och en med taggarna `<sha>` (hela
  commit-sha:n), `<kort sha>` (7 tecken) och `main` (den senaste gröna på `main`). Bara linux/amd64 (servern är x86).
- De finns omkring **25 minuter** efter en push till `main`: CI tar 17–19 minuter och bygget av avbildningarna några till.
  Se Actions → Avbildningar, eller `docker manifest inspect ghcr.io/joelberring/otid-web:<kort sha>` på servern.
- Inget serverspecifikt byggs in: domänen, lösenorden och `NEXT_PUBLIC_INTRO_FILM_URL` läses från `.env` när tjänsterna
  startar, så samma avbildning fungerar på alla servrar.
- Paketen ska vara publika. Ett nytt paket på ghcr.io är privat; efter den första publiceringen ändrar repots ägare det en
  gång för vart och ett av `otid-web` och `otid-backup`: GitHub → profilen → Packages → paketet → Package settings → Change
  visibility → Public. (`docker compose ... pull` svarar annars `unauthorized` eller `denied`.)

```bash
git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

`git pull` behövs fortfarande: compose-filen, `deploy/Caddyfile` och skripten i `deploy/` kommer från repot, och de ska höra
ihop med avbildningen. Med förvalet (`OTID_TAG` tom eller `main`) hämtar `pull` den senaste gröna avbildningen från `main`;
kör alltså uppdateringen först när arbetsflödet `Avbildningar` för den commit du drog ned är klart, annars får du förra
versionens avbildning med den nya compose-filen. `pull` krävs: `up -d` ensam byter inte en avbildning som redan finns på
servern.

**Ändrad `deploy/Caddyfile`:** `up -d` startar inte om Caddy när bara Caddyfile har ändrats, och Caddy ser inte den nya filen
(den är monterad som en enskild fil, och `git pull` skriver en ny fil i stället för att ändra den gamla, så `caddy reload` i
behållaren läser fortfarande den gamla). Kör därför efter uppdateringen:

```bash
docker compose -f docker-compose.prod.yml restart caddy
```

Det tar någon sekund och är ofarligt även när filen inte ändrats; `git diff --stat ORIG_HEAD HEAD -- deploy/Caddyfile` efter
`git pull` visar om den gjort det.

ADR-0186: `up` tar först en dump (`./backups/fore-migrering/`, de 10 senaste sparas) och kör sedan nya migreringar i tjänsten
`migrate`; först därefter startas den nya webben. Misslyckas dumpen eller en migrering fortsätter den gamla webben att köra
(se [Om en migrering misslyckas](#om-en-migrering-misslyckas)); `docker compose -f docker-compose.prod.yml logs backup-before-migrate migrate`
visar varför. Det gäller likadant med hämtade avbildningar.

**Låsa versionen (inför en tävling):** sätt den commit som ska köras i `.env`, så ändrar inget `pull` den förrän du ändrar
raden. Ingen driftsättning på en tävlingsdag (AGENTS.md, ADR-0178):

```bash
git log --oneline -1                  # t.ex. a1b2c3d
echo "OTID_TAG=a1b2c3d" >> .env       # kort eller hel sha; en sha som Avbildningar har publicerat
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

Ta bort raden (eller sätt `OTID_TAG=main`) efter tävlingen för att följa `main` igen.

**Tillbaka till förra versionen:** sätt `OTID_TAG=<förra sha>` i `.env` (`git log --oneline -5` visar dem) och kör
`docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`. Repot behöver inte
backas så länge `docker-compose.prod.yml`, `deploy/Caddyfile` och `deploy/*.sh` inte ändrats mellan versionerna
(`git diff --stat <förra sha> HEAD -- docker-compose.prod.yml deploy` visar det); annars även `git checkout <förra sha>`, men
aldrig till en commit före ADR-0195 (den compose-filen använder inte `OTID_TAG`). En äldre version kan inte ta bort en
migrering som redan har körts; den fungerar så länge migreringarna bara lagt till (AGENTS.md, ADR-0185). Se
[Om en migrering misslyckas](#om-en-migrering-misslyckas). Tillbaka till `main`: ta bort raden (och `git checkout main`)
och uppdatera.

### Bygga på servern (reserv)

Om GitHub Actions eller ghcr.io inte fungerar kan servern bygga själv som förut. Sätt lokala namn i `.env`, så används
inget från ghcr.io och `build` taggar avbildningarna med de namnen (kör inte `pull` då):

```bash
printf 'OTID_IMAGE=otid-web\nOTID_BACKUP_IMAGE=otid-backup\nOTID_TAG=local\n' >> .env
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

Bygg först och starta sedan (steg 45): då körs den gamla webben vidare medan den nya byggs, och ett misslyckat bygge stoppar
ingenting. Ta bort de tre raderna för att gå tillbaka till de färdiga avbildningarna. Docker-bygget hoppar över
typkontrollen (CI gör den; `OTID_SKIP_BUILD_CHECKS` i `Dockerfile`) och sparar pnpm:s paket och Nexts byggcache mellan
byggen (BuildKit-cache, försvinner med `docker builder prune`). Uppmätt 2026-11-03 (2 vCPU, bara `next build`): första
bygget tar omkring 1,5 minut med en topp på 2,7 GB under några sekunder i slutet av kompileringen (förut 2,5 minuter och
dessutom 2,2–2,3 GB i en minut medan typerna kontrollerades); nästa bygge med cachen 15 sekunder och 1,2 GB. På en server
med 4 GB där databasen och webben redan använder 1–1,5 GB räcker det inte utan swap; lägg till 3 GB:

```bash
sudo fallocate -l 3G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h                               # Swap ska visa 3,0Gi
```

Samma sätt gäller en ARM-server (CAX11, Oracle): de färdiga avbildningarna finns bara för x86.

## Loggar och äldre övergångar

Loggarna begränsas till fem filer på 10 MB per tjänst (`logging` i `docker-compose.prod.yml`), så de fyller inte disken.

**Färdiga avbildningar (ADR-0195, 2026-11):** första gången efter att ändringen kommit till `main` och arbetsflödet
`Avbildningar` är klart: `git pull`, kontrollera att `.env` inte har `OTID_IMAGE`/`OTID_TAG`, kör sedan `pull` och `up -d` som
i [Uppdatera](#uppdatera). Webbens tjänster startas om på den hämtade avbildningen (med dump och migrering först, som vanligt).
När allt fungerar kan de gamla lokala avbildningarna och byggcachen tas bort: `docker image rm otid-web otid-backup` och
`docker builder prune`.

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
  `/fest/…`, `/g/…`, `/kartfel/…`, `/api/public/…`, den publika startlistan, Nexts statiska filer, ikonerna och manifestet;
  listan är `PUBLIC_PATHS` i `apps/web/src/lib/public-paths.ts`, och ett test kräver att Caddyfile har samma) går till `web-public` eller `web-public2`
  (färst pågående anrop; svarar den ena inte prövas den andra) för den som inte är inloggad. Allt annat, och allt för
  den som är inloggad (arrangörer och funktionärer, även speakern och de publika sidorna), går till `web`. Varje instans
  klarar alla sökvägar: lokalt och med `pnpm dev` finns bara en (`OTID_INSTANCE_ROLE` saknas, `all`).
- **Processortid:** `cpu_shares` i `docker-compose.prod.yml` är 1024 för `postgres`, `web` och Caddy, 256 för var och en av
  `web-public` och `web-public2`, 128 för backupen och 64 för utskriftsarbetaren (`print-worker`, steg 65, som dessutom
  kör med nice 19). Vikterna gäller bara när processorn inte räcker till alla: då går
  tävlingen och databasen före publiken. Annars får publiken all ledig tid.
- **Minne (CX23, 4 GB):** `postgres` 1 GB, `web` 1 GB (Node 768 MB), `web-public` och `web-public2` 640 MB var (Node
  448 MB), utskriftsarbetaren 640 MB (huvudprocessen 96 MB, varje jobb i en barnprocess med 256 MB; 300 kartor per löpare
  på Högdalen 2026 tog 130 MB; ADR-0219 K2: ett kartjobb åt AI-kopplingen kan köras samtidigt i en egen barnprocess med
  256 MB), Caddy och backupen 192 MB var, hälsokontrollen 64 MB. Summan 4,4 GB (taken är gränser, inte reserverat minne;
  kartjobben är korta och sällsynta). Servern bygger inget (ADR-0195); bygger den ändå (reserv) behövs swap, se
  [Bygga på servern](#bygga-på-servern-reserv).
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

O-Tid behöver en liten Linux-server med Docker. De färdiga avbildningarna för webben och backupen (ADR-0195) finns för
x86; `postgres:17` och Caddy finns för både x86 och ARM, så en ARM-server fungerar om den bygger webben själv
([reserv](#bygga-på-servern-reserv); inte provat på en ARM-server ännu). Priserna är ungefärliga
(oktober 2026):

| Alternativ | Vad | Att tänka på |
| --- | --- | --- |
| Hetzner CX23 | 2 vCPU (x86), 4 GB, ≈6 €/mån | Betalas per timme: skapa servern före tävlingen och radera den efteråt (spara `backups/` först). |
| Hetzner CAX11 | 2 vCPU (ARM), 4 GB, ungefär samma pris | Som CX23, men ARM. |
| Oracle Cloud Always Free | ARM (Ampere), upp till 4 vCPU och 24 GB, gratis | Region Stockholm finns. Registreringen kan nekas, och ledig ARM-kapacitet saknas ibland. |
| Google Cloud e2-micro | 2 delade vCPU, 1 GB, gratis | Bara amerikanska regioner. Räcker med de färdiga avbildningarna; för att bygga på servern räcker 1 GB inte. |
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

### Klubblistan och klubbytornas koppling (ADR-0209)

Klubblistan (Eventors förbund, distrikt och klubbar) används när man väljer klubb, arrangörsklubb och i klubbytan. Hämta den
med en klubbs API-nyckel från Eventor (en klubbadministratör skapar den i Eventor; den är hemlig och ska aldrig committas):

```bash
echo "OTID_EVENTOR_API_KEY=<klubbens nyckel>" >> .env
docker compose -f docker-compose.prod.yml up -d web
docker compose -f docker-compose.prod.yml exec web node superadmin.mjs clubs refresh
```

Eventor ber om högst en hämtning per dygn; kommandot vägrar annars (`--force` bara vid behov). Lägg det gärna i cron en gång
per natt. Utan `OTID_EVENTOR_API_KEY` används en nyckel som ett klubbarkiv har sparat med "Koppla till Eventor". En lista
hämtad på annat sätt läses in med `clubs import <fil.xml>` (eller `clubs import -` med filen på stdin, t.ex.
`... exec -T web node superadmin.mjs clubs import - < organisationer.xml`). `OTID_EVENTOR_BASE_URL` gäller också här (bara test).

Klubbytornas koppling ("Koppla till Eventor") och medlemslistorna kräver `OTID_EVENTOR_MASTER_KEY` ovan: klubbens nyckel sparas
krypterad med den, och e-posthasharna räknas med en nyckel härledd ur den. Byts masternyckeln behöver klubbytorna lägga in sin
nyckel igen, och nästa hämtning räknar om hasharna. Medlemslistorna hämtas i underhållet en gång per dygn;
`node superadmin.mjs clubs sync` gör samma sak direkt. Har fel klubbyta kopplats till en klubb och dess ägare inte svarar:
`node superadmin.mjs clubs unlink <Eventors organisations-id>` tar bort kopplingen, så att rätt klubbyta kan koppla med nyckeln.

## Spärrar mot upprepade försök

Inloggning, registrering, återställning av lösenord och självregistrering räknas per IP-adress (och e-post eller tävling).
Adresserna sparas bara som HMAC med en hemlighet: `OTID_THROTTLE_SECRET` om den finns i `.env`, annars härleds den ur
`DATABASE_URL` (databasens lösenord), så en befintlig server behöver inte ändras. Vill du ha en egen hemlighet:

```bash
echo "OTID_THROTTLE_SECRET=$(openssl rand -base64 32)" >> .env
docker compose -f docker-compose.prod.yml up -d
```

Ett byte nollställer bara räknarna. Raderna tas bort efter två dygn.

ADR-0189: fem felaktiga inloggningar spärrar adressen bara från den IP-adressen i 15 minuter (och 30 fel från en IP-adress
spärrar den IP-adressen), så ingen kan låsa ute en funktionär från en annan adress. Gruppsidan (`/g/<kod>`) svarar "För många
försök" efter 30 missade koder i timmen från samma IP-adress. Bakom Caddy är IP-adressen klientens (`X-Forwarded-For`).

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

Superadmin får också serverns veckorapport och larm per e-post (ADR-0216, [Serverrapport och larm](#serverrapport-och-larm)).

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

(ett lösenordsbyte med en återställningslänk från superadmin bekräftar också adressen).

ADR-0205 (ändrar ADR-0186): bekräftelselänken kräver inte lösenordet från registreringen. Den bevisar att personen har
adressen, och på sidan väljer personen lösenordet (två gånger). Återställningslänken fungerar alltid, också för ett konto
som aldrig bekräftades: den bekräftar adressen och loggar in där den öppnades. Ett nytt lösenord häver inloggningsspärren
för adressen. Den som har skrivit fel lösenord vid registreringen kommer alltså in med vilken av länkarna som helst.

Lägg till e-post i `.env` och starta om:

```bash
OTID_SMTP_URL=smtp://användare:lösenord@smtp.exempelklubb.se:587   # STARTTLS; eller smtps://…:465
OTID_MAIL_FROM=O-Tid <noreply@exempelklubb.se>
```

Utan `OTID_SMTP_URL` säger sidan "Glömt lösenordet" att man ska kontakta den som driver O-Tid. Superadmin
skapar då en länk på `/superadmin` (Konton → Återställningslänk) och ger den till personen. Länken visas
en gång. En felaktig inställning stänger av e-posten och skrivs i `logs web` (utan lösenord eller adresser).

ADR-0206: med e-post mejlas också inbjudningar (klubbarkivets medlemmar, Personer med behörighet och träningsgruppernas
ledare och medlemmar) med en länk som gäller 14 dagar; listan visar när de skickades och har "Skicka igen". Spärrar: högst
100 inbjudningar per avsändare och timme (300 per dygn) och 3 per mottagare och timme (10 per dygn). Mejl som inte gick iväg
skrivs i `logs web` som "Inbjudan kunde inte skickas (kod)" utan adress eller länk. **Utan e-post** sparas inbjudningarna som
förut och listan har "Kopiera länken", så att administratören kan skicka länken själv.

`OTID_CONTACT_EMAIL` (valfri, förval otid@berring.se) visas på sidan om personuppgifter (`/integritet`) och på "Glömt lösenordet".
Adressen för frågor om programmet (sidfoten, Om O-Tid och Hjälp) är fast i `apps/web/src/lib/contact.ts`.
`NEXT_PUBLIC_INTRO_FILM_URL` (valfri) är adressen till en kort film om O-Tid. När den är satt visar startsidan länken
"Se vad O-Tid kan (film, 1 min)" längst ned; tom eller osatt = ingen länk. Bara `https://`/`http://`-adresser eller en sökväg
på samma värd (`/…`) godtas, annars visas ingen länk. Värdet läses när sidan visas (inte när avbildningen byggs), så det räcker
att ändra `.env` och köra `docker compose -f docker-compose.prod.yml up -d`; `web` och `web-public` får det båda.
Filmen kan ligga på servern: lägg filen i mappen `media/` bredvid `docker-compose.prod.yml` (`mkdir -p media`, sedan t.ex.
`scp otid-intro.mp4 root@servern:/root/otid/media/`) och sätt `NEXT_PUBLIC_INTRO_FILM_URL=/media/otid-intro.mp4`. Caddy visar
`media/` skrivskyddat under `/media/` (med spolning). Mappen är inte med i git eller i säkerhetskopian; den första gången behövs
`docker compose -f docker-compose.prod.yml up -d caddy` så att mappen monteras.
`OTID_REGISTRATION_LIMIT_PER_HOUR` (valfri, förval 10) är hur många konton som får skapas per IP-adress och timme.

Endast test: CI pekar `OTID_SMTP_URL` mot en falsk SMTP-server på värden (`tests/e2e/fake-smtp.ts`), på samma
sätt som `OTID_EVENTOR_BASE_URL`. Appen har ingen särskild testväg för e-post.

## Inloggning med Google

ADR-0205: med en OAuth-klient från Google visar inloggningen och registreringen "Logga in med Google" (OpenID Connect med
PKCE, `state` och `nonce`; ID-token kontrolleras mot Googles nycklar). Bara adresser som Google har bekräftat godtas. Finns ett
konto med samma adress kopplas Google till det och adressen blir bekräftad; annars skapas ett konto. Ett spärrat konto förblir
spärrat. Utan variablerna syns ingen knapp, och allt annat fungerar som förut.

Skapa klienten i Google Cloud Console (en gång):

1. Gå till <https://console.cloud.google.com/>, välj eller skapa ett projekt (t.ex. "O-Tid").
2. **APIs & Services → OAuth consent screen** (i nyare konsol: **Google Auth Platform → Branding/Audience**): välj
   **External**. Fyll i appens namn (O-Tid), supportadress och utvecklarens kontaktadress. Under **Authorized domains**:
   `berring.se`. Lägg gärna in länken till `https://otid.berring.se/integritet` som integritetspolicy.
3. **Scopes (Data Access)**: lägg till `openid`, `.../auth/userinfo.email` (email) och `.../auth/userinfo.profile` (profile).
   Inga andra behövs, och de kräver ingen granskning av Google.
4. **Audience / Publishing status**: tryck **Publish app** (In production). I läget Testing kan bara de testanvändare du
   lagt in logga in.
5. **Credentials → Create credentials → OAuth client ID**: typ **Web application**, namn "O-Tid". Under
   **Authorized redirect URIs**: `https://otid.berring.se/api/account/google/callback` (exakt, med https och utan snedstreck
   sist; den följer `O_TID_PUBLIC_ORIGIN`). **Authorized JavaScript origins** behövs inte.
6. Kopiera **Client ID** och **Client secret** till `.env` på servern och starta om:

```bash
OTID_GOOGLE_CLIENT_ID=123456789012-abc….apps.googleusercontent.com
OTID_GOOGLE_CLIENT_SECRET=GOCSPX-…
docker compose -f docker-compose.prod.yml up -d
```

Hemligheten är bara serverns (aldrig `NEXT_PUBLIC_`) och följer inte med i säkerhetskopian. Är bara en av variablerna satt
skriver `logs web` ett `KONFIGURATIONSFEL` och ingen knapp visas. Koppling: tabellen `user_account_google_identity`
(migration 0072) håller Googles `sub` per konto. Den som loggar in med Google och vill ha ett lösenord väljer ett med
"Glömt lösenordet".


### Två konton efter Google-inloggningen (Koppla Google-konto)

Har Google-kontot en annan adress än kontot i O-Tid skapar "Logga in med Google" ett nytt konto med Google-adressen. Personen
rättar det själv: logga in med e-postadressen och lösenordet, öppna Mitt konto och tryck på "Koppla Google-konto". Är det andra
kontot tomt (inga tävlingar, behörigheter, klubbar, grupper, arkivinnehåll eller banläggningsändringar) visar O-Tid vad som händer
och flyttar kopplingen när personen bekräftar med lösenordet; det tomma kontot tas bort och syns i superadmins logg. Används det
andra kontot vägras kopplingen. Då, eller när personen inte själv kan, flyttar superadmin kopplingen på servern:

```bash
docker compose -f docker-compose.prod.yml exec web node superadmin.mjs google move joel.exempel@gmail.com joel@exempelklubb.se
docker compose -f docker-compose.prod.yml exec web node superadmin.mjs google move joel.exempel@gmail.com joel@exempelklubb.se --delete-source-if-empty
```

Första adressen är Googles adress eller källkontots adress, den andra målkontots. Kommandot skriver bara antal och adresser. Utan
flaggan står källkontot kvar utan Google-koppling; med `--delete-source-if-empty` tas det bort om det är tomt (loggas som
"Serverkommando"), annars står det kvar och kommandot säger hur många rader som pekar på det. Lokalt:
`pnpm account:superadmin google move <källa> <mål>`.

Inloggningen gäller 30 dygn bara med "Kom ihåg mig på den här datorn"; annars tolv timmar och en sessionskaka. "Logga ut från
alla enheter" under Mitt konto spärrar alla kontots inloggningar.

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

- `./backups/hourly/otid-<tid>.dump`: de 24 senaste timdumparna (ett dygn; ADR-0216, tidigare 48).
- `./backups/daily/otid-<datum>.dump`: dagens senaste dump, sparad i 14 dagar.
- `./backups/map-content/<id>.copy` (ADR-0216): kartfilerna och kartbilderna (`map_content_part`), **en fil per innehåll**. De
  ändras aldrig, så de sparas en gång i stället för i varje dump; dumparna har bara tabellens struktur. Bredvid varje dump står
  `<dump>.contents` med innehållen den pekar på, och en fil tas bort först när varken databasen eller någon sparad dump pekar på
  den. Hinner ett innehåll tas bort under dumpen tas dumpen om med kartinnehållet i, så varje dump går att återställa.
- Inte med i dumparna (går att skapa igen): utskriftsjobbens PDF:er (steg 65) och klubbarkivets miniatyrer och kartkontroller
  (`club_archive_entry_thumbnail`, `club_map_version_check`; ADR-0196 – de ritas om i en administratörs webbläsare när
  klubbarkivet öppnas, högst sex kartversioner per besök).
- `./backups/.backup-status`: resultatet av senaste körningen (läses av serverns bevakning).
- En dump skrivs först till en dold fil (`.….partial`) och byter namn när `pg_dump` är klar, så en avbruten dump ser
  aldrig ut som en hel.
- Ett misslyckat försök loggas som `BACKUP MISSLYCKADES` i `docker compose -f docker-compose.prod.yml logs backup` och
  görs om nästa timme. Med bevakning (nedan) får du också ett mejl.

Intervallet och antalen ställs in i `.env` (`BACKUP_INTERVAL_MINUTES`, förval 60; `BACKUP_KEEP_HOURLY`, förval 24;
`BACKUP_KEEP_DAYS`, förval 14). Före ADR-0216 hade varje dump alla kartfiler, så 48 + 14 dumpar tog 62 gånger kartornas storlek;
nu tar kartinnehållet sin storlek en gång. Gamla timdumpar (med kartinnehållet i) gallras som vanligt inom ett dygn efter
uppdateringen och dagsbackuperna inom 14 dagar; de går att återställa precis som förut.
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

## Serverrapport och larm

ADR-0216: `web` (tävlingens instans) mäter servern var 15:e minut (`OTID_HEALTH_INTERVAL_MINUTES`) och mejlar kontona med
**superadmin** (systemrollen, se [Superadmin](#superadmin); spärrade konton får inget) med den vanliga e-posten (`OTID_SMTP_URL`).
Utan e-post skrivs larmen och rapporten i `logs web` i stället. Inget behöver läggas till i `.env`: allt har förval, och efter
den vanliga uppdateringen (`git pull`, `pull`, `up -d`) ser `web` säkerhetskopiorna (`./backups`, skrivskyddat) och
hälsokontrollens resultat (`./status/monitor.log`, som `monitor` skriver). Katalogen `./status` skapas av Docker vid `up -d`.

**Veckorapporten** går söndag kl. 19 (svensk tid). Den första går söndagen efter uppdateringen (en ny version mejlar inte mitt i
veckan), och den skickas inte två gånger efter en omstart (tiden sparas i databasen, migration 0085). Innehåll:

- disken: använt, ledigt och **prognosen**: tillväxten per vecka (ur mätningarna de senaste fyra veckorna) och ungefär hur
  många veckor det är kvar till full disk med den takten, med ett råd om större disk behövs,
- kartornas kvot (`OTID_MAP_QUOTA_TOTAL_MB`) och om den ryms på disken (varje GB kartor tar ungefär 2 GB: databasen och
  säkerhetskopiornas kartinnehåll),
- databasens storlek uppdelad: kartfiler och kartbilder, bilder och miniatyrer, utskrifter och resten,
- säkerhetskopiornas totala storlek (dumpar och kartinnehåll) och senaste dump,
- antal konton (nya senaste veckan), klubbar och tävlingar, och tävlingarna de kommande 14 dagarna (antal, publicerade,
  anmälda; inga namn),
- larm och "löst" senaste veckan och hur många hälsokontroller som misslyckades,
- belastningens topp (1 minut, mätt varje minut; 2 = båda kärnorna fullt använda) och minst ledigt minne.

Se rapporten som den ser ut just nu (skickar och sparar inget):
`docker compose -f docker-compose.prod.yml exec web node superadmin.mjs server-report`.

**Larm** (ett mejl per varv med alla nya larm och "löst"): högst ett larm per sort och dygn (står problemet kvar kommer en
påminnelse efter ett dygn) och ett "löst" när problemet har gått över, om det larmades.

| Sort | Larmar när | Inställning (förval) |
|---|---|---|
| Disken | fullare än gränsen (samma som hälsokontrollens df) | `OTID_DISK_ALERT_PERCENT` (80) |
| Kartornas kvot | kartorna tar minst så stor del av `OTID_MAP_QUOTA_TOTAL_MB` | `OTID_MAP_QUOTA_ALERT_PERCENT` (90) |
| Säkerhetskopian | senaste körningen misslyckades, ingen dump finns eller den senaste är äldre än gränsen | `OTID_BACKUP_ALERT_HOURS` (3) |
| Hälsokontrollen | `monitor` har misslyckats tre gånger i rad (webben, databasen, publiken, utskriftskön) eller inte rapporterat på en timme | – |
| Minnet | mindre ledigt minne (MemAvailable, hela servern) än gränsen | `OTID_MEMORY_ALERT_PERCENT` (10) |

Disken och säkerhetskopian larmar bara här, inte också som "hälsokontrollen". Går hela servern eller `web` ner kan inget mejlas:
det fångar bevakningstjänsten (OTID_HEARTBEAT_HEALTH_URL, [Bevakning](#bevakning-valfri)).

Valfritt i `.env` (sedan `docker compose -f docker-compose.prod.yml up -d`): `OTID_SERVER_REPORT_DAY` (1 = måndag … 7 = söndag) och
`OTID_SERVER_REPORT_HOUR` (0–23); `OTID_SERVER_REPORT=off` stänger av rapporten, `OTID_SERVER_ALERTS=off` larmen och
`OTID_SERVER_WATCH=off` hela bevakningen. Ett ogiltigt värde skrivs som KONFIGURATIONSFEL i `logs web` och förvalet används.

**Disken** (ägarens fråga "ska jag köpa större disk redan nu?"): svaret står i rapporten varje vecka. Före ADR-0216 var
säkerhetskopiorna det som växte snabbast (varje dump hade alla kartor); nu tar de ungefär databasens storlek utan kartor gånger
antalet dumpar plus kartorna en gång. Behövs mer plats: ta bort gamla dumpar från före steg 45 direkt i `./backups/`, kör
`docker image prune -a` (gamla avbildningar) eller köp en Hetzner Volume eller större server. Kvoten för kartor (förval 20 GB)
ryms inte på CX23:s disk om klubbarna fyller den; rapporten säger vilken kvot som ryms.

## Belastningstest

ADR-0216: `scripts/load-test.ts` simulerar N samtidiga tävlingar mot en server och mäter svarstiderna. Bara Node (fetch), körs
från din dator (inte på servern, så att lastgeneratorn inte stjäl processorn). Per tävling skapas ett lopp med en bana, en
klass och påhittade löpare, som publiceras; sedan, samtidigt i alla tävlingar: avläsningar (`--readouts-per-minute`, samma API
som avläsningssidan), besökare (`--visitors`, var och en hämtar resultatlistan eller Live var femte sekund och laddar om sidan
varje minut) och speakerskärmar (`--speakers`, speakerlistan och Kvar i skogen var tionde sekund). Efteråt skrivs en tabell med
antal, fel och p50/p95/p99 per slags anrop, och tävlingarna tas bort (`--keep` behåller dem).

Kör en vardagskväll (inte på en tävlingsdag), med ett vanligt konto på servern:

```bash
git clone https://github.com/joelberring/otid.git && cd otid && pnpm install
export LOADTEST_EMAIL=<konto> LOADTEST_PASSWORD=<lösenord>
# Börja smått, öka sedan --races tills p95 för avläsningen går över 1 s eller fel dyker upp.
pnpm load-test -- --base https://<OTID_DOMAIN> --races 2 --minutes 5 --runners 150 --readouts-per-minute 20 --visitors 30
pnpm load-test -- --base https://<OTID_DOMAIN> --races 6 --minutes 5 --out lasttest-6.json
```

Titta samtidigt på servern med `docker stats` och `uptime`. Lokalt mot en databas utan e-post: `--register` skapar ett konto.
Mätningen och siffrorna nedan står i [docs/lasttest.md](lasttest.md#adr-0216-samtidiga-arrangemang).

**Grov bedömning för en CX23 (2 kärnor, 4 GB)** utifrån mätningarna i docs/lasttest.md (steg 51, 54 och 57; ADR-0174:
25 sträckor × 300 lag): en målrusning med 3 000 löpare och 1 000 besökare använde ungefär 1,5 kärnor (publiken 1,0, tävlingen
0,3 med två arbetsytor, två speakerskärmar och 150 avläsningar på 5 minuter, databasen 0,2), alltså ungefär 0,001 kärna per
besökare.
Ett vanligt klubbarrangemang (100–300 löpare, 50–100 besökare, högst 20 avläsningar per minut) blir då 0,15–0,25 kärnor, och med
marginal (högst 1,4 kärnor sammanlagt) klarar servern **ungefär 5–6 sådana samtidigt**, eller 15–20 små träningar (under 50
löpare och 20 besökare). Ett stort arrangemang (1 000 besökare, 3 000 löpare) tar ensamt det mesta; två samtidigt blir långsamma
för publiken, men avläsningen går före (steg 54). En stafett med många samtidiga växlingar (25-manna, 300 lag) är tyngst per
avläsning. Minnet (4 GB) räcker för detta; tjänsternas tak står i `docker-compose.prod.yml`. Kör testet ovan på servern för en
riktig siffra.

## Återställa

Provat lokalt 2026-10-03 och 2026-11-02 (dagens schema med migration 0040, dump som ägarrollen `otid_owner`, återställd i en
tom databas: samma antal anmälda, konton, avläsningar, resultatrevisioner och tävlingar). ADR-0216, provat lokalt 2026-11-07
(migration 0085, `deploy/backup.sh dump` och återställning i en tom databas): samma kartinnehåll byte för byte (md5 över alla
delar), också för en dump som togs om med kartinnehållet i. Så här gör du på samma server:

```bash
docker compose -f docker-compose.prod.yml stop web web-public web-public2 print-worker
docker compose -f docker-compose.prod.yml exec -T backup \
  pg_restore --clean --if-exists --no-owner -d otid /backups/daily/otid-<datum>.dump
docker compose -f docker-compose.prod.yml exec -T backup sh /backup.sh restore-map-content
docker compose -f docker-compose.prod.yml start web web-public web-public2 print-worker
```

`restore-map-content` (ADR-0216) läser in kartinnehållet ur `./backups/map-content/` för varje karta i databasen som saknar sitt
innehåll och skriver `Kartinnehåll inläst: N, saknas: 0.` Det går att köra flera gånger. En dump från före ADR-0216 (eller en som
togs om med kartinnehållet i) har innehållet själv; då läses inget in. Glömmer du steget fungerar allt utom kartorna, som
saknar bild och fil tills du kör det.

Välj en fil i `/backups/hourly/` för en senare tidpunkt samma dag. `pg_restore -l <fil> | head` visar när dumpen togs.
Efter övergången till databasroller körs kommandot som `otid_owner` (backuptjänstens användare); kör sedan
`sh deploy/db-roles.sh setup` igen så att rättigheterna gäller också för det återställda.

### Till en ny server

1. Skapa servern och starta O-Tid enligt [Starta](#starta) med **samma** `.env` som den gamla servern (spara den, och
   `OTID_EVENTOR_MASTER_KEY`, utanför servern) men **utan** raderna `OTID_DB_*`: rollerna finns inte än i en ny databas.
   Vänta tills sidan svarar. Databasen är då tom men migrerad.
2. Hämta dumpen och kartinnehållet till `./backups/` på den nya servern: från din Mac (`scp ~/otid-backup/daily/otid-<datum>.dump
   otid@<ny-server>:otid/backups/daily/` och `rsync -av ~/otid-backup/map-content/ otid@<ny-server>:otid/backups/map-content/`)
   eller från kopian utanför servern:

   ```bash
   docker compose -f docker-compose.prod.yml run --rm --entrypoint restic backup snapshots
   docker compose -f docker-compose.prod.yml run --rm --entrypoint restic -v ./backups/aterstallt:/aterstallt backup \
     restore latest --target /aterstallt --include /backups/daily --include /backups/map-content
   ls backups/aterstallt/backups/daily/       # dagsbackuperna; flytta den du vill ha till backups/daily/
   mkdir -p backups/map-content && mv backups/aterstallt/backups/map-content/* backups/map-content/
   ```

3. Återställ som superusern i en tom databas och starta webben:

   ```bash
   docker compose -f docker-compose.prod.yml stop web web-public web-public2 print-worker
   docker compose -f docker-compose.prod.yml exec postgres dropdb -U otid otid
   docker compose -f docker-compose.prod.yml exec postgres createdb -U otid otid
   docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U otid --no-owner -d otid < backups/daily/otid-<datum>.dump
   docker compose -f docker-compose.prod.yml run --rm backup restore-map-content   # kartinnehållet (ADR-0216)
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
   en befintlig tävling skrivs aldrig över. Med "Bjud in dem med samma roller" får administratörer, funktionärer och banläggare
   i kopian en inbjudan (mejl) till sin adress; den syns under Personer med behörighet och gäller när de loggar in med adressen.
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
| `otid_print` | `print-worker` | utskriftskön, tävlingens namn och kartfilen (`race_map_source`, `map_content`, `map_content_part`); ADR-0219 K2: kartjobben (`map_project_job`) och kartprojektens grundfil och ändrade objekt (`map_project`, `map_project_object`), inget annat |

Superusern finns kvar för `deploy/db-roles.sh` och underhåll för hand. Ingen data flyttas, bara ägare och rättigheter.
Provat 2026-11-02 mot en kopia med data (PostgreSQL 16, 1 286 anmälda och 689 konton): övergången, migrering 0040 som
`otid_owner`, appens vanliga flöden som `otid_app` (registrering, tävling, IOF-import, publicering, borttagning av konto
med tävling), utskriftsarbetaren som `otid_print`, dump som ägaren och återställning, tillbakagång och övergång igen. CI gör
övergången på den körande driftmiljön och kör sedan alla webbläsartester med rollerna.

**Övergången** (på servern, i repots katalog, gärna inte under en tävling):

```bash
git pull && docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d   # ny version, superuser
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

## Kartornas lagring

ADR-0189: kartbilder och kartfiler lagras en gång (`map_content` och `map_content_part`, adresserade med sha256). Tävlingar,
kopior, träningstillfällen, gruppens bibliotek och återställda tävlingar pekar på samma innehåll, som tas bort när den sista
tävlingen eller biblioteksraden som pekar på det tas bort. Uppladdningen strömmas till databasen i delar om 1 MiB, så webben
håller aldrig hela filen i minnet.

**Kvoten** (bara i `web`, i MB): `OTID_MAP_QUOTA_ACCOUNT_MB` (förval 2048) är vad ett konto får ha laddat upp, räknat på nytt
innehåll som kontot laddade upp först; `OTID_MAP_QUOTA_TOTAL_MB` (förval 20480) är vad hela servern lagrar. `0` stänger av en
gräns. Samma fil igen, en kopia eller ett träningstillfälle kostar ingenting. Arrangören får ett besked med hur mycket som
används. Ett ogiltigt värde skrivs som KONFIGURATIONSFEL i loggen och förvalet används. Se läget med
`docker compose -f docker-compose.prod.yml exec web node superadmin.mjs map-content status`.

**Övergången i två steg** (AGENTS.md, migrationsregeln):

1. Migration 0044 lägger till tabellerna och referenserna (bara tillägg). Den nya versionen läser både gamla rader (bilden och
   filen i `race_map.image`, `race_map_source.file` och bibliotekets kolumner) och nya, och skriver bara nya. Kopior av gamla
   rader pekar på innehållet direkt; den gamla raden ändras inte. Går något fel kan den förra versionen köras igen, men den
   kan inte läsa kartor som laddats upp eller kopierats efter uppdateringen (de ser ut att sakna kartbild).
2. När den nya versionen fungerar (inte på en tävlingsdag): flytta de gamla raderna och ta bort dubbletterna:

   ```bash
   docker compose -f docker-compose.prod.yml exec web node superadmin.mjs map-content move
   ```

   En rad per transaktion (inga långa lås); kommandot kan avbrytas och köras om och säger hur många rader som är kvar.
   Utrymmet i databasen återanvänds direkt för nya rader; vill du få tillbaka det till disken, kör
   `VACUUM (FULL) race_map, race_map_source, training_group_map, training_group_map_source` som superuser en lugn dag
   (låser tabellerna en kort stund).

Kolumnerna `image` och `file` tas bort i en senare migration när `map-content status` säger 0 rader kvar på servern.

## Gallring

ADR-0189 beslut 6: av som förval. Sätt i `.env` och kör `docker compose -f docker-compose.prod.yml up -d`:

- `OTID_RETENTION=anonymize`: tävlingar vars datum är äldre än `OTID_RETENTION_MONTHS` månader (tom = 24) anonymiseras; alla
  deltagare blir "Anonym deltagare", resultaten och sträcktiderna står kvar.
- `OTID_RETENTION=delete`: evenemang där alla lopp är så gamla tas bort med allt som hör till; det syns i superadmins logg som
  "Automatisk gallring".

Underhållet i `web` kör gallringen fem minuter efter start och sedan en gång i timmen, högst fem tävlingar per varv. Loggen
(`logs web`) säger vid start vad som gäller och efter varje varv hur många tävlingar som gallrats (bara antal). Integritetssidan
visar inställningen; `web-public` får samma värden i `docker-compose.prod.yml`. Tänk på att det som gallrats finns kvar i
backuperna tills de skrivs över (14 dagar på servern, upp till 12 månader i kopian utanför servern).

## Om en migrering misslyckas

Tjänsten `migrate` migrerar databasen innan webben startar (`node migrate.mjs`, ADR-0186; före det gjorde webben det själv).
Varje migrering körs i en egen transaktion, så en som misslyckas lämnar inga halva ändringar; den nya webben startar inte,
och den gamla kör vidare om den var igång (annars svarar sidan 502). En dump togs strax före (`./backups/fore-migrering/`).

1. Läs felet: `docker compose -f docker-compose.prod.yml logs --tail=100 migrate`.
2. Gå tillbaka till förra versionen, som fungerade med databasen:

   ```bash
   git log --oneline -5                  # hitta förra versionen
   echo "OTID_TAG=<förra-commit>" >> .env  # ADR-0195: förra versionens avbildning (kort sha)
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```

   (Se [Tillbaka till förra versionen](#uppdatera) om compose-filen också ändrats. Bygger servern själv,
   [reserv](#bygga-på-servern-reserv): `git checkout <förra-commit>` och `build` i stället för `pull`.)

3. Startar den inte heller (en tidigare migrering i samma uppdatering hann köras): återställ dumpen i
   `./backups/fore-migrering/` enligt [Återställa](#återställa), med förra versionen igång.
4. Skicka felet till den som driver O-Tid. När det är rättat: `git checkout main`, ta bort raden `OTID_TAG`, och
   [uppdatera](#uppdatera) när rättelsens avbildning finns.

## Miljövariabler

`deploy/prod.env.example` har de vanliga. Övriga, med förval när de saknas eller är tomma. Variabler som `docker-compose.prod.yml`
inte skickar vidare (markerade "ej i compose") gäller i drift först när de läggs under tjänstens `environment` där.

| Namn | Förval | Vad den gör |
| --- | --- | --- |
| `OTID_IMAGE`, `OTID_BACKUP_IMAGE` | `ghcr.io/joelberring/otid-web`, `…/otid-backup` | Avbildningarnas namn; lokala namn när servern bygger själv ([reserv](#bygga-på-servern-reserv)). |
| `OTID_DB_OWNER_USER`/`_PASSWORD`, `OTID_DB_APP_*`, `OTID_DB_PRINT_*` | `otid` och `POSTGRES_PASSWORD` | Databasrollerna; skrivs av `deploy/db-roles.sh setup` ([Databasroller](#databasroller)). |
| `BACKUP_INTERVAL_MINUTES`, `BACKUP_KEEP_HOURLY`, `BACKUP_KEEP_DAYS` | 60, 48, 14 | Dumpens intervall och hur många tim- och dagsdumpar som sparas ([Backup](#backup)). |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | tomma | restic-kopian till S3 ([Kopia utanför servern](#kopia-utanför-servern-valfri-krypterad)). |
| `OTID_HEALTH_INTERVAL_MINUTES`, `OTID_DISK_ALERT_PERCENT` | 15, 80 | Hälsokontrollens intervall och diskens larmgräns i procent ([Bevakning](#bevakning-valfri)). |
| `OTID_EVENTOR_API_KEY` | tom (en nyckel som ett klubbarkiv sparat) | Klubbens Eventor-nyckel för klubblistan, bara i `web` ([Eventor](#eventor)). |
| `OTID_REGISTRATION_LIMIT_PER_HOUR` | 10 | Nya konton per IP-adress och timme. |
| `OTID_RADIO_POLLER` | på (`off` i publikens instanser) | `off` = instansen hämtar inga radiostämplingar. |
| `OTID_MAP_QUOTA_ACCOUNT_MB`, `OTID_MAP_QUOTA_TOTAL_MB` | 2048, 20480 | Kartornas kvot per konto och för servern; 0 = ingen gräns ([Kartornas lagring](#kartornas-lagring)). |
| `OTID_RETENTION`, `OTID_RETENTION_MONTHS` | av, 24 | Gallring av gamla tävlingar (`anonymize` eller `delete`) ([Gallring](#gallring)). |
| `OTID_PRINT_JOB_TIMEOUT_MS` | 600000 | Tidsgräns för ett utskriftsjobb. |
| `OTID_PRINT_JOB_MEMORY_MB` | 256 (minst 64) | Minnestak för ett utskriftsjobbs barnprocess. Ej i compose. |
| `OTID_PRINT_POLL_MS` | 2000 (minst 200) | Hur ofta utskriftsarbetaren tittar efter nya jobb. Ej i compose. |
| `OTID_PRINT_FONT_DIR` | `fonts` bredvid `print-worker.mjs`, annars `packages/print-pdf/fonts` | Mappen med PDF:ens typsnitt. Ej i compose. |
| `OTID_PRINT_WORKER` | på | Bara lokalt: `off` = `pnpm dev` startar ingen utskriftsarbetare. |
| `OTID_MAINTENANCE` | på i `web` (aldrig i publikens instanser) | `off` = instansen kör inget underhåll (kartinnehåll utan tävling, gallringen, klubbarnas medlemslistor). Ej i compose. |
| `OTID_IMPORT_TOKEN` | tom (fråga) | Bara på datorn som kör `pnpm archive-import`: klubbarkivets importnyckel (annars `--nyckel-fil` eller en fråga). |
| `OTID_EVENTOR_BASE_URL`, `OTID_ROC_BASE_URL`, `OTID_GOOGLE_BASE_URL`, `OTID_GOOGLE_AUTHORIZE_URL` | tomma = de riktiga tjänsterna | Endast test: CI pekar på falska tjänster. Lämna tomma i drift. |
| `OTID_OVERPASS_URL` | tom = `https://overpass-api.de/api/interpreter` | Kartprojektets hämtning från OpenStreetMap (K4c). En egen Overpass går att ange; CI pekar på en falsk. |
| `OTID_LM_STAC_HOJD_URL`, `OTID_LM_LASER_COLLECTION` | tomma = `https://api.lantmateriet.se/stac-hojd/v1` och samlingen vars namn nämner laser och skog | Laserdata från Lantmäteriet (K5, provas). |
| `OTID_GEO_WORKER_TOKEN`, `OTID_GEO_TILES_PER_MONTH` | tom, 200 | Geo-arbetarens nyckel och laserrutor per konto och månad ([Geo-arbetaren](#geo-arbetaren-adr-0219-k5)). |
| `OTID_LM_STAC_BILD_URL`, `OTID_LM_TOKEN_URL` | tomma = `https://api.lantmateriet.se/stac-bild/v1` och `https://apimanager.lantmateriet.se/oauth2/token` | Ortofoton från Lantmäteriet med användarens egna uppgifter (K4c, provas). Uppgifterna krypteras med `OTID_EVENTOR_MASTER_KEY`; utan den kan de inte sparas. CI pekar på en falsk STAC. |

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

## AI-koppling (ADR-0219, steg K2)

O-Tid är inloggningsserver (OAuth 2.1) och MCP-server för Claude med personens eget konto. Ingen AI-nyckel finns på servern.

- **Koppla:** i Claude, lägg till en anslutning (custom connector) med adressen `https://<O_TID_PUBLIC_ORIGIN>/api/mcp`.
  Claude registrerar sig själv, personen loggar in i O-Tid och godkänner på `/oauth/authorize`. Kopplingen syns under Mitt
  konto → AI-kopplingar och kan tas bort där.
- **Verktyg:** `list_map_projects`, `map_overview`, `render_view`, `render_compare`, `list_objects`, `norm_check` och
  `propose_changes` (bara förslag som en ägare godkänner).
- **Var det körs:** webben (`web`) tar emot anropen och använder publikens databaspool; bilder, objektlistor och kontroller
  görs som kartjobb av `print-worker` (lägsta prioritet, barnprocess per jobb, `OTID_MAP_JOB_TIMEOUT_MS` förval 60000,
  `OTID_MAP_JOB_MEMORY_MB` förval 256). Resultaten rensas efter en timme.
- **Gränser:** 30 kartjobb per minut och konto (två samtidigt), 20 registreringar och 300 token-anrop per IP och timme.
- **Rollerna:** kör `sh deploy/db-roles.sh setup` efter migrering 0093 så att `otid_print` får kartjobben (migreringen ger
  samma rättigheter när rollerna redan finns).

## Geo-arbetaren (ADR-0219, K5)

Karttapullautin på laserdata körs av geo-arbetaren på en egen geo-server, aldrig på tävlingsservern. Avbildningen
`ghcr.io/joelberring/otid-geo` (amd64 och arm64) innehåller Karttapullautin (GPL-3, byggt oförändrat ur källkoden) och
`scripts/geo-worker.ts`. Geo-servern talar bara HTTPS med O-Tid; inga portar öppnas på den.

- **Laserdata:** användaren lägger in sina egna uppgifter till Lantmäteriet (Mitt konto) och beställer Laserdata Nedladdning,
  skog på Geotorget. Servern hämtar rutorna åt geo-arbetaren med de uppgifterna; de lämnar aldrig tävlingsservern. Laserdata
  gäller under CC BY 4.0 (© Lantmäteriet) och kan innehålla personuppgifter enligt Lantmäteriets villkor.
- **Nyckeln:** sätt `OTID_GEO_WORKER_TOKEN` (`openssl rand -hex 32`) i `.env` på tävlingsservern och starta om `web`.
- **Prova för hand** (tills den automatiska starten finns): skapa en server (CX23 eller CAX11, Ubuntu, din SSH-nyckel),
  installera Docker och kör

  ```bash
  docker run -d --restart unless-stopped --name otid-geo -e OTID_GEO_ORIGIN=https://<OTID_DOMAIN> \
    -e OTID_GEO_WORKER_TOKEN=<samma nyckel> -e OTID_GEO_EXIT_IDLE_MIN=0 ghcr.io/joelberring/otid-geo:main
  docker logs -f otid-geo
  ```

  Radera servern när jobben är klara; den kostar per timme.
- **Minne:** Karttapullautin tar en ruta i taget (`processes=1`), så 4 GB räcker. Fler än fyra rutor slås ihop i halv
  upplösning, och bilden krymps tills den ryms som underlag (högst 40 MB och 30000 px).
- **Gränser:** två jobb per konto åt gången, högst 16 rutor per jobb och `OTID_GEO_TILES_PER_MONTH` rutor per konto och
  månad. Resultaten räknas mot kontots kartkvot.
