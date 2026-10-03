# TASK 004 – konkurrenssäker multi-station-ingest

## Syfte

Stäng servergapet mellan TASK 001:s enstationssimulator och V1-kravet på flera
samtidiga avläsningsstationer:

> Två eller fler stationer ska kunna skicka avläsningar för samma bricka
> samtidigt utan att giltig rådata eller resultatrevisioner går förlorade.

Snittet är protokollneutralt. Det ändrar inte SPORTident-parsern, USB-lagret,
resultatreglerna eller tävlingens domängränser.

## Leverabler

- ett validerat svarskontrakt för device batch-ingest,
- paketversionsstatus `current`, `stale` eller `ahead`,
- aktuell serverpaketversion och uttrycklig uppdateringssignal,
- innehållshash i varje kvittens,
- serverns lagrade eller nyss beräknade resultatsammanfattning när sådan finns,
- konkurrenssäker allokering av resultatrevision per deltagare,
- en dokumenterad låsordning för snapshotläsning och tävlingsmutationer,
- simulatorn fryser queue-, device- och session-id per lokal post och validerar
  serverkvittensen innan den ändrar sin lokala kö.

Rådata med en äldre eller oväntat ny paketversion ska fortfarande tas emot när
batchen i övrigt är giltig. Servern räknar med sin auktoritativa snapshot och
signalerar versionsavvikelsen; den skriver inte om stationens paketversion.

## Lås- och transaktionskrav

Låsordningen är alltid:

1. lopp,
2. deltagare,
3. resultatrevision.

Resultatberäkningar tar ett delat radlås på loppet medan snapshoten läses.
Tävlingsmutationer som ändrar snapshotversion tar ett exklusivt radlås på
loppet. Revisioner för samma deltagare serialiseras med deltagarradens
`FOR UPDATE`-lås innan nästa revisionsnummer läses och infogas.

En kvittens med `stored` eller `duplicate` får lämnas först efter att den
refererade råposten är permanent lagrad. Oväntade system- eller databasfel får
inte omvandlas till falska per-event-kvittensbesked.

## Acceptanstester

1. Två samtidiga stationer på samma bricka ger två råposter, två avläsningar,
   två `stored`-kvittensbesked och revisionerna exakt `1, 2`.
2. Tio samtidiga stationer på samma bricka ger revisionerna exakt `1..10` utan
   uniknyckelfel eller dataförlust.
3. Hundra samtidiga omsändningar av samma device/sekvens/hash ger en råpost, en
   avläsning och en revision; övriga svar är `duplicate`.
4. En batch med giltig, hashfelaktig och giltig händelse sparar båda giltiga och
   ger tre uttryckliga kvittensbesked i indataordning.
5. En gammal paketversion sparas, markeras `stale`, kräver uppdatering och dess
   serverresultat anger aktuell snapshotversion.
6. En paketversion högre än serverns markeras `ahead`, sparas och ger ingen
   falsk uppmaning att hämta ett äldre paket.
7. Samma device/sekvens med annan hash avvisas utan att tidigare rådata,
   avläsning eller revision ändras.
8. API och simulator accepterar endast kvittenser som passerar det delade
   runtimevaliderade kontraktet.
9. HTTP-fel eller ogiltigt 2xx-svar på första köposten stoppar ordnad flush och
   lämnar senare sekvenser oskickade.
10. Ingest samtidigt med klassändring använder antingen hela snapshoten före
    eller hela snapshoten efter ändringen och avslutas utan deadlock.

## Berörda delar

- `packages/contracts`
- `packages/application`
- `apps/web` endast device-batch-route och simulatorns kvittenshantering
- `docs/architecture.md`
- `docs/offline-sync.md`
- `docs/acceptance-tests.md`
- `docs/status.md`

Ingen databasmigration behövs. Befintliga append-only-tabeller och uniknycklar
behålls.

## Ingår inte

- SPORTident-frameparser, probe eller kortavkodning,
- Android USB-runtime eller fysisk hårdvaruverifiering,
- SQLite/IndexedDB-station,
- signerat tävlingspaket eller enhetsparning,
- nya resultatregler,
- GPS, kartor, stafett eller Eventor.
