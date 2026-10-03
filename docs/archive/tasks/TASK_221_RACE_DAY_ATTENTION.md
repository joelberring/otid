# TASK221: kompakt avvikelseöversikt under tävlingsdagen

Status: Genomförd och syntetiskt UI-verifierad, 2026-09-27.

## Användarutfall

I `Under tävlingen → Läget` ska operatören utan att öppna flera paneler se
vilka redan kända avvikelser som behöver följas upp: motstridiga
start-/återkomstuppgifter, rapporterat startade utan registrerad återkomst,
okänd startstatus och okända målavläsningar. Varje uppgift ska kunna leda
direkt till den befintliga detalj-/åtgärdsvyn.

## Gräns och sanningsvillkor

Detta är en privat, läsande projektion av befintliga validerade
`forest-watch`- och `unknown-readout-resolution`-svar. Inga nya statusar,
domänregler, endpointar, migrationer, behörigheter eller mutationer. Räkna
hela loppets grupper, inte aktuell sök-/klassfiltrering. Hämta de två
underlagen sekventiellt i en och samma begäran/operation så att befintlig
busy-, timeout- och sessionsspärr respekteras. Den automatiska 15-sekunders-
uppdateringen får fortsatt endast gälla skogsrapporten; okända avläsningar
hämtas när Läget öppnas eller genom explicit uppdatering.

Visa källa, tävlingsversion och lästid. Ett gammalt, misslyckat eller ännu
inte hämtat underlag får inte framstå som aktuell nolla. Håll skogs- och
avläsningsräkningar åtskilda om deras versioner/lästider skiljer sig.
Förklara att osynkade mobilköer är okända och att nollor inte bevisar att
skogen är tom. Aldrig en grön `allt klart`-signal. Åtgärdsknappar får inte
gå förbi pågående granskning eller befintligt workflow-lås. Behåll den
kompakta neutrala TASK215/219-skalan; gult/rött används bara med textstöd
för saknat/gammalt respektive konkret konflikt. Mobil har minst 44 px
tryckmål och inget horisontellt sidspill.

Enbart `apps/web`-arbetsytan, dess CSS och svensk i18n ändras; vid behov en
liten ren summeringsfunktion. Ingen ADR krävs eftersom teknikval och
domängränser är oförändrade. Detta påstår inte fältgodkänd skogssäkerhet,
offlinekä eller verklig hardware-/stationssynk.

## Riktad acceptans

Kontrollera summering för konflikt/startad/okänd/okänd avläsning och
`0`/saknat underlag. Återanvänd ett syntetiskt browserprov utan databas:
Läget visar rätt antal och källversion/lästid, avvikelselänk öppnar
befintlig panel, misslyckat/stale-svar fabricerar inte aktuell nolla,
390 px saknar sidspill och tryckmål är minst 44 px. Riktad webblint,
typecheck och build. Ingen bred PostgreSQL-/hardware-/E2E-svit för ett
rent presentationssnitt.

## Utfall och verifiering

`Läget` visar fyra separata avvikelseantal med direktöppning av de
befintliga skogs- respektive avläsningspanelerna. Skogsrapportens
serverläsning och avläsningskandidatens lokala hämtningstid/version visas
var för sig. Antal blir `Okänt – uppdatera` vid utebliven/gammal källa,
utan falsk aktuell nolla. Ett öppnat skogsärende rensar tidigare rapport-
filter så att rätt grupp verkligen visas. Endast skogsrapporten behåller
sin tidigare valfria 15-sekundersuppdatering. Den permanenta
synkosäkerheten är neutral text; konkret konflikt röd och gammal/saknad
källa gul. Desktop har två täta kolumner, mobil en kompakt rad per avvikelse.

Slutkontroller: webblint **exit 0**, web-typecheck **exit 0**,
web-build **exit 0**, E2E-TypeScript/ESLint **exit 0**, återanvänt
syntetiskt Playwright **2/2, exit 0**. Browserfallet kontrollerade fyra
antal, separata källuppgifter, 503-fel utan fabricerad nolla, direktöppning,
filterrensning, 390 px utan sidspill, minst 44 px tryckmål och 1280 px utan
sidspill. Mobil- och desktopbilder granskades. Första browserkörningen gav
1/2 på en tvetydig testlocator för skärm- och utskriftskopian av samma
rapport; locatorn avgränsades och slutkörningen passerade. Ingen riktig
databas/tävling, mobilstation eller hårdvara provades.
