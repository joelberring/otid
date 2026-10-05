# Drift

O-Tid körs med `docker-compose.prod.yml` på en vanlig VPS:

- PostgreSQL/PostGIS,
- webben (Next standalone, migrerar databasen vid start),
- Caddy (HTTPS med Let's Encrypt),
- en backuptjänst.

MinIO behövs inte för klubbträningen (kartor och rutter är parkerade).

## Starta

Krav: en Linux-server med Docker och Compose (1 vCPU och 1–2 GB minne räcker
till en klubbträning). Du behöver också ett domännamn vars A/AAAA-post pekar
på servern. Portarna 80 och 443 ska vara öppna.

```bash
git clone https://github.com/joelberring/otid.git && cd otid
cp deploy/prod.env.example .env      # fyll i OTID_DOMAIN och POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up -d --build
```

Öppna `https://<OTID_DOMAIN>/organizer` och skapa det första kontot.

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
