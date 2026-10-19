# O-Tid

Webbaserat tidtagningssystem för orientering med direkt SPORTident-avläsning
i webbläsaren.

**Mål just nu:** en körbar klubbträning. Se [PLAN.md](PLAN.md) för steg och
[STATUS.md](STATUS.md) för läget. Grundbesluten finns i
[ADR-0168](docs/adr/ADR-0168-omstart-mot-klubbtraning.md).

## Kom igång lokalt

Kräver Docker Desktop och Node.js 22 eller senare.

```bash
cp .env.example .env       # en gång; pnpm dev, pnpm demo och pnpm db:migrate läser den
docker compose up -d postgres
corepack enable            # på Mac ofta: sudo corepack enable
pnpm install
pnpm demo                  # skapar databastabellerna och en demotävling
pnpm dev
```

Öppna http://127.0.0.1:3000/organizer (använd 127.0.0.1, inte localhost).
`pnpm dev` och `pnpm build` bygger först det offlinekapabla
appskalet för avläsningen (`/readout/`) med `pnpm --filter @o-tid/web build:shells`.

## Prova på fem minuter

```bash
pnpm demo   # läser .env (se ovan)
pnpm dev
```

`pnpm demo` skapar kontot `demo@o-tid.local` (lösenord `demo-traning-1`) och en träningstävling
med två banor, tio anmälda och sju avläsningar (en felstämplad, tre kvar i skogen).
Adresserna skrivs ut. Kör den igen för en ny tävling.

## Avläsning

I arbetsytan: "Öppna avläsning". Anslut en SPORTident-station med USB (Chrome/Edge)
eller starta övningsstationen. Avläsningar sparas i webbläsaren och skickas när nätet
finns. Se `docs/sportident.md`.

**Mac:** stationen behöver Silicon Labs drivrutin *CP210x VCP* (silabs.com). Installera den och tillåt den under
*Systeminställningar → Allmänt → Inloggningsobjekt och tillägg → Drivrutinstillägg* (äldre macOS: *Integritet och
säkerhet*). Porten heter sedan `cu.SLAB_USBtoUART` eller `cu.usbserial-…` (`ls /dev/cu.*`); `cu.Bluetooth-Incoming-Port`
och `cu.debug-console` är inte stationen. Steg för steg i `docs/sportident.md`.

**Export:** Inställningar → "Exportera tävlingen" ger en JSON-fil med allt om loppet (`docs/export.md`).

## Behörighet

- **Konto:** vem som helst skapar ett konto på `/organizer` (e-post, namn, lösenord), med spärr mot
  upprepade försök. Inloggningen gäller i 30 dagar. Under "Mitt konto" (`/konto`) byter man namn och
  lösenord eller tar bort kontot (tävlingar man äger tas bort samtidigt).
- **Admin:** den som skapar en tävling äger den. Under Inställningar → "Personer med behörighet"
  lägger ägaren till administratörer och alla administratörer funktionärer, med e-postadressen till ett
  befintligt konto. Admins kan ändra allt i tävlingen, även import (`/admin/<lopp>/imports`), i samma
  arbetsyta `/admin/<lopp>/manage`.
- **Funktionär:** loggar in med sitt eget konto och ser tävlingen under Mina tävlingar. Arbetsytan har bara
  Start och Avläsning: avläsning, direktanmälan av okänd bricka, kvar i skogen, startlistor och speaker.
  Samma konto kan vara inloggat på flera enheter.
- **Alla andra:** startlistor, resultat och sträcktider är öppna utan inloggning.
- **Superadmin:** sätts med `pnpm account:superadmin grant <e-post>` (i drift: se `docs/drift.md`) och
  städar konton och tävlingar på `/superadmin`. Åtgärderna loggas.
- Glömt lösenord: länk via e-post när `OTID_SMTP_URL` är satt, annars skapar superadmin en länk.
  Vilka personuppgifter som sparas står på `/integritet`.

## Drift

`docker compose -f docker-compose.prod.yml up -d --build` med PostgreSQL, webb, Caddy (HTTPS)
och nattlig backup. Se [docs/drift.md](docs/drift.md).

## Struktur

```text
apps/web              Next.js: webb, API, adminarbetsyta, avläsning (src/readout), publika sidor
apps/si-tools         CLI för portlista, rå capture och replay
packages/domain       ren resultatmotor (ingen I/O)
packages/sportident   SPORTident-protokoll och brickavkodning
packages/device-transport  bytetransport (Web Serial, falsk station), capture, replay
packages/application  användningsfall, transaktioner och behörighetskontroll
packages/contracts    validerade API-kontrakt (zod)
packages/database     Drizzle-schema och migrationer (baslinje från steg 23)
packages/iof-xml      IOF XML 3.0 import/export och GPX-spår
packages/eventor      Eventor-klient
packages/roc          ROC/OResults-klient (radiokontroller)
docs                  arkitektur, domänregler, drift, ADR:er, arkiv
```

Se [docs/architecture.md](docs/architecture.md) och [docs/domain-rules.md](docs/domain-rules.md).

## Verifiering

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:integration   # kräver TEST_DATABASE_URL (PostgreSQL/PostGIS, roll med CREATEDB)
pnpm test:e2e           # kräver E2E_DATABASE_URL eller TEST_DATABASE_URL; startar webben på port 3100
E2E_BASE_URL=https://localhost pnpm test:e2e   # mot en körande driftmiljö
```
