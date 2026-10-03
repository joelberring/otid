# ADR-0028: Immutable individuell klass- och loppsfinalisering

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

ADR-0026 definierar den privata IOF-exporten som en skrivfri `Snapshot` över
senaste publicerade revision per entry. ADR-0027 lägger till deterministisk
klassranking men lämnar uttryckligen slutresultat öppet. `published` betyder
bara offentlig synlighet och bevisar varken att alla tävlande ingår eller att
underlaget är färdigbehandlat.

IOF Data Standard 3.0 beskriver `ResultList status="Complete"` som en lista där
alla tävlande ingår och som används för officiella resultat efter tävlingen.
XSD:n gör däremot `ClassResult` och `PersonResult` valfria/upprepade och kan
inte verifiera täckningen. `Complete` måste därför vara ett explicit
applikationsbeslut med ett beständigt bevis, inte ett serializerarval.

Enbart valda `result_revision`-id:n är otillräckliga som bevis. Namn,
organisation och externa identiteter är aktuell displaydata, och
`course_control` saknar egen immutable databasbarriär. En senare export över
livejoins skulle kunna ändra ett redan utfärdat officiellt dokument.

## Beslut

### Tvåstegs, append-only finalisering

O-Tid inför separata explicita beslut inom en enda immutable
`result_finalization`-tabell:

1. `CLASS` fryser exakt alla aktuella entries i en icke-tom klass.
2. `RACE` kräver en aktuell klassfinalisering för varje icke-tom aktuell klass,
   kopierar deras frysta projektioner och skapar den enda tillåtna
   `ResultList status="Complete"`.

En scope-lokal revisionssekvens gör korrigering framåt möjlig. Finalisering är
inte en resultatrevision, ändrar inte `published` och kan aldrig uppdateras,
raderas eller “öppnas igen”.

### Täcknings- och aktualitetsbevis

Klassgrundens canonical hash omfattar aktuell race-snapshot, klass, bana,
aktuell entrymängd, exakt högsta resultatrevision per entry och hela den frysta
exportprojektionen. Varje högsta revision måste vara publicerad, strikt
runtimevaliderad som `OK` eller `MP`, tillhöra aktuell klass/bana och ha exakt
aktuell snapshotversion. Nyare opublicerad revision, stale resultat, saknad
revision, korrupt evaluation eller blandad banversion blockerar.

Loppsfinalisering räknar underlaget igen under ett exklusivt lopplås och
kräver exakt hashmatchning med senaste klassfinalisering för varje aktuell
klass som har entries. Loppet måste ha minst en entry. En avläsning som
fortfarande är olöst `UNKNOWN_CARD` blockerar loppet; en sådan avläsning räknas
som löst först när den har en resultatrevision. Inga nya statusar eller
fabricerade DNS/DNF/DSQ införs.

### Fryst projektion och exakta bytes

Varje rad lagrar en strikt runtimevaliderad, canonical och SHA-256-bunden JSON-
projektion. Den innehåller de käll-id:n som behövs för spårbarhet och alla
display-, kontroll-, status-, tid-, split- och rankingfält som behövs för
senare export.

En `RACE`-rad lagrar dessutom exakt UTF-8-XML och dess SHA-256. Export av en
finalisering läser bytesen; den gör inga livejoins och kör inte om
serializeraren. Detta gör dokumentet stabilt även efter senare ändringar av
namn, organisation, extern identitet, course controls eller kod.

### Explicit IOF-status

IOF-adaptern får en diskriminerad projektion för `Snapshot | Complete`.
`Complete` kräver ett runtimevaliderat internt finaliseringsbevis. Adaptern
räknar aldrig täckning och interna bevisfält skrivs inte till XML. Den
befintliga liveexporten skickar alltid `Snapshot`.

Single-race-begränsningen kvarstår. O-Tid fabricerar ingen IOF-raceordinal.
Nuvarande `OK`/`MP`-mappning, ranking, elementordning och splitpolicy ändras
inte.

### Säkerhet, idempotens och lås

`FINALIZE_RESULTS` är en ny separat racebunden write-capability med egen
credential-/cookieyta, högst en timmes session, CSRF/Origin-kontroll,
idempotency-key och auditaktör. `RECALCULATE_RESULT` och
`EXPORT_IOF_RESULT_LIST` ger ingen finaliseringsrätt. Exportcapabilityn får
endast läsa frysta racefinaliseringar.

En mutation binder väntad race-snapshot, canonical grundhash, scope/klass och
senaste scope-revision. Exakt retry från samma aktör återger samma rad; ändrat
intent eller aktör med samma request-id är konflikt.

Transaktionsordningen är session `UPDATE`, accesscredential `UPDATE`, race
`UPDATE`, request advisory lock, full kontroll, insert och audit. Race-låset
serialiserar mot ingest/omräkningens `SHARE` och import/klassändringens
`UPDATE`, så beslutet ser ett helt före- eller efterläge.

## Konsekvenser

- Ett IOF `Complete` får ett spårbart och reproducerbart täckningsbevis.
- Sen inkommande data och rättningar förblir tillåtna men ändrar aldrig äldre
  officiella bytes; en ny revision kräver nya explicita beslut.
- Finalisering kan behöva föregås av avsiktliga omräkningar efter varje global
  snapshotändring. Det är en fail-closed kostnad tills impactanalys finns.
- JSON-snapshoten duplicerar data medvetet för att bevara historisk sanning.
- Stationens offlineväg och lokala omedelbara resultat påverkas inte.

## Databasmigration och återställning

Migration 0013 är additiv: enumvärden, capabilitycheck och en immutable tabell
med constraints, index och update/delete-trigger läggs till. Ingen befintlig
resultat-, race-, entry-, klass-, bana- eller rådatapost skrivs om.

Produktionsrollback får inte droppa enumvärden, audit eller finaliseringsrader.
Vid incident inaktiveras routes och CLI, berörda credentials spärras och felet
rättas framåt med en additiv migration. Annars återställs en verifierad full
PostgreSQL-backup. En felaktig verksamhetsfinalisering korrigeras genom en ny
immutable revision, inte delete eller overwrite.

## Avvisade alternativ

- Ändra liveexportens status till `Complete`: saknar täckningsbevis och gör
  senare data osynligt omskrivande.
- Använda `published` som final flagga: blandar offentlig synlighet med
  verksamhetsbeslut och saknar roster-täckning.
- Endast raceknapp utan klasssnapshots: minskar operatörens möjlighet att
  kontrollera och korrigera avgränsade resultatgrupper före slutbeslutet.
- Endast spara resultatrevisions-id:n: display- och kontrolldata är fortfarande
  mutabla.
- Normaliserade child-rader som enda snapshot: senare child-insert kan ändra
  huvudradens logiska innehåll trots update/delete-trigger.
- Beräkna om XML vid download: kod- eller displayändringar kan ändra ett redan
  finaliserat dokument.
- Tillåta stale snapshot eller nyare opublicerad revision: modellen saknar
  impactanalys och kan inte bevisa att underlaget är officiellt aktuellt.
- Fabricera DNS/DNF/DSQ för saknade entries: statusarna finns inte i nuvarande
  domänmodell och skulle vara osanna.
- Automatiskt finalisera efter import eller ingest: döljer ett betydelsefullt
  operatörsbeslut och skapar risk vid sena avläsningar.
