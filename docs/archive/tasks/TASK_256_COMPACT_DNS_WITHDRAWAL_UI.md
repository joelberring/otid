# TASK256: kompakt återtagande av Ej start

Status: klar 2026-09-27.

## Användarutfall

Målpersonal ska kunna överblicka tidigare manuella Ej start-beslut,
skilja återtagbara från återtagna och ersatta beslut, och säkert granska
exakt deltagare och DNS-revision före ett återtagande. Vyn ska vara
neutral, tät på desktop och ordnad på mobil utan sidspill eller stora
permanenta varningsrutor.

## Gräns före implementation

ADR-0030 och befintlig `WITHDRAW_DID_NOT_START`-serverväg gäller
oförändrat. Återtagandet är ett separat immutable livscykelbeslut, inte
en ny resultatrevision eller bevis på fysisk start/återkomst. Det
uttryckliga andra bekräftelsesteget, senaste-revisionsgrinden, separat
credential, CSRF, minnesburet intent och exakt same-id-retry måste
bevaras. Detta snitt ändrar endast presentation och svensk hjälptext;
ingen teknik, dependency, migration, API eller domänregel införs och
ingen ny ADR behövs.

## Riktad acceptans

- Kompakt status för internet, session och återtagbara beslut; neutral
  vit/grå vardagskrom och få textstödda signalaccenters användning.
- Täta rader med namn, klubb, klass, entryversion, tillstånd,
  target-DNS-revision, eventuell senare revision/tidpunkt och åtgärd.
  Blockerad åtgärd ser avaktiverad ut och är disabled.
- Bekräftelsesteget visar exakt fryst deltagare, klass, revision och
  snapshot; konsekvensen att aktuellt resultat saknas sägs tydligt.
  Osäker commit hålls visuellt åtskild från pågående skrivning och
  kräver explicit same-id-retry.
- Mobil har läsbar ordning och minst 52 px knappar. Ett riktat UI-test
  och ett syntetiskt browserfall vid 390/1366 px kompletterar berörd
  lint/typecheck/build. Inget verkligt databasanrop behövs.

## Ingår inte

Ingen ändring i gemensam administratörsvy, DNS-beslutets skapande,
resultatmotor, skogskontroll, offlinekö eller fysisk enhetsacceptans.

## Utfall och verifiering

Den separata vyn har neutral vit/grå vardagskrom, låg statusrad för
internet/session/återtagbara beslut och täta sexkolumnsrader på desktop.
Mobilen visar samma historik i en tydlig ordning utan sidspill och har
minst 52 px knappar. Återtaget respektive senare ersatt DNS är synligt
men kan inte väljas. Tvåstegsgranskningen visar fryst deltagare, klass,
DNS-revision och snapshot samt konsekvensen att aktuellt resultat saknas.
Granskningen scrollas fram, och ett osäkert skrivsvar får en separat
textmärkt retry-panel med samma request-id; ingen automatisk retry sker.

- Riktade UI-/klientprov: 7/7, exit 0.
- Syntetiskt Chromiumprov: 1/1, exit 0 vid 390/1366 px. Normal vy,
  mobil, bekräftelse och retry granskades i skärmbilder; testet kräver
  synlig bekräftelseknapp, inget horisontellt spill och byteidentisk
  requestkropp/idempotensnyckel vid retry.
- Webblint, typecheck och build: exit 0 var för sig.
- Riktad E2E-TypeScript och ESLint: exit 0 var för sig.

Den första gröna browserkörningens bilder visade en för lång
desktopkolumnrubrik och en mobilbekräftelse långt ned i viewporten.
Rubriken kortades till »Version«, bekräftelsen scrollas fram och den
slutliga browserkörningen passerade det skärpta viewportkravet.
Ingen isolerad PostgreSQL-databas, verklig credential, fysisk mobil
eller SPORTident-hårdvara användes.
