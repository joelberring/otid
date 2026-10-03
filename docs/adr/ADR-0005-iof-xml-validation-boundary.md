# ADR-0005: Avgränsad IOF XML-validering utan vendlat XSD

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

TASK 001 ska importera `EntryList` och `CourseData` enligt IOF XML 3.0. Den
tidigare implementerade dialekten använde element och attribut som inte finns i
standarden, bland annat `PersonEntry/EntryId`, `EntryClass`, `StartTime`,
`ClassCourseAssignment/CourseId` och `startRule`.

IOF:s officiella schema hämtades från revision
`24eb108e4c6b5e2904e5f8f0e49142e45e2c5230` i
<https://github.com/international-orienteering-federation/datastandard-v3>.
Filen hade SHA-256
`9d00abaea14ba4bedfae910d68a01506c097a57c29b0492c49abb19034ae90a1`.
Repositoryt och specifikationssidan anger ingen explicit licens för att
återdistribuera `IOF.xsd`.

## Beslut

TASK 001 använder egen, avgränsad schema-driven validering för de fält som mappas
från officiell `EntryList` och `CourseData`. Fixtures verifieras mot det
oförändrade officiella schemat i utvecklingsarbetet men schemat checkas inte in.
Systemet får inte beskriva denna validering som full XSD-validering.

`EntryList` saknar fast starttid och `CourseData` saknar startregel. Importerade
klass–ban-kopplingar får därför intern startregel `PUNCH` tills ett separat
vertikalt snitt inför standardiserad `StartList`-import.

## Alternativ

`libxml2-wasm` 0.7.1 är den föredragna kandidaten för framtida full XSD
1.0-validering. Den har synkront ESM-API, stöd för Node 18+ och deklarerad
MIT-licens. Den införs först när IOF har klargjort återdistributionsvillkoren för
schemat. `xmllint-wasm` har ett asynkront worker-API och skulle kräva att det
nuvarande synkrona adapterkontraktet ändras.

## Konsekvenser

Standardens elementnamn, namnrymd och TASK 001-semantik valideras och den gamla
dialekten avvisas. Full XSD-täckning, inklusive alla datatyper, ordningsregler och
extensions, återstår uttryckligen. Att lägga till full XSD-validering kräver ett
licensklargörande och en separat ändring; ingen AGPL-kod används.
