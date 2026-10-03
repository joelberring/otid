# TASK247: tät och neutral separat starttidsadministration

Status: genomförd 2026-09-27.

## Användarutfall

Den separata sidan `/admin/[raceId]/start-times` ska kännas som samma
arbetsverktyg som tävlingens `/manage`: grafitgrå normalpalett,
konsekvent mindre text, tunna avdelare och få stora rutor. På bred
skärm ska deltagarsökning, vald tid och redigeringsfält få plats utan
onödig vertikal scroll. På mobil ska ordning och minst 44 px tryckmål
bestå utan horisontellt sidspill.

## Arkitektur- och licensgräns före implementation

ADR-0072 ger redan `MANAGE_RACE` en starttidsrättning i den gemensamma
arbetsvyn och bevarar den äldre separata `CHANGE_ENTRY_START_TIME`-vägen.
Detta snitt ändrar bara den senare sidans presentation: ingen ny
behörighet, mutation, idempotens, tidszonstolkning, domänregel eller
databasstruktur. Namn/klassökning, uttryckligt personval, fryst
granskning, samma retry-intent och kravet på separat omräkning
behålls. Inga externa UI-källor eller AGPL-implementationer återanvänds.
Ingen ny ADR eller migration behövs.

## Riktad acceptans

- Normal sidkrom och ordinarie åtgärder är neutrala, inte gröna.
- Länkad deltagare är en textmärkt neutral genväg, inte en grön
  framgångssignal; bekräftat sparande är också text, inte ett stort kort.
- Osäkert återförsök och faktisk felstatus är läsbara med text och
  återhållen gul/röd signal, aldrig enbart färg.
- 390/1366 px visar sökning, val, tid, granskning och återförsök utan
  sidspill; mobila fält/knappar minst 44 px.
- Riktad webblint/typecheck/build, befintligt syntetiskt TASK019-
  browserflöde och dess E2E-TypeScript/ESLint räcker. Ingen riktig
  tävling, databas, credential eller ny testsuite behövs.

## Ingår inte

Nytt starttidsschema, lottning, klassbyte, automatisk omräkning,
publika sidor, station, speaker, GPS, USB eller bred global ommålning.

## Utfall och verifiering

Den separata starttidssidan har sidlokal grafitgrå palett och smala
avdelare i stället för dominerande paneler. På desktop står sökning
och deltagarval i samma rad, följt av aktuell tid och tre tidsfält.
Mobilen behåller en kolumn med minst 44 px inmatningsfält. Länkad
deltagare och bekräftat sparande är neutrala textmärkta tillstånd;
fryst granskning är tydlig och okänt svar får gul textstödd signal.
Ett faktiskt fel får röd textstödd status. Sekundära knappar är ljusa,
medan huvudåtgärden får mörk neutral vikt. Sökning, behörighet,
tidskonvertering och idempotent retry ändrades inte.

Riktad webblint, web-typecheck, E2E-TypeScript/ESLint och
Next-produktionsbuild gav alla **exit 0**. Det befintliga syntetiska
TASK019-Next-/Chromium-provet passerade **2/2** efter sista CSS-
korrigeringen, vid 390 och 1366 px. Skärmbilder av redigering och
osäkert svar granskades; inget horisontellt sidspill uppstod.

Detta verifierar inte verklig databas/credential, fysisk mobil,
faktisk tidsbokning eller automatisk resultatomräkning.
