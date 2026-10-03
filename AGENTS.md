# AGENTS.md

## Uppdrag

Bygg O-Tid: ett enkelt, webbaserat tidtagningssystem för orientering med
direkt SPORTident-avläsning som fungerar även när nätet försvinner.

**Just nu finns ett enda mål: en körbar klubbträning.** Allt arbete följer
`PLAN.md`.

## Läs först (och bara detta)

1. `PLAN.md` – målet och stegen. Enda backloggen.
2. `STATUS.md` – var arbetet står.
3. `docs/adr/ADR-0168-omstart-mot-klubbtraning.md` – gällande grundbeslut.
4. Närmaste `AGENTS.md` i katalogen du ändrar (t.ex. `apps/web/AGENTS.md`).

`CODEX_BRIEF.md` är långsiktig vision och `docs/architecture.md`,
`docs/domain-rules.md` och `docs/offline-sync.md` är referens. Läs dem vid
behov. Vid konflikt gäller `PLAN.md` och ADR-0168. `docs/archive/` är
historik. Läs den inte om du inte letar efter något specifikt.

## Arbetssätt

- Arbeta i `PLAN.md`-ordning. Ett steg är en sammanhängande leverans och får
  ta flera arbetspass. Dela inte upp det i mikrouppgifter.
- **Skapa inga `TASK_*.md`-filer.** Skriv ingen ADR om du inte måste avvika
  från `PLAN.md` eller ADR-0168. Skriv då en kort ADR och notera det i `STATUS.md`.
- **Föreslå inte "nästa minsta uppgift".** Nästa uppgift står i `PLAN.md`.
  Om du ser något som saknas: skriv en rad under "Idéer" i `STATUS.md` och
  fortsätt med planen.
- Bygg inget som inte behövs för det aktuella steget. Parkerade områden
  (ADR-0168 beslut 5) rörs inte, utom för att ta bort kod som är i vägen.
- När ett steg är klart: bocka av i `PLAN.md`, skriv högst tio rader i
  `STATUS.md` (vad som gjorts, vad som är verifierat, vad som återstår),
  committa och gå vidare till nästa steg.
- Committa ofta med korta svenska meddelanden. Gör aldrig `git push --force`
  och skriv aldrig om historik.
- Saknad hårdvara blockerar aldrig steg 0–6. Använd syntetiska frames,
  replay och den falska stationen.
- Ta bort död kod i stället för att bevara den "för säkerhets skull". Git har historiken.

## Arkitekturregler som gäller

- Modulär monolit: Next.js (`apps/web`) + paket i `packages/*`. Inga
  mikrotjänster, ingen Redis, ingen GraphQL.
- `packages/domain` är ren TypeScript utan I/O. Resultatlogik finns bara där,
  aldrig i React, route handlers eller SQL.
- `packages/sportident` (från steg 3) är också ren och utan I/O. Håll
  bytetransport, protokolltolkning, brickavkodning och resultatbedömning
  i separata lager.
- Råa avläsningsbytes är oföränderliga och sparas alltid.
- Mottagning av avläsningar är idempotent (enhets-id + löpnummer + hash).
- Resultatändringar skapar nya revisioner. Historiken skrivs aldrig över.
- Externa format (IOF XML, Eventor) mappas vid adaptergränsen till intern modell.
- Lägg inte till ett beroende för något som är en liten funktion. Välkända,
  underhållna bibliotek är annars okej.
- Håll filer under ~800 rader. Dela upp hellre än att växa.

## Behörighet (ADR-0168 beslut 4)

- **Admin** = inloggat konto med `OWNER`/`ADMIN` på eventet. Admin får göra
  allt i eventets tävlingar. Kontrollera alltid med samma serverfunktion
  (`requireRaceAdmin` eller motsvarande). Skapa inga nya rolltyper eller
  credentials.
- **Alla andra** läser publicerat innehåll utan inloggning.
- Grundskydd som behålls: hashade lösenord, httpOnly SameSite=Lax-cookie,
  Origin-kontroll på skrivande anrop, HTTPS i drift.

## SPORTident

- Egen implementation. Källor och licensregel finns i ADR-0168 beslut 3.
  Kopiera eller översätt aldrig kod från MeOS, Oxygen eller andra
  GPL/AGPL-projekt. Läs för förståelse och skriv egen kod och egna tester.
- Varje parserändring testas med godtyckliga chunkgränser, fel CRC,
  dubbletter och trunkering.
- Påstå aldrig hårdvarustöd som bara provats syntetiskt. Stödmatrisen i
  `docs/sportident.md` använder `untested | captured | decoded | field-verified`.
- Logga inte namn eller onödiga personuppgifter i seriella felsökningsloggar.
- Livelox-data, API eller UI används inte.

## Databas

- PostgreSQL/PostGIS med Drizzle-migrationer. Tester använder PostgreSQL,
  inte SQLite.
- Det finns ingen produktionsdata ännu, så borttagande migrationer är tillåtna
  (ADR-0168 beslut 6). Varje schemaändring kräver ändå en migration.
- Externa id:n är aldrig primärnycklar.

## UI

- Svenska först, med texter i `i18n`.
- Avläsningsvyn är skriven för stress, regn och handskar: stora besked, få
  knappar, status som inte bara bygger på färg.
- Visa alltid stationsstatus, internetstatus, köns längd och snapshotversion
  i avläsningsvyn.
- Publika sidor fungerar utan inloggning och på 390 px bredd.
- Inga dekorativa animationer.

## Tester och kommandon

```bash
docker compose up -d postgres   # lokal databas
pnpm install
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test                       # enhetstester (vitest)
pnpm test:integration           # mot TEST_DATABASE_URL (PostgreSQL)
pnpm test:e2e                   # Playwright
pnpm build
```

- Playwright-tester täcker **användarflöden** (registrera/skapa/avläsa/
  resultat), inte enskilda uppgifter. Använd en gemensam Playwright-
  konfiguration. Skapa inte egna `tsconfig`, konfigurationer eller portar
  per test. Befintliga per-uppgiftskonfigurationer i `tests/e2e` får slås
  ihop eller tas bort.
- Lägg inte till testkommandon i denna fil. Behövs ett nytt kommando, lägg
  det i `package.json` och nämn det i README.

## Förbjudna genvägar

- Ingen låtsaspersistens i produktionsvägar och ingen minnesbaserad kö som
  påstås tåla krascher.
- Inga tysta `catch` runt hårdvaru- eller synkfel.
- Ingen ändring av råa avläsningar.
- En klient raderar aldrig sin enda lokala kopia bara för att en begäran skickades.
  Radera först när servern har kvitterat.
- Inga hårdkodade API-nycklar eller lösenord.

## Slutrapport efter varje arbetspass

Högst tio rader: vad som ändrats, vilka kommandon som körts och med vilket
resultat, vad som återstår i det aktuella steget. Föreslå inga nya uppgifter
utanför `PLAN.md`.
