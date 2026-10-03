# ADR-0026: Capability-separerad deterministisk IOF ResultList-export

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

O-Tid har immutable resultatrevisioner, ett separat `published`-beslut och en
publik projektion, men saknar den IOF 3.0 ResultList-export som V1 kräver.
Exporten innehåller namn, organisation, extern entryidentitet och detaljerade
resultattider och är därför bredare än den PII-fria overviewn och annorlunda än
den privata avläsningshistoriken. Import- och omräkningscapabilities är writes
och får inte återanvändas för att ge exportbehörighet.

IOF 3.0 skiljer `Complete`, `Delta` och `Snapshot`. Nuvarande domän kan endast
bevisa `OK`, `MP` och frånvaro av en resultatrevision; den saknar eventstängning,
DNS, DNF och DSQ. Modellen lagrar historisk evaluation, snapshot- och
course-version men endast aktuellt entrynamn och organisationsnamn.

## Beslut

### Separat read-only capability

`EXPORT_IOF_RESULT_LIST` införs som ett eget racebundet privilegium med prefix
`otid_org_result_list_export_v1`, högst åtta timmars access och högst en timmes
session. Det får endast läsa och serialisera den explicita exportprojektionen.

Varje export kör i en `REPEATABLE READ`-transaktion med låsordningen session
SHARE, credential SHARE och race SHARE. Auth kontrolleras före projektions-SQL.
GET gör inga writes och skapar därför varken CSRF-krav, requestjournal, auditpost
eller sparad exportfil. Login och logout använder det befintliga skyddet för
muterande sessionsoperationer.

### Senaste publicerade revision och historisk grund

För varje entry väljs revisionen med högst revisionsnummer bland
`published = true`. En nyare opublicerad revision får inte dölja den.
Revisionens `evaluation.classId`, `courseVersionId`, status, tider och splits
är exportens historiska resultatgrund. Aktuell entryklass eller aktuell
klassbana får inte projiceras över den immutable revisionen.

Äldre `snapshotVersion` är inte i sig skäl att tyst utelämna en publicerad
revision. Snapshotet kan ha ändrats av en annan entry eller annan konfiguration,
och modellen lagrar ingen säker impactanalys. Revisionen tas därför med och
räknas som stale-varning. En explicit omräkning skapar vid behov en ny revision
genom den separata capabilityn.

Aktuellt namn och organisation används endast som visningsdata eftersom
historiska namnsnapshot saknas. Interna UUID:n exponeras aldrig som IOF-
identiteter. `Class.Id` och `EntryId` skrivs bara när motsvarande externa källa
är `iof`; annars utelämnas de valfria elementen.

### Sanningsenligt IOF-subset

Dokumentet är alltid `ResultList status="Snapshot"`. `Complete` skulle falskt
påstå att alla tävlande och slutstatusar ingår. Entries utan publicerad revision
utelämnas och blir aldrig implicit DNS.

`OK` mappas till IOF `OK` och `MP` till `MissingPunch`. Övriga IOF-statusar
väntar på en separat domänändring. Position och TimeBehind utelämnas eftersom
ranking och tie-policy ännu inte finns som auktoritativ domänlogik.

Varje historisk course-version läses i sekvens. En evaluation-split matchas med
kontrollkod och förekomst, skrivs med kumulativ decimalsekund och status `OK`;
en förväntad men omatchad kontroll skrivs `Missing` utan tid. Start/mål är inte
splits. Extra stämplingar utelämnas eftersom endast koder, inte tider, bevaras.
Motsägande revision/evaluation/course-data avvisas fail closed.

Event med fler än ett race avvisas. O-Tid saknar en lagrad IOF-raceordinal och
får varken anta `raceNumber=1` eller skapa en ny extern eventidentitet.

### Ren och deterministisk adapter

Serializeraren ligger i `packages/iof-xml`, tar en strikt I/O-fri projektion och
gör ingen resultatbedömning. Den använder fast ordning och escape, exakta
heltalsmillisekunder till decimalsekunder, UTF-8/LF samt avslutande newline.
Volatil `createTime` utelämnas. Ogiltiga XML 1.0-tecken avvisas i stället för att
ersättas tyst. Samma projektion ger byteidentisk XML och SHA-256/ETag.

IOF-schemat används som faktakälla men vendlas inte. Implementation och fixtures
är självständiga och omfattar endast detta dokumenterade subset.

## Konsekvenser

- V1 får en verklig IOF-resultatexport utan Eventor-, arkiv- eller writeyta.
- Capabilityisolering och race-scope kan testas separat.
- Resultatets historiska beräkningsgrund bevaras, medan namn uttryckligen är
  aktuell visningsdata.
- Exporten kan varna för stale revisioner men kan inte avgöra deras sakliga
  påverkan eller ändra dem.
- Slutresultat, placeringar och fler statusar kräver senare domänsnitt.

## Migration och återställning

Migration 0012 lägger additivt till `EXPORT_IOF_RESULT_LIST` i befintlig enum
och en capabilityspecifik åttatimmarscheck. Inga domänrader eller
resultatrevisioner skrivs om.

Produktionsrollback tar inte bort enumvärdet. Route och CLI inaktiveras,
credentials spärras och rättelse sker framåt, eller så återställs en verifierad
full backup.

## Avvisade alternativ

- Återanvända overview/history/import/recalculation: breddar fel PII- eller
  mutationsgräns.
- `Complete`: modellen kan inte bevisa full coverage eller slutstatus.
- Filtrera äldre snapshotrevisioner: kan tyst dölja auktoritativt publicerade
  resultat utan impactbevis.
- Använda aktuell klass/bana: skriver om revisionens historiska innebörd.
- Exportera interna UUID:n: gör intern lagringsidentitet till extern IOF-id.
- Beräkna ranking i XML-adaptern: flyttar resultatlogik utanför domänen.
- Härleda DNS eller andra statusar: fabricerar fakta som modellen saknar.
- Eventor-uppladdning eller komplett arkiv: kräver egna adapter-, credential-,
  lagrings- och retrybeslut.
