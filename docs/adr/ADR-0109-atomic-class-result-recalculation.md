# ADR-0109: atomisk klassbunden explicit resultatomräkning

- Status: Accepterad för TASK091
- Datum: 2026-09-19

## Kontext

Den befintliga `RECALCULATE_RESULT`-vägen räknar om exakt en Entry med en
fryst grund: Entry/version, klass, race-snapshot, aktiv brickkoppling, senaste
avläsning, senaste revision och motorversion. Den appenderar en publicerad
teknisk revision, journal och audit atomiskt. Efter en relevant konfigurations-
eller banändring kan en administratör däremot behöva behandla en hel klass.

Att låta webbläsaren skicka N individuella requests skulle ge delvis committade
resultat, otydlig retry efter nätfel och ett slutunderlag som inte har
granskats som helhet. Enbart `snapshotVersion` räcker inte: ingest eller en
annan omräkning kan skapa en ny revisionsgrund utan att snapshot ändras.

## Beslut

TASK091 inför en separat, explicit gruppåtgärd för högst 100 valda Entries i
en och samma aktuella Class inom ett Race. Den återanvänder `MANAGE_RACE`, men
inte den individuella routen som en intern eller klientdriven loop.

Den skyddade granskningen visar för en vald Class en sorterad manifestgrund:

- Entry, Entry-version och klass,
- aktuell race-snapshot och motorversion,
- exakt en aktiv brickkoppling,
- senaste avläsning,
- senaste revisionshuvud och dess snapshot,
- readiness och en canonical manifesthash.

Endast explicit valda `READY`-Entries vars senaste revision är äldre än
nuvarande race-snapshot är möjliga att inkludera. Blockerade eller aktuella
rader visas som underlag men kan inte tyst inkluderas. Texten säger alltid
”kan behöva omräkning”; underlaget påstår inte orsak eller att det effektiva
manuella resultatet kommer ändras.

POST binder Class, ordnad entrylista, manifesthash, snapshot och motorversion
till ett nytt idempotensintent. Servern läser om och validerar hela grunden i
en transaktion: autentisering → race `SHARE` → grupprequestens advisory lock →
Entries `UPDATE` i canonical UUID-ordning → revisionsappend. Varje Entry får
en ny `EXPLICIT_RECALCULATION` bara om samtliga valda Entries fortfarande
matchar manifestet. Minsta avvikelse ger konflikt utan en enda ny revision eller
gruppjournalrad.

En additiv immutable gruppheader med items binder actor, request, klass,
manifestgrund och skapade revisionsrader. Exakt retry återger samma manifest;
annan actor, scope eller intent konflikterar. Resultatets enskilda
revisionsnummer förblir lokalt obrutna.

## Konsekvenser och gränser

- Aktiva manuella beslut bevaras. Nya tekniska revisioner kan ligga under
  deras effektiva resultat precis som vid individuell omräkning; inga beslut
  återtas eller fabriceras.
- Rawdata, readout, brickkoppling, Entry-, klass- och snapshotversion samt
  motor ändras inte. Varje lyckad item appenderar endast en publicerad teknisk
  revision och sin auditprovenans.
- Livepublik och ranking kan ändras efter commit. Frysta Complete-XML och äldre
  finaliseringar ändras aldrig; en ny finalisering måste fortsatt bevisas
  separat.
- Ingen automatisk klassomräkning följer av import, startregel, banändring,
  brickbyte eller klassbyte. Ingen selektion över flera klasser, ingen karta,
  GPS, rutt, stafett eller SPORTident/USB ingår.

## Återställning

Vägen stängs vid incident; redan appendade revisions- och gruppjournalrader
raderas aldrig. Återställning av produktion följer ordinarie backup/restore.
En ny avsiktlig omräkning skapar en ny grupprevision, inte en ändring av
historiken.
