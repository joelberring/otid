# TASK 006C – domänägd klassranking i publikresultat och IOF-export

## Mål

Ge individuella publicerade resultat en sanningsenlig, deterministisk placering
och tid efter ledaren genom en enda ren domänfunktion. Samma härledning används
i den publika resultatlistan och i den befintliga autentiserade IOF XML 3.0
`ResultList`-exporten.

Snittet ändrar inte resultatrevisioner, publiceringsbeslut eller databasmodell.
Det inför inga nya resultatstatusar, ingen slutresultatmarkering och ingen
Eventor-klient.

## Arkitektur- och licensbeslut före implementation

- ADR-0027 låser urval, competition ranking, tie-policy, jämförbarhetsgräns,
  publik DTO och adapteransvar innan resultatkod ändras.
- Resultatlogiken ligger i `packages/domain` och är helt I/O-fri. SQL och XML
  får endast välja, validera respektive presentera redan härledd ranking.
- IOF:s officiella Data Standard 3.0-XSD används endast som faktakälla. Ingen
  extern kod eller schemafil kopieras eller vendlas.
- Ingen konflikt finns med `CODEX_BRIEF.md`, ADR-0026 eller nuvarande
  domängränser. TASK 006C fyller uttryckligen den rankinglucka som ADR-0026
  lämnade öppen.

## Berörda paket

- `packages/domain`: ren klassranking och fullständiga domäntester.
- `packages/contracts`: strikt, versionerad publik resultatprojektion utan
  interna resultat-/entry-id:n.
- `packages/application`: samma senaste-publicerade/historiska klassgrund för
  publikresultat och IOF-export samt anrop till domänrankingen.
- `packages/iof-xml`: validerar och serialiserar frivillig, redan beräknad
  `TimeBehind` och `Position`.
- `apps/web`: visar placering och tid efter med textbaserad förklaring när
  ranking saknas.
- `tests` och `docs`: regression, E2E, acceptans och status.

Ingen migration, ny capability, ny dependency eller write-route tillkommer.

## Auktoritativt resultaturval

1. Exakt högsta `revision` med `published = true` väljs per entry. En senare
   opublicerad revision får inte skymma den.
2. Revisionens historiska `evaluation.classId`, `courseVersionId`, status och
   heltalsmillisekunder används. Entryts aktuella klass får inte skriva om
   resultatets rankningsgrupp.
3. Aktuellt namn och organisation är fortsatt visningsdata eftersom historiska
   namnsnapshots saknas.
4. `UNKNOWN_CARD` och entries utan publicerad revision ingår inte.
5. Äldre snapshotrevisioner ingår enligt ADR-0026. Stale snapshot bevisar inte
   i sig att tiderna är ojämförbara.

## Rankingpolicy

- Endast `OK` med en icke-negativ säker heltals-`elapsedMs` är rankbar.
- Ranking sker inom revisionens historiska klass.
- Position är competition ranking: `1 + antal strikt snabbare`. Exempel:
  `1, 1, 3` och `1, 2, 2, 4`.
- Exakt lika heltalsmillisekunder delar placering. Namn eller internt id får
  aldrig bryta en resultatmässig tie.
- `timeBehindMs = elapsedMs - snabbaste OK-tid` i klassen. Alla delade vinnare
  får noll.
- `MP` visas efter rankade resultat men får varken position eller tid efter.
- Om klassens rankbara OK-resultat hänvisar till fler än en historisk
  `courseVersionId` utelämnas position och tid efter för samtliga resultat i
  klassen. O-Tid får inte jämföra olika banversioner eller skapa dolda
  underklasser.
- Sortering påverkar inte position. Efter resultatnyckeln sorteras rankade på
  tid och därefter stabil visningsordning; orankade ligger sist. Interna UUID:n
  får endast vara sista intern tiebreak och lämnar aldrig projektionen.
- Dubblettnyckel, okänd status, tom banversion, negativ/osäker tid eller
  motsägande ranking avvisas fail closed.

## Publik projektion

Publik-API:t returnerar ett strikt `formatVersion: 1`-kuvert med endast:

- klassnamn, namn och valfri organisation,
- `OK`/`MP` och stabil förklaringskod,
- valfri total- och sträcktidsdata,
- revisionsnummer,
- `rankingState`, valfri position och valfri tid efter.

`rankingState` skiljer `RANKED`, `NOT_RANKABLE_STATUS` och
`MIXED_COURSE_VERSIONS`. Resultatrevisions-id, entry-id, class-id,
course-version-id, readout, bricknummer, rawdata, authdata och full lagrad
evaluation lämnar aldrig det publika kontraktet.

Publikvyn visar `Placering` och `Efter`. Saknad ranking visas med streck och en
svensk textförklaring; kritisk innebörd får inte bero på färg.

## IOF-projektion

IOF:s individuella `PersonRaceResult` kräver ordningen:

```text
StartTime?, FinishTime?, Time?, TimeBehind?, Position?, Status, SplitTime*
```

`TimeBehind` skrivs som exakta decimalsekunder från heltalsmillisekunder och
`Position` som positivt säkert heltal. Fälten måste förekomma tillsammans och
endast på `OK`. MP och klasser med blandade banversioner utelämnar båda.

Serializeraren räknar aldrig ranking och accepterar aldrig halva eller
motsägande rankingparet.

## Säkerhet, samtidighet och offline

- Exportens befintliga capability, repeatable-read-transaktion, låsordning och
  skrivfrihet ändras inte.
- Publikfrågan är read-only och returnerar endast kontrakterade fält.
- Ranking lagras inte och skapar ingen audit; den härleds från samma immutable
  publicerade revisioner vid varje snapshotläsning.
- Samtidig ingest eller omräkning får endast ge ett helt före- eller efterläge.
- Stationens paket, SQLite, outbox, lokala evaluation och kvittenser påverkas
  inte. Ranking är en serverprojektion och ingen stationkvittens.

## Acceptans

- Domäntest bevisar competition ranking, delad seger, tid efter, MP-exkludering,
  permutationer och fail-closed input.
- Blandade banversioner ger synliga resultat men ingen position/tid efter.
- Publik API/UI och IOF XML använder samma positioner och tider efter.
- Historisk klass används efter senare klassbyte; nyare opublicerad revision
  läcker inte.
- XML-elementen ligger i officiell ordning och millisekunder bevaras exakt.
- Publik JSON och XML innehåller inga interna resultat-, entry-, klass- eller
  banversions-id:n.
- Hundra upprepade exporter ger identiska bytes/hash och inga writes.
- Befintlig ingest, offlineväg, omräkning, historik och exportauth regresserar
  inte.

## Utanför snittet

- DNS, DNF, DSQ, utom tävlan och utan tidtagning,
- `Complete`-finalisering eller klass-/tävlingsstängning,
- Eventor-uppladdning, komplett arkiv och backup/restore,
- ranking över olika banversioner, flerdagars eller flera races,
- stafett, lag, GPS, karta, SPORTident-protokoll och riktig USB.
