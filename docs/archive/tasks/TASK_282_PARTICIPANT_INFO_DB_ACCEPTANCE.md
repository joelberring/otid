# TASK282: deltagarens läsläge och explicit klassbyte mot isolerad databas

Status: genomförd, riktat databasverifierad 2026-10-01.

## Mål och gräns

Verifiera TASK281:s läsläge med riktig Next-HTTP och PostgreSQL/PostGIS:
ett vanligt val av Åsa visar deltagar- och resultatunderlag utan
klassbytesformulär. Först ett explicit ”Byt klass” öppnar formuläret;
det befintliga TASK029-fallet fortsätter genom kapacitet, starttid,
exakt retry och DB-journal. Ingen produktkod, domänregel, API eller ADR
ändras.

## Säker testmiljö

- Återanvänd endast den tidigare av oss skapade och stoppade syntetiska
  PostgreSQL 17/PostGIS-instansen i
  `/private/tmp/otid-task277-pg17.SqxumYWS`, efter läsande kontroll av
  version, port, process och databaslista. Skapa en ny namngiven tom
  testdatabas; `DATABASE_URL` och `TEST_DATABASE_URL` måste matcha exakt.
- Ingen `.env.local`, demo- eller riktig tävlingsdatabas får användas.
  TASK029-fixturen skriver syntetiska rader och tar inte bort dem; en
  körningsunik databas används därför och dess rester redovisas.
- Kör enbart det befintliga desktopfallet `TASK029 samma login och
  verkligt klassbyte 1366`, plus riktad E2E-typkontroll och lint.
  Servern kör på loopback3122. Stoppa den egna PostgreSQL-klustern efteråt.

## Acceptans

- Valet visar gällande resultat och kontrollsektion utan `Ny klass`.
  Explicit ”Byt klass” visar sedan rätt editor.
- Befintlig funktion för kapacitet, starttid, konflikt/retry och
  oföränderlig historik passerar samma fall mot den isolerade databasen.
- Resultat, databasrester och eventuella antaganden dokumenteras exakt.

## Ingår inte

Full TASK029-svit, fysisk mobil, skärmläsare, verklig tävling,
produktion, schemaändring eller ny funktion.

## Genomfört och exakta resultat

Det befintliga desktopfallet återanvändes, utan ny produktkod eller
testsvit. Ett vanligt deltagarval verifierar att `Ny klass` saknas och
att kontrollsektionen visas; klassbyte öppnas uttryckligen. Befintliga
kontroller av kapacitet, exakt retry, starttid, omräkning, rådatans och
resultatrevisionernas oföränderlighet passerade. Samma äldre fall
fortsätter genom brickbyte, namn/klubb, historik, direktanmälan och
utloggning. Dess desktopbild granskades: neutral kompakt layout utan
horisontell overflow, men lokal detaljscroll kan flytta deltagarfakta
ur bild när historiken öppnas.

Testets gamla navigering och oavgränsade fält/statusselektorer rättades:
deltagargränser öppnas via Före → Klasser, deltagarsökningen har panel-
scope och kvitton väljs med sin text. Efter återgång till fri start
verifieras att fast starttidsredigering är avstängd, inte att knappen
går att klicka. Inga server- eller behörighetsregler ändrades.

- `CI=true pnpm db:migrate`, med explicit TASK282-DATABASE_URL:
  exit 0, migrationer klara.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json`:
  exit 0 efter sista teständringen.
- ESLint för `task-029-race-administrator.spec.ts` och dess config med
  `tsconfig.race-administrator.json`: exit 0 efter sista teständringen.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep 'TASK029 samma login och verkligt klassbyte 1366'`:
  slutkörning exit 0, **1/1**, 49,8 s.
- Sex tidigare körningar av exakt samma fall: exit 1. Orsaker i ordning:
  dold deltagargräns, tvetydigt statusfält, tvetydig Deltagare-knapp,
  tvetydigt sökfält, tvetydigt sparandekvitto, klick på avstängd
  starttidsknapp. Inget ytterligare fall eller någon bred svit kördes.
- Web-build/lint/typecheck återkördes inte: produktkoden är oförändrad
  från TASK281:s gröna kontroller. Detta snitt verifierar teständringar
  och verklig HTTP/DB, inte ett nytt produktbygge.

## Miljö och bevarade rester

Port 55460 identifierades med läsande process- och SQL-kontroll som
vår temporära PostgreSQL 17.11-kluster i
`/private/tmp/otid-task277-pg17.SqxumYWS/data`; en missvisande sandboxad
`pg_ctl status` användes inte som skäl att starta en andra instans.
PostGIS rapporterade 3.6.4. Den nya databasen
`otid_task282_synthetic_20261001` var tom före migration/fixturer och
användes som både DATABASE_URL och TEST_DATABASE_URL. Sju körningar
lämnade 7 event, 7 lopp, 10 deltagare, 5 klassbytesjournaler,
4 resultatrevisioner och 2 råmeddelanden. Endast syntetiska data.
Databasen är bevarad för felsökning; ingen databas raderades.
Den identifierade temporära servern stoppades med exit 0 efter provet.
Ingen demo, Eventornyckel eller riktig tävlingsdata användes.

## Kvarvarande antaganden och nästa minsta uppgift

- Bara desktop 1366 px kördes mot DB; mobil och fysiskt fältbruk är
  inte verifierade här. Det äldre mobilfallet har andra kvarvarande
  navigationsförväntningar och ska inte beskrivas som grönt.
- UI-bilderna har syntetiska personer och säger inget om fysisk
  skärmläsbarhet, regn eller handskar.
- Testet simulerar förlorade svar men använder verkliga serverwrites;
  det är inte ett fältprov av nätavbrott.

Nästa minsta vertikala uppgift: behåll en liten läsande identitetsrad
för vald deltagare synlig inom desktopens detaljpanel när kontroller
eller historik scrollas, utan större global toppyta eller ny skrivväg.
