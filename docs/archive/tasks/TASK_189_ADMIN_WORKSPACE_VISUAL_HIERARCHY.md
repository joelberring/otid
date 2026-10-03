# TASK189: renare hierarki i tävlingsarbetsytan

Status: klar 2026-09-25. Avgränsning dokumenterad före kod.

## Användarutfall

På dator och padda ska vald deltagares fakta kännas som första delen av samma
arbetsyta som resultat och aktiv ändring, inte som en extra ruta inuti rutan.
På Före → Upplägg ska klassernas faktiska start- och kapacitetsdata komma före
generiska råd. De sex arbetsstegen får stå kvar som vägledning, men en andra
uppsättning knappar med samma mål som områdesflikarna tas bort.

## Gräns

Endast renderingsordning och lokalt avgränsad CSS i `/manage`. Befintliga
områdesflikar, sex steg, personfakta, vanliga ändringar och behörighets-/
pending-lås behålls. Mobilens personkort och 44 px primära tryckmål ändras
inte. Ingen data, domänregel, API, behörighet, migration eller teknik ändras;
ingen ADR behövs.

## Kontroll

Återanvänd ett syntetiskt browserfall vid 390/900/1280 px: personfakta,
aktiv ändring och sekundära delar i rätt ordning; klassdata före steg på
Upplägg; flikarna ger fortsatt åtkomst till alla sex områden; inga dubbla
snabbknappar i vägledningen. Riktad lint, typecheck och webbuild. Inga nya
databastester eller externanrop för detta presentationssnitt.

## Utfall

En läsande Sol-granskning identifierade kort-i-kort i vald deltagares
arbetsyta; ingen avvikande fontfamilj hittades. Personfakta har nu ingen egen
ram eller utfyllnad på skärm från 721 px, men samma semantiska sektion,
faktarader och knappar. Mobil behåller sin avgränsade ruta. På Upplägg
kommer klassernas start/kapacitet först, följt av de sex synliga stegen.
Den dubbla snabbknappsraden är borttagen; befintliga områdesflikar finns kvar.

Riktade kontroller:

- Web-TypeScript och ESLint för fyra berörda `.tsx`/`.ts`-filer: exit 0.
- E2E-TypeScript och ESLint för det utökade befintliga browserfallet: exit 0.
- `CI=true ./node_modules/.bin/playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts`: 1/1 passerade, 17,3 s, exit 0. Provet kontrollerar 390/900/1280 px, mobilram men ingen nästlad desktopram, faktaruta/aktiv ändring, klassdata före steg, sex kvarvarande steg, inga dubbla snabbknappar och befintlig navigation.
- Next produktionsbuild med icke-fungerande byggplaceholder för `DATABASE_URL`: exit 0, sidgenerering 22/22.

Skärmbilder för desktop finns i testets `participants-desktop.png` och
`preparation-desktop.png`. Antaganden: syntetiska sex deltagare och tre
skärmbredder representerar layouten; fysisk mobil/padda, verklig större
startlista och användarprov återstår. Ingen riktig tävlingsdata ändrades.
