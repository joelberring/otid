# ADR-0195: Färdiga avbildningar från GitHub Actions, servern bygger inte

Status: beslutad 2026-11-03 (grenen `snabbare-bygge`, ägarens beslut samma dag). Ändrar hur servern uppdateras (docs/drift.md,
steg 6 och 45, ADR-0186); dumpen före migreringen och migreringen som egen tjänst (ADR-0186) är oförändrade.

## Bakgrund

`docker compose -f docker-compose.prod.yml build` på driftservern (Hetzner x86, 3,7 GB, 2 vCPU) tog över 35 minuter och fick
servern att swappa (load 40) medan tävlingens webb och databasen körde. Uppmätt utanför Docker (2 vCPU, `next build`):
kompileringen (Turbopack) når 2,4–2,7 GB i slutet, och typkontrollen efter den höll 2,2–2,3 GB i en minut; hela bygget tog
2,5 minuter. Servern behöver bara 1–1,5 GB för att köra O-Tid. Typkontrollen och lint körs redan i CI vid varje push.

## Beslut

1. **GitHub Actions bygger avbildningarna** (`.github/workflows/images.yml`): när arbetsflödet CI är grönt för en push till
   `main` i repot byggs `ghcr.io/joelberring/otid-web` (Dockerfile) och `ghcr.io/joelberring/otid-backup`
   (`deploy/backup.Dockerfile`) för linux/amd64 och läggs upp med taggarna hel sha, kort sha (7) och `main`. `main` flyttas
   bara om commiten fortfarande är mains senaste. Paketen är publika, så servern behöver ingen inloggning. Bara jobbet som
   lägger upp har `packages: write`. På andra grenar byggs avbildningarna utan att läggas upp när Dockerfile, beroendena eller
   arbetsflödet ändras. arm64 byggs inte (servern är x86; Next-bygget under QEMU tar lång tid).
2. **Inget serverspecifikt byggs in.** Domänen, lösenorden och `NEXT_PUBLIC_INTRO_FILM_URL` läses vid start; Docker-bygget får
   ingen `.env` (`.dockerignore`) och inga build-args utom `OTID_SKIP_BUILD_CHECKS`.
3. **`docker-compose.prod.yml`** använder `${OTID_IMAGE:-ghcr.io/joelberring/otid-web}:${OTID_TAG:-main}` och samma mönster för
   backupen (`OTID_BACKUP_IMAGE`). Uppdatering: `git pull && … pull && … up -d`. `OTID_TAG=<sha>` i `.env` låser versionen
   (inför en tävling) eller går tillbaka. `build:` finns kvar: med lokala namn (`OTID_IMAGE=otid-web`,
   `OTID_BACKUP_IMAGE=otid-backup`, `OTID_TAG=local`) bygger servern själv som förut (reserv). CI-jobbet `production` sätter
   lokala namn och bygger från commiten; det hämtar aldrig `main` från ghcr.io.
4. **Docker-bygget hoppar över typkontrollen** (`OTID_SKIP_BUILD_CHECKS=1` i Dockerfile → `typescript.ignoreBuildErrors` i
   `next.config.ts`). Lokalt `pnpm build` och CI-jobbet `verify` (`pnpm typecheck`, `pnpm build`) kontrollerar som förut. Next 16
   kör ingen ESLint i `next build`. Nodes heap begränsas till 1,5 GB i byggsteget (påverkar inte Turbopacks minne), och
   BuildKit-cacher sparar pnpm:s paket och `.next/cache` mellan byggen på samma dator.

## Följder

- Servern laddar ner i stället för att bygga: ingen minnestopp och ingen CPU tas från en körande tävling. Avbildningarna finns
  omkring 25 minuter efter en push till `main` (CI 17–19 minuter och bygget).
- En avbildning har inte typkontrollerats i sitt eget bygge, men samma commit har klarat `pnpm typecheck` och `pnpm build` i
  CI innan den läggs upp.
- Compose-filen och avbildningen ska höra ihop: `git pull` och `pull` görs tillsammans, och en tillbakagång med `OTID_TAG`
  backar bara repot om compose-filen eller `deploy/` ändrats. En tillbakagång förbi en migrering begränsas som förut (ADR-0185).
- Reserven (bygga på servern) kräver fortfarande swap; första bygget har en kort topp på ~2,7 GB, nästa med cachen ~1,2 GB.
