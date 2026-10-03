# ADR-0025: Atomär IOF StartList-import och versionsstyrda starttider

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

IOF `EntryList` bär anmälningar men inte fasta starttider. Nuvarande
`CourseData`-adapter sätter därför nya klasser till `PUNCH`, och resultatmotorn
använder `entry.fixedStartTime` endast när klassregeln är `FIXED`.

IOF Data Standard 3.0 definierar `StartList -> ClassStart -> PersonStart ->
Start -> StartTime`. `PersonStart.EntryId` är den standardiserade kopplingen
till motsvarande `EntryList`. Standarden tillåter samtidigt team, flera race,
utelämnade identiteter och tider samt flera alternativa metadatafält. O-Tids
nuvarande interna modell omfattar endast ett route-bundet individuellt lopp per
importrequest och saknar en extern event→race-mappning.

En starttidsändring påverkar framtida utvärdering av brickor. Tidigare
resultatrevisioner är däremot historiska bevis för sitt lagrade snapshot.
Importcapabilityn får inte tyst få samma resultatmutationsrätt som den separata
`RECALCULATE_RESULT`-capabilityn.

## Beslut

### Avgränsat single-race-subset

`StartList` läggs till i befintlig IOF-adapter och `IMPORT_IOF`-yta. En fil får
innehålla högst 500 `ClassStart` och 10 000 `PersonStart`. Team avvisas.

Varje klass kräver `Class.Id`. Varje person kräver `EntryId`, exakt ett `Start`
och `StartTime`. `raceNumber` får saknas eller vara `1`. Starttid måste innehålla
`Z` eller explicit offset och normaliseras till UTC. Detta är ett självständigt,
strikt subset; full XSD-täckning påstås inte.

### Identitet och full klasscoverage

Extern identitet används endast vid adaptergränsen. `Class.Id` och `EntryId`
matchas mot befintliga interna UUID-rader med `external_source = 'iof'` och
race-scope. Namn, starttid, bricknummer och listordning används aldrig som
identitet.

En entry måste redan tillhöra den angivna klassen. Alla befintliga entries i en
refererad klass måste finnas exakt en gång i filen. Detta gör det säkert att
sätta klassens startregel till `FIXED`; en partiell klasslista skulle annars
göra utelämnade deltagare resultatmässigt ogiltiga.

### Atomisk mutation och idempotens

XML/UTF-8/size/hash och parserstruktur kontrolleras före mutation. Under samma
transaktion autentiseras session och credential på nytt, race låses för mutation
och request-id serialiseras med advisory lock. Alla klasser, entries,
klassrelationer och coverage valideras innan första domänwrite.

Exakt samma innehållshash för race och `StartList` är en duplicate. Request-id
är fortsatt den auktoritativa retryidentiteten. Originalbytes bevaras som text i
`import_file` enligt den befintliga IOF-gränsen.

En ändrad starttid ökar entryversionen. Refererad klass blir `FIXED`.
Race-snapshotet ökar exakt en gång endast om minst en startregel eller starttid
faktiskt ändras. En ny fil med samma normaliserade effekt lagras som provenance
men orsakar ingen entry-/snapshot-/paketversionschurn. Eftersom `CourseData` och
`EntryList` inte bär dessa fakta får senare import av dem inte återställa
startregel till `PUNCH` eller starttid till null.

### Resultatmutationen förblir separat

`StartList`-importen skapar ingen resultatrevision. Befintliga revisioner behåller
starttid, evaluation och snapshot som historiskt användes. Importrapport och
audit anger antalet ändrade entries som redan har en resultatrevision och därför
kan behöva operatörsinitierad omräkning.

Operatören använder den befintliga `RECALCULATE_RESULT`-ytan för varje avsiktlig
omräkning. Den fryser entry, klass, snapshot, assignment, readout, senaste
revision och motorversion och appendar `EXPLICIT_RECALCULATION`. Detta bevarar
både capabilityseparation och spårbar operatörsintent.

### Offline och stationpaket

Snapshotökningen gör att nästa signerade stationpaket innehåller `FIXED` och
starttiden. Installerade gamla paket är immutable och fortsätter fungera
offline. Serverns befintliga package-aware acknowledgement skiljer gammal lokal
bedömning från central aktuell bedömning.

## Konsekvenser

- Fasta starttider kan importeras utan Eventor-klient eller ny authmodell.
- Tidigare resultat förblir historiskt korrekta; aktuell omräkning är ett separat
  explicit operatörsbeslut.
- Partiella startlistor per klass, vakanta tider, team och multi-race måste
  hanteras i senare egna snitt.
- En ny accepterad fil med identisk normaliserad effekt bevaras som provenance
  men ökar inte domänversioner.
- Ingen ny dependency eller I/O-gräns införs.

## Migration och återställning

Migration 0011 lägger additivt till `StartList` i `import_kind`. Inga befintliga
rader skrivs om.
PostgreSQL-enumvärden tas inte bort i drift. Incidenter hanteras genom
routeavstängning, additiv roll-forward eller verifierad backuprestore.

## Avvisade alternativ

- Läsa starttid ur `EntryList`: fältet hör enligt IOF 3.0 hemma i `StartList`.
- Matcha på namn: tvetydigt och gör extern text till identitet.
- Acceptera partiell klasslista och ändå sätta `FIXED`: lämnar utelämnade
  entries utan starttid.
- Skriva över senaste resultat: bryter revisionshistoriken.
- Automatisk omräkning i importen: blandar `IMPORT_IOF` med den separata
  resultatmutationscapabilityn och saknar ett explicit operatörsintent per entry.
- Skapa en ny importcapability: samma risk- och dataområde som befintlig
  `IMPORT_IOF`; en extra hemlighet ger ingen saklig separation.
- Börja med Eventor-HTTP: kräver separat nyckel-, adapter- och synkbeslut och är
  bredare än formatets domänflöde.
- Vendla hela IOF XSD: repositoryt har inget uttryckligt beslut om
  återdistributionslicens och behöver endast ett verifierat subset.
