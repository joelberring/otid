# O-Tid

Tidtagning, banläggning och kartritning för orientering i webbläsaren, för klubbtävlingar och träningar.
Används publikt på **[otid.berring.se](https://otid.berring.se)** – gratis, i beta.

## Vad som finns

**Tidtagning**
- SPORTident-avläsning direkt i webbläsaren (Web Serial i Chrome/Edge på dator, WebUSB på Android-platta), SI-Card 5–11
  och SIAC, med lokal kö som gör att avläsningar aldrig går förlorade när nätet försvinner.
- Tävlingstyperna Träning, Liten tävling, Tävling (med gafflade banor), Stafett och Rogaining; lottning med fri start,
  minutstart och masstart; självregistrering på tävlingsdagen.
- Start- och resultatlistor, Live, sträcktidsanalys, speakersida och Kvar i skogen, öppna utan inloggning.
- Eventor (klasser, anmälda, löpardatabas), IOF XML 3.0 in och ut, radiokontroller via ROC eller OResults.
- Funktionärer med egna konton, nödlägen (stationstid, kontroll ur funktion, manuell tid, omläsning från rådata) och fest med bar.

**Banläggning**
- Kontroller och banor på kartan, gafflingar, kontrollbeskrivningar och tryckfärdiga PDF:er (även individuella baksidor).
- Klubbytor med träningsgrupper, terminsplanering och nivåer (Grön–Svart).

**Kartritning**
- Kartprojekt i OCAD- och OpenOrienteering Mapper-format med ritverktyg för ISOM, ISSprOM och äldre sprintnorm, i webbläsaren
  och på mobil, där flera kan rita och föreslå ändringar i samma karta.
- Grundkarta ur Lantmäteriets laserdata: en geo-arbetare kör Karttapullautin och egna steg (branter, vegetation, fukt,
  berg i dagen, belagda ytor för sprint) och resultatet läses in som kandidater med reglage för hur mycket som tas med.
- Underlag från OpenStreetMap, Skogsstyrelsen (hyggen), SLU:s markfuktighet och ortofoto.
- Banläggningen kan peka på ett kartprojekt och ta in kartans ändringar.

**AI-koppling**
- En MCP-server (`/api/mcp`) som låter en AI läsa kartprojekt och banor, starta laserkörningar, föreslå ändringar och
  granska banornas nivå. Ändringar blir förslag som en människa godkänner.

Se [PLAN.md](PLAN.md) för stegen och [STATUS.md](STATUS.md) för läget. Grundbesluten finns i
[ADR-0168](docs/adr/ADR-0168-omstart-mot-klubbtraning.md).

## Stöd servern

O-Tid är gratis att använda. Servern, lagringen och kartberäkningarna kostar varje månad; använder du O-Tid och tycker att
det fungerar tas ett bidrag gärna emot via Swish **076-122 73 87**. GitHub Sponsors kommer att öppnas för den som vill bidra
från utanför Sverige; mejla så länge via kontaktadressen på [Om O-Tid](https://otid.berring.se/om#stod).

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

**Efter `git pull` till steg 28:** databasen kör vanlig `postgres:17` i stället för PostGIS (också på Mac med
Apple-chip, utan emulering). `docker compose up -d postgres` byter bild; datan finns kvar (samma volym och
huvudversion). Ta en säkerhetskopia först:

```bash
docker compose exec -T postgres pg_dump -U otid -Fc otid > otid-fore-steg-28.dump   # med den gamla bilden
git pull
docker compose up -d postgres   # byter till postgres:17, samma volym
pnpm db:migrate                 # 0007: tar bort PostGIS-tillägget och uppdaterar sorteringsversionen
```

Om databasen mot förmodan inte startar (`docker compose logs postgres`): `docker compose down -v`,
`docker compose up -d postgres`, `docker compose exec -T postgres pg_restore -U otid -d otid --no-owner < otid-fore-steg-28.dump`
(fel om `postgis` kan ignoreras) och `pnpm db:migrate`.
`pnpm dev` och `pnpm build` bygger först det offlinekapabla
appskalet för avläsningen (`/readout/`) med `pnpm --filter @o-tid/web build:shells`.
`pnpm dev` startar också utskriftsarbetaren som skriver PDF:erna för tryck (steg 65, ADR-0184); utan `pnpm dev` körs den
med `pnpm print:worker`, och `OTID_PRINT_WORKER=off` stänger av den.

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

`docker compose -f docker-compose.prod.yml pull` och sedan `up -d` (färdiga avbildningar från ghcr.io som GitHub Actions
bygger efter grön CI på `main`, ADR-0195; att bygga på servern finns kvar som reserv), med PostgreSQL, webb (två instanser),
Caddy (HTTPS) och backup varje timme. Se [docs/drift.md](docs/drift.md). Hur stora tävlingar en liten server klarar och hur
lasttestet körs om (`pnpm lasttest:seed`, `pnpm lasttest:load`): [docs/lasttest.md](docs/lasttest.md).

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
packages/course-setting  banläggning: banor, gafflingar, kontrollbeskrivningar, utskriftsark (ren, ingen I/O)
packages/print-pdf    tryck-PDF med kartan som vektorer, dekorfärger och övertryck
packages/map-file     läsning och ritning av kartfiler (OCAD, Mapper), koordinatsystem, magnetisk nord
packages/map-revision kartritningen: ändringar, verktyg, grundkartan ur laser, sprintytor (ren, ingen I/O)
packages/route-choice vägvalsanalys på kartan
packages/club-archive import av klubbens kartarkiv
scripts/geo-*.ts      geo-arbetaren: laserkörningar (Karttapullautin och egna steg) på en tillfällig server
docs                  arkitektur, domänregler, drift, ADR:er, arkiv
```

Se [docs/architecture.md](docs/architecture.md) och [docs/domain-rules.md](docs/domain-rules.md).

## Verifiering

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:integration   # kräver TEST_DATABASE_URL (PostgreSQL, roll med CREATEDB)
pnpm test:e2e           # kräver E2E_DATABASE_URL eller TEST_DATABASE_URL; startar webben på port 3100
E2E_BASE_URL=https://localhost pnpm test:e2e   # mot en körande driftmiljö
```

## Licens

MIT – se [LICENSE](LICENSE). Du får använda, ändra och sprida koden fritt, också i egna och kommersiella program, så länge
licenstexten följer med koden. Det är inget krav, men nämn gärna att den kommer från O-Tid
(https://github.com/joelberring/otid) – det gör ägaren glad.
