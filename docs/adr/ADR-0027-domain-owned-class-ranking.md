# ADR-0027: Domänägd individuell klassranking

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

ADR-0026 införde en sanningsenlig IOF `ResultList Snapshot` men utelämnade
`Position` och `TimeBehind` eftersom O-Tid saknade auktoritativ ranking- och
tie-policy. Den publika resultatsidan sorterar i dag tider i applikationslagret,
har inget positionsbegrepp och returnerar dessutom råa interna resultat- och
entry-id:n utan ett strikt publikt kontrakt.

IOF 3.0 definierar individuell `TimeBehind` och `Position` som valfria fält före
obligatorisk `Status`, men definierar ingen tie-policy. O-Tids resultatrevision
lagrar historisk klass, banversion, status och tid, vilket räcker för ranking
endast när de rankbara resultaten i klassen är jämförbara.

## Beslut

### En ren domänfunktion

`packages/domain` äger en I/O-fri funktion som tar en klass kandidater med opak
unik resultatnyckel, `OK | MP`, valfri heltalsmillisekund och historisk
banversion. Den validerar hela mängden innan den returnerar härledd position,
tid efter och rankingstatus. Ingen ranking lagras i databasen.

SQL väljer revisioner och bygger kandidater. IOF- och webbadaptrar validerar och
presenterar endast domänutfallet; de får inte räkna positioner.

### Competition ranking och ties

Endast `OK` med icke-negativ säker heltals-`elapsedMs` rankas. Position är
`1 + antal strikt snabbare`, vilket ger både `1, 1, 3` och `1, 2, 2, 4`.
Exakt samma millisekund delar placering. Namn, organisation, externa id:n och
interna UUID:n får aldrig påverka positionen.

`timeBehindMs` är kandidatens tid minus klassens snabbaste OK-tid. Delade
vinnare får noll. MP får varken position eller tid efter och sorteras efter
rankade resultat.

### Historisk klass och jämförbar bana

Senaste publicerade revision per entry väljs på samma sätt som i ADR-0026 och
grupperas efter revisionens historiska `evaluation.classId`. En nyare
opublicerad revision och entryts aktuella klass påverkar inte rankningen.

Om klassens rankbara OK-resultat använder fler än en `courseVersionId` är
jämförbarheten inte bevisad. Position och tid efter utelämnas då för hela
klassen. Resultaten och deras status/tider visas fortsatt. Alternativen att
jämföra olika banor eller skapa dolda banversionsgrupper avvisas.

En äldre snapshotversion blockerar inte ensam ranking. En global snapshot kan
ha ändrats utan att resultatets bana eller tid påverkats, och modellen saknar
impactanalys. Den befintliga stale-varningen kvarstår.

### Publikt kontrakt

Publikresultat får ett strikt versionerat DTO-kuvert. Det innehåller endast
displaydata, status/reason, tidsdata, revisionsnummer och härledd rankingstatus.
Interna resultatrevisions-, entry-, klass- och banversions-id:n samt full
evaluation lämnar kontraktet.

Detta är både en rankingfunktion och en nödvändig minimering av en redan publik
projektion; det ändrar inte vilka personnamn och organisationer som är avsedda
att publiceras.

### IOF-adapter

Serializeraren accepterar frivilligt `position` och `timeBehindMs` endast som
ett komplett par på `OK`. Den kräver positiv säker position och icke-negativ
säker heltalstid, skriver `TimeBehind` som exakta decimalsekunder följt av
`Position`, därefter `Status`, och räknar inget själv.

## Konsekvenser

- Publikresultat och IOF-export får samma spårbara rankingsemantik.
- Delad placering och delad seger blir deterministiska på millisekundnivå.
- Resultat på bevisat olika banversioner får ingen vilseledande placering.
- Publik JSON exponerar färre interna lagringsdetaljer.
- En framtida statusutökning måste uttryckligen besluta vilka statusar som är
  rankbara; den får inte automatiskt ärva `OK`-regeln.

## Migration och återställning

Ingen databasmigration krävs. Ranking är en read-only projektion över immutable
revisioner.

Vid incident tas de nya DTO-/XML-fälten bort och tidigare read-only-projektion
återställs. Inga resultatrevisioner, rådata eller publiceringsbeslut behöver
skrivas om.

## Avvisade alternativ

- Ranking i SQL: bryter domängränsen och duplicerar regelverk.
- Ranking i XML/React: gör adaptern till resultatmotor.
- Dense ranking `1, 1, 2`: motsvarar inte beslutad tävlingsplacering.
- Namn eller UUID som tie-break för position: bryter en faktisk tidsmässig tie.
- Separat ranking per dold banversion: XML/publik klass skulle visa flera
  oförklarade vinnare under samma klass.
- Jämföra flera banversioner: underlaget bevisar inte likvärdig bana.
- Persistenta positioner i `result_revision`: position beror på hela den
  aktuella publicerade klassmängden och är inte en egenskap hos en enda revision.
- Bredda till nya statusar eller slutresultat: kräver separat domän- och
  revisionsbeslut.
