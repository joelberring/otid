# O-Tid

Webbaserat tidtagningssystem för orientering med direkt SPORTident-avläsning
i webbläsaren.

**Mål just nu:** en körbar klubbträning. Se [PLAN.md](PLAN.md) för steg och
[STATUS.md](STATUS.md) för läget. Grundbesluten finns i
[ADR-0168](docs/adr/ADR-0168-omstart-mot-klubbtraning.md).

## Kom igång lokalt

```bash
cp .env.example .env
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm dev
```

Öppna http://localhost:3000.

## Behörighet

- **Konto:** vem som helst skapar ett konto på `/organizer` (inloggningsnamn, namn, lösenord).
  Inloggningen gäller i 30 dagar.
- **Admin:** den som skapar en tävling äger den. Ägaren ger andra konton
  administratörsrätt under "Visa medadministratörer". Admins kan ändra allt i
  tävlingen, även import (`/admin/<lopp>/imports`), i samma arbetsyta `/admin/<lopp>/manage`.
- **Alla andra:** startlistor, resultat och sträcktider är öppna utan inloggning.
- Glömt lösenord: `pnpm organizer:account rotate` (se `docs/organizer-account-operations.md`).

## Struktur

```text
apps/web              Next.js: webb, API, admin, avläsning, publika sidor
packages/domain       ren resultatmotor
packages/sportident   SPORTident-protokoll och brickavkodning (steg 3)
packages/device-transport  bytetransport (Web Serial m.fl.), capture, replay
packages/application  användningsfall och transaktioner
packages/contracts    validerade API-kontrakt
packages/database     Drizzle-schema och migrationer
packages/iof-xml      IOF XML 3.0 import/export
apps/si-tools         CLI för portlista, rå capture och replay
apps/station, apps/participant  parkerade Android-appar
docs                  arkitektur, regler, ADR:er, arkiv
```

## Verifiering

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:integration   # kräver TEST_DATABASE_URL (PostgreSQL/PostGIS, roll med CREATEDB)
pnpm test:e2e           # kräver E2E_DATABASE_URL eller TEST_DATABASE_URL; startar webben på port 3100
```
