# Drift

O-Tid körs med `docker-compose.prod.yml` på en vanlig VPS:

- PostgreSQL/PostGIS,
- webben (Next standalone, migrerar databasen vid start),
- Caddy (HTTPS med Let's Encrypt),
- en backuptjänst.

All data, även kartbilder och GPS-rutter för vägval (PLAN.md steg 16), ligger i PostgreSQL och kommer
med i den nattliga backupen. MinIO behövs inte.

## Starta

Krav: en Linux-server med Docker och Compose (1 vCPU och 1–2 GB minne räcker
till en klubbträning). Du behöver också ett domännamn vars A/AAAA-post pekar
på servern. Portarna 80 och 443 ska vara öppna.

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

## Eventor

Klubbens Eventor-nyckel klistras in av administratören under Inställningar → Eventor
och sparas krypterad i databasen. Krypteringen kräver en masternyckel som bara finns
i serverns `.env` (aldrig i databasen eller dess backup):

```bash
echo "OTID_EVENTOR_MASTER_KEY=$(openssl rand -base64 32)" >> .env
docker compose -f docker-compose.prod.yml up -d
```

Utan masternyckel startar O-Tid ändå; Inställningar visar då att Eventor inte är
påslaget. Spara masternyckeln separat från backupen. Byts eller tappas den kan de
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

`OTID_CONTACT_EMAIL` (valfri) visas på sidan om personuppgifter (`/integritet`) och på "Glömt lösenordet".
`OTID_REGISTRATION_LIMIT_PER_HOUR` (valfri, förval 10) är hur många konton som får skapas per IP-adress och timme.

Endast test: CI pekar `OTID_SMTP_URL` mot en falsk SMTP-server på värden (`tests/e2e/fake-smtp.ts`), på samma
sätt som `OTID_EVENTOR_BASE_URL`. Appen har ingen särskild testväg för e-post.

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
