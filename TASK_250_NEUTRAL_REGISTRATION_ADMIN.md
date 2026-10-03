# TASK250: neutral och tät separat direktanmälan

Status: klart 2026-09-27.

## Användarutfall

Den fortfarande nåbara separata sidan `/admin/[raceId]/registration`
ska ha samma lugna, informationstäta uttryck som tävlingsarbetsytan.
På desktop ska klass, namn, frivillig klubb/bricka och den valda
starttidsvägen vara lätta att överblicka utan en lång rad stora kort.
Mobilen ska behålla tydlig ordning och 52 px manöverdon utan sidspill.

## Arkitektur- och beslutsgräns före implementation

ADR-0041 och ADR-0076 behåller separat `REGISTER_ENTRY`-session för
den äldre sidan och `MANAGE_RACE` för gemensam administration. ADR-0122
behåller explicit, serverbevisad lottad fast starttid som frivilligt
alternativ till manuell undantagstid. Registreringens klass-/snapshot-
bindning, brickägarskap, granskning, atomisk journal och frysta
samma-id-retry ändras inte. TASK250 ändrar endast presentation av den
separata sidan. Ingen ny teknik, dependency, domängräns, behörighet,
lagring, mutation eller migration införs; ingen ny ADR behövs.

## Riktad acceptans

- Neutral sidkrom och enhetlig typografi. Permanent driftförklaring
  är läsbar men tar inte över sidan; normal knappar/formulär är grafitgrå.
- Klass och versionsunderlag syns nära formuläret. Namn och valfria
  fält ordnas kompakt på desktop, medan PUNCH/FIXED och lottad/manuell
  starttid fortfarande förklaras tydligt när de väljs.
- Granskning visar namn, klass, klubb, bricka och eventuell starttid
  innan sista bekräftelse. Okänt svar/retry är textmärkt gult, faktiska
  fel textmärkt röda och sparatbesked neutralt; färg är aldrig enda signalen.
- Mobilens formulärkontroller är minst 52 px och sidan spiller inte
  horisontellt vid 390/1366 px.
- Ett riktat syntetiskt Next-/Chromiumprov granskar PUNCH och FIXED-
  layout samt osäkert retry utan databas eller riktig credential.
  Kör berörd webblint/typecheck/build och E2E-TypeScript/ESLint.

## Ingår inte

Ingen ändring av registreringslogik, kapacitet, dubblettpolicy,
startslotreservering, Eventor, stationens offlinekö, resultat,
stafett, GPS, USB eller bred ommålning av andra sidor.

## Utfall och verifiering

Den separata direktanmälan har nu neutral sidkrom, tunna avdelare,
tvåkolumniga namn-/valfria fält på desktop och en ordnad mobilkolumn.
Fri start och fast start beskrivs vid klassval; för fast start syns
fortsatt både manuell undantagstid och verifierat lottat val. Den
lottade instantens etikett visas som läsbart datum/klockslag märkt UTC,
medan optionens exakta värde lämnas oförändrat.
Granskningen ersätter formuläret tillfälligt, visar sammanhängande
personnamn/klass och övrigt fryst intent, och okänt svar visas en gång
i textmärkt gul panel. Faktiska fel visas med textmärkt röd signal.
Ingen auth-, request-, kapacitets-, startslot- eller retrylogik ändrades.

`CI=true pnpm --filter @o-tid/web lint`, `typecheck` och `build`:
exit 0. E2E-TypeScript och E2E-ESLint: exit 0. Riktat syntetiskt
Chromiumprov `--grep TASK250`: 2/2 passerade vid 390/1366 px,
inklusive PUNCH, manuell/lottad FIXED-visning och exakt same-id-retry.
Normal- och retrybilder granskades utan horisontellt spill. Första
browserkörningen gav 0/2 eftersom testet sökte ursprunglig `+02:00`-
text efter att kontraktet kanoniserat slotinstant till UTC; fixturen
rättades till att välja den visade kontraktsoptionen före grön omkörning.

Kvarvarande antaganden: verklig credential, serverns kapacitetskontroll,
PostgreSQL-journal och samtidiga anmälningar fungerar som i tidigare
genomgående prov; inget sådant prov eller fysisk touch kördes i detta
presentationssnitt. Den lottade instant visas i kontraktets UTC-form,
inte omräknad till loppets lokala tidszon eftersom det privata
slotkontraktet inte bär den zonen.

Efterföljande [TASK252](TASK_252_REGISTRATION_SLOT_RACE_ZONE.md) lade
till validerad tävlingszon i läskontrakten och lokal visning utan att ändra
skrivbegärans UTC-instant.
