# TASK066: uppföljning efter byte till minutstart

Implementerad och riktat verifierad 2026-09-18. Detta är nästa minsta
vertikala snitt efter TASK065; ingen produktionsdriftsättning ingår.

## Användarvärde

När en klass har `FIXED` ska tävlingsadministratören i samma kompakta panel
kunna se vilka deltagare som saknar fast starttid och öppna den befintliga
individuella starttidsrättningen för vald deltagare. Därmed blir regelbytet
operativt uppföljningsbart utan ny sökning eller lång navigering.

## Avgränsning

- Återanvänd redan validerat deltagarunderlag i gemensam adminvy.
- Visa endast aktuell vald `FIXED`-klass och deltagare med `fixedStartTime=null`.
- Stabil svensk namnsortering med ID som tie-breaker.
- Begränsa den direkt synliga listan och visa ärligt totalantal.
- Genvägen väljer deltagaren, växlar till befintlig Starttid-åtgärd och flyttar
  fokus till arbetsytan; den sparar ingenting.
- Ingen ny route, databasfråga, migration, behörighet eller offlinekö.
- Ingen automatisk lottning, tidstilldelning, omräkning eller publicering.

## Arkitektur

Ingen ny ADR krävs. Snittet ändrar inget beslut i ADR-0098 eller ADR-0072:
klassregelbytet och individuell starttidsrättning förblir separata explicita
serverbeslut. Detta snitt är en skrivfri klientprojektion och navigationsgenväg.

## Berörda filer

- Befintlig ren projektion i `apps/web/src/lib/target-class-start-times.ts`.
- Ett litet komponent-/UI-tillägg i gemensam administratörsvy.
- Svensk UI-text och befintlig komponent-CSS.
- Riktade enhets- och browserprov.

## Acceptans

1. Endast saknade tider i vald FIXED-klass visas; annan klass och satta tider
   utelämnas utan att underlaget muteras.
2. Namn sorteras deterministiskt och fler poster än synlig gräns redovisas.
3. Klick på en deltagare öppnar befintlig starttidsåtgärd med rätt deltagare,
   även i mobil arbetsvy, men skickar inget skrivande API-anrop.
4. Efter sparad individuell tid och uppdaterat roster försvinner deltagaren ur
   uppföljningslistan; klassregelbytet eller gamla journaler skrivs inte om.

## Verifiering

Kör endast det nya rena enhetsprovet, web lint/typecheck/build samt det
namngivna TASK066-browserfallet. Bred regression och nya PostgreSQL-prov behövs
inte eftersom all serverpersistens återanvänds oförändrad och redan täcks av
TASK031/TASK065.

Genomfört: den befintliga projektionen exponerar deterministiskt sorterade
saknade deltagare; panelen visar åtta åt gången med ärlig sid-/totalräkning.
Genvägen väljer deltagaren, växlar till befintlig starttidsrättning och
fokuserar arbetsytan. Efter sparad tid laddas roster om och raden försvinner.
