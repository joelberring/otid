# TASK245: tydlig importingång i tävlingsförberedelserna

Status: genomförd 2026-09-27.

## Användarutfall

I `/admin/[raceId]/manage` → Före tävlingen → Upplägg ska arrangören
direkt se var IOF-filimport och import av Eventoranmälningar finns.
Ingången ska vara en kort rad i den befintliga täta arbetsytan, inte
ett stort kort eller ett nytt formulär. Den ska fungera på mobil och
dator utan horisontell sidscroll.

## Avgränsning och arkitekturbeslut före implementation

ADR-0017 behåller `IMPORT_IOF` som separat racebunden capability och
importsida med egna cookies/CSRF och explicit retry. ADR-0114 kräver
dessutom ett ägarutfärdat importbidrag och manuell klassmappning för
Eventoranmälningar; ADR-0116 tillåter både test- och produktionsprofil.
Detta snitt länkar endast till den **befintliga** `/imports`-ytan och
förklarar behörigheten utan att antyda att `MANAGE_RACE` ger importrätt.
Ingen credential, grant, fil eller Eventornyckel förs mellan ytorna.
Länken spärras medan arbetsytan har en pågående låst åtgärd, precis som
dess befintliga externa navigation. Inga API-, databas-, teknik- eller
domängränser ändras; ingen ny ADR eller migration behövs.

## Riktad acceptans

- Upplägg visar en kort länk för exakt aktuellt lopp, med skilda
  förklaringar för IOF XML och Eventoranmälningar samt separat
  importbehörighet.
- Låst arbetsläge ger ingen aktiv utgång till importen.
- 390/1280 px behåller den neutrala, täta formen utan sidspill.
- Berörd lint/typecheck, ett UI-prov, ett befintligt syntetiskt
  browserflöde och build räcker; ingen databas, credential eller
  extern Eventorläsning behövs.

## Ingår inte

Importstatus eller falska färdigmarkeringar, ändrad importbehörighet,
nya formulär, profilprojektion, automatisk klassmappning, filsynk eller
verkliga Eventoranrop.

## Utfall och verifiering

Upplägg visar en tunn importingång ovanför klassöversikten. Länken
pekar på exakt aktuellt lopp och förklarar både IOF XML och den
grantbundna Eventorvägen utan att blanda ihop `MANAGE_RACE` med
`IMPORT_IOF`. När en pågående åtgärd låser arbetsytan visas texten
utan aktiv länk. Inga importformulär eller serverrättigheter ändrades.

Berörd webblint/typecheck och E2E-ESLint/TypeScript gav exit 0.
Det riktade UI-provet passerade 2/2 efter att en saknad React-import
i testmiljön rättades (första körningen 0/2). Det befintliga
syntetiska Next-/Chromium-flödet med 500 deltagare/60 klasser
passerade 1/1, även efter att länken klickades till importsidan.
390/1280 px-skärmbilder granskades, utan horisontellt sidspill.
Checkin-förberedelsen och Next-produktionsbygget gav exit 0.

Detta verifierar inte importbehörighet, XML-commit, Eventorgrant,
verkligt API, riktiga personuppgifter eller fältanvändning. Den
befintliga Eventorpanelen har fortfarande en Testeventor-specifik
rubrik trots att produktionsprofil är accepterad; en profiltrogen
förhandsvisning behöver eget snitt.
