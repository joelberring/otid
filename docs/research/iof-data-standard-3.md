# IOF Data Standard 3.0 – källnotering

## Syfte

Denna notering dokumenterar faktaunderlaget för TASK 001:s oberoende adapter.
Ingen kod eller filstruktur från MeOS, Oxygen eller Livelox har använts.

## Primärkällor

- IOF:s standardsida: <https://orienteering.sport/iof/it/data-standard-3-0/>
- IOF:s publika repository: <https://github.com/international-orienteering-federation/datastandard-v3>
- granskat schema vid commit `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230`:
  <https://github.com/international-orienteering-federation/datastandard-v3/blob/24eb108e4c6b5e2904e5f8f0e49142e45e2c5230/IOF.xsd>

Granskat 2026-08-30 och StartList-/ResultList-delarna, inklusive individuell
ranking, finalisering och `DidNotStart`, återgranskade 2026-08-31.

## Fynd som påverkar TASK 001

- Rotobjekten använder namnrymden
  `http://www.orienteering.org/datastandard/3.0` och `iofVersion="3.0"`.
- `PersonEntry` använder `Id` och direkt `Class`; de tidigare lokala elementen
  `EntryId` och `EntryClass` ingår inte i den officiella strukturen.
- `ClassCourseAssignment` refererar bana med `CourseName` eller `CourseFamily`,
  inte det tidigare lokala `CourseId`.
- `EntryList` bär inte fasta starttider. De hör hemma i `StartList`.
- `CourseData` definierar inte O-Tids interna startregel.
- `StartList` innehåller `ClassStart`; individuella starter ligger i
  `PersonStart`, vars `EntryId` motsvarar entryn i `EntryList`.
- `PersonStart` har en eller flera racebundna `Start`; `PersonRaceStart`
  definierar `StartTime` som `xsd:dateTime` och kan bära `raceNumber`.
- IOF rekommenderar tidszon i ISO 8601-tider. O-Tids single-race-subset kräver
  den för deterministisk UTC-normalisering.
- `ResultList` består av `Event` och noll eller flera `ClassResult`; status kan
  vara `Complete`, `Delta` eller `Snapshot`. `Complete` betyder att alla
  tävlande ingår, medan `Snapshot` är aktuellt läge under tävling.
- XSD:n kan inte bevisa `Complete`-täckning: `ClassResult` och `PersonResult`
  är strukturellt valfria/upprepade. Täckningen är därför en semantisk
  applikationsgaranti. `ResultList` har inget separat finaliseringselement,
  finaliseringstid eller closure-flagga.
- Individresultat bär valfri `EntryId`, obligatorisk `Person`, valfri
  `Organisation` och race-resultat. Race-resultatets `Status` är obligatorisk;
  start, mål, total tid, position och tid efter är valfria.
- I individuellt race-resultat kommer `TimeBehind` och därefter `Position`
  mellan `Time` och obligatorisk `Status`. `TimeBehind` är ett enkelt
  `xsd:double`-värde i totala sekunder; `Position` är `xsd:integer` och anges
  enligt schemadokumentationen endast för `OK`. Teamresultatens upprepade
  leg-/course-attribut hör inte till det individuella subsetet.
- XSD:n definierar inte hur lika tider ska placeras. Competition ranking och
  exakt millisekundtie är därför ett uttryckligt O-Tid-domänbeslut i ADR-0027,
  inte en regel som påstås komma från IOF.
- IOF-tider är totala sekunder. `SplitTime` har kontrollkod, valfri kumulativ
  tid och status `OK`, `Missing` eller `Additional`; varje känd bankontroll ska
  representeras och start/mål ska inte vara splits.
- O-Tids nuvarande `OK` och `MP` kan sanningsenligt mappas till `OK` respektive
  `MissingPunch`. XSD:ns `ResultStatus` innehåller dessutom exakt
  `DidNotStart`, dokumenterat som att deltagaren inte startade i detta lopp.
  Eftersom tider, position och splits är valfria kan O-Tids uttryckliga DNS
  mappas till ett `Result` med endast `<Status>DidNotStart</Status>`. DNS får
  fortsatt inte härledas ur saknad data; DNF/DSQ ligger utanför TASK 006E.
- IOF 3.0 har ingen status för att ett lokalt manuellt `DidNotStart` har
  återtagits och deltagaren därefter saknar resultat. TASK 006F utelämnar därför
  entryn ur levande `Snapshot` i stället för att fabricera en ersättningsstatus.
  En äldre fryst `Complete` är ett historiskt dokument och dess exakta bytes
  ändras inte av ett senare lokalt återtagande.
- Den pinnade XSD:ns `ResultStatus` innehåller `Disqualified`, dokumenterat som
  diskvalificerad av annan orsak än saknad stämpling. Individresultatets start,
  mål, total tid och splits är valfria, medan `Position` enligt dokumentationen
  endast ska förekomma för `OK`. TASK 006G kan därför mappa ett explicit
  manuellt DSQ till `Disqualified`, bevara källans tider/splits och samtidigt
  förbjuda Position/TimeBehind. XSD:n uttrycker inte O-Tids manuella beslut,
  aktivitet över senare revisioner eller withdrawal/restaurering.
- IOF har ingen separat status eller provenans för lokalt manuellt godkännande.
  Ett validerat TASK 006H-resultat mappar därför till `OK`; Position och
  TimeBehind härleds enligt O-Tids ranking och interna reason-/decisionfält
  utelämnas. `SplitTime` tillåter `status="Missing"` och valfri Time, så ett
  godkänt resultat med en uttryckligt accepterad saknad kontroll kan redovisas
  utan fabricerad splittid. O-Tids adapter kräver ett icke-serialiserat
  approval-proof för detta undantag och behåller full splitcoverage för vanliga
  tekniska OK.
- Den pinnade XSD:ns `ResultStatus` innehåller `DidNotFinish`. TASK 006I:s
  lagrade DNF är status-only och kan därför mappas till ett individuellt
  `Result` med endast `<Status>DidNotFinish</Status>`. Start, mål, Time,
  Position, TimeBehind och SplitTime utelämnas; XSD:n uttrycker inte O-Tids
  manuella decision/target, aktivitet över senare teknik eller finalisering.
- Den pinnade XSD:ns `ResultStatus` innehåller `NotCompeting`, dokumenterat som
  att deltagaren springer utanför tävlan. Individresultatets start, mål, Time
  och SplitTime är valfria medan Position enligt schemadokumentationen endast
  ska finnas för `OK`. TASK 006K kan därför bevara ett explicit OOC-besluts
  exakta tekniska tider och splits, mappa till `NotCompeting` och samtidigt
  förbjuda Position/TimeBehind. XSD:n uttrycker inte O-Tids actor, decision,
  target, aktivitet över senare teknik eller finaliseringsbevis.
- Den pinnade XSD:n har ingen status för O-Tids ”utan tidtagning”. `OK` är
  dokumenterat som ”Finished and validated”, men skulle inte uttrycka att
  resultatet avsiktligt är icke-rankat; dessutom säger XSD-dokumentationen att
  varje känd bankontroll ska representeras med `SplitTime`. `NotCompeting`
  betyder löpning utanför tävlan och används redan för OOC. TASK 006M inför
  därför ingen XML-mappning: ett lopp med aktiv NT avvisas i både Snapshot och
  ny finalisering i stället för att entryn utelämnas eller får fabricerad
  status. Denna fail-closed-policy är ett O-Tid-beslut i ADR-0037.

## Licens- och valideringsgräns

Det granskade IOF-repositoryt innehåller ingen `LICENSE`-fil och schemat anger
ingen separat återdistributionslicens. O-Tid vendlar därför inte `IOF.xsd` i
TASK 001 och påstår inte full XSD-validering. Adaptern validerar XML-syntax,
namnrymd, version och den avgränsade officiella struktur och semantik som behövs
för `EntryList`, `CourseData`, individuella single-race-`StartList` och det
avgränsade individuella `ResultList`-subsetet. Se ADR-0005, ADR-0025 och
ADR-0026. TASK 006D använder samma pinnade faktaunderlag och kräver ett
immutable applikationsbevis innan adaptern får skriva `status="Complete"`; se
ADR-0028.
TASK 006F ändrar inte IOF-subsetet eller serializeraren; withdrawal är en lokal
applikationslivscykel enligt ADR-0030.
TASK 006G breddar det individuella resultat-subsetet endast med den officiella
statusen `Disqualified`; beslutets interna reason och provenans serialiseras
inte. Se ADR-0031.
TASK 006H använder den befintliga officiella statusen `OK`; endast O-Tids
lokala projektion och proof-kontrakt breddas, aldrig XML-vokabulären. Se
ADR-0032.
TASK 006I breddar subsetet endast med den officiella statusen `DidNotFinish`.
Intern reason och provenans serialiseras inte och `Complete` kräver fortsatt
separat applikationsbevis. Se ADR-0033.
TASK 006K breddar subsetet endast med den officiella statusen `NotCompeting`.
Tekniska tider/splits får bevaras utan ranking; intern reason, decision och
target serialiseras inte. Se ADR-0035.
TASK 006L inför ingen IOF-status eller withdrawalrepresentation. Efter ett
återtagande projiceras den exakta tekniska källan med befintlig `OK` eller
`MissingPunch`; intern decision-, withdrawal- och revisionsprovenans
serialiseras aldrig. En tidigare fryst `NotCompeting`-export förblir
oförändrad. Se ADR-0036.
TASK 006M breddar inte IOF-subsetet. Aktiv `NT/WITHOUT_TIMING` saknar beslutad
sanningsenlig IOF 3.0-status och blockerar därför levande Snapshot och ny
finalisering; tidigare fryst XML/hash förblir oförändrad. Se ADR-0037.

## TASK 006T: publicerad StartList-export, återgranskat 2026-09-04

Samma pinnade officiella XSD granskades direkt. StartList har obligatorisk Event
och valfria upprepade ClassStart, men inget statusattribut. ClassStart kräver
Class/Name. PersonStart har ordning EntryId?, Person?, Organisation?, Start+.
Person/Name kräver Family följt av Given; displayName kan inte säkert delas.
Varje deltagare måste ha Start även utan tid. PersonRaceStart/StartTime är
valfri dateTime, raceNumber valfritt. Inget FIXED/PUNCH-element finns.

TASK 006T använder Event/Name, Class/Name, Person/Name, valfri Organisation/Name
och Start med valfri UTC-StartTime. Inga IDs, kort, course, bib, TeamStart,
raceNumber eller status skrivs. Event/StartTime betyder första start och används
inte för loppdatum eller publiceringstid. XML fryses vid nytt beslut; legacy
utan strukturerat namnunderlag kräver ompublicering. Se ADR-0044. Ingen XSD
vendlas eller full generell schemavalidering påstås.
