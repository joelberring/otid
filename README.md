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

- **Admin**: registrera ett konto, skapa en tävling och bjud in fler admins.
  Admins kan ändra allt i tävlingen.
- **Alla andra**: startlistor, resultat och sträcktider är öppna utan inloggning.

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
pnpm test:integration   # kräver TEST_DATABASE_URL
pnpm test:e2e
```
