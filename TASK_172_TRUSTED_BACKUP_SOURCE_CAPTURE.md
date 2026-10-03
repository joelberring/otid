# TASK172: betrodd källsides-capture för operativ backup

Status: implementerad och syntetiskt verifierad 2026-09-23; inte operativ backup.

## Användarutfall

En betrodd operatörskomponent ska kunna ta ett uttryckligt intyg om att alla
O-Tid-writers faktiskt har stoppats, skriva privat återhämtningsstatus före
första dumpbytesen, skapa TASK171:s verkliga PostgreSQL-dump och verifiera
TASK134:s migrations-/PM-källa för **samma** backup-id. Utfallet är ett
källbevis för nästa steg, aldrig en färdig backupkvittens.

## Befintligt beslut och fasgräns

ADR-0140 och TASK139 styr ordningen; inget teknik- eller domängränsbeslut
ändras. Efter lyckad preflight lagras den redan definierade fasen
`TARGET_PREPARATION_PENDING` med manifesthash och sorterade store-id:n.
Namnet betyder att målpreparering **väntar**, inte att ett mål har skapats.
TASK139:s ordning skriver just den fasen före `prepareEmptyTarget`, så ingen
ny statefas eller ADR behövs. Vid fel före preflight stannar privat state på
`DUMP_PENDING`; ingen påhittad manifesthash eller kvittens får skapas.

## Avgränsat snitt

- Application extraherar källstegen ur `captureOperationalBackup` till en
  återanvändbar source-only-ordning; den fulla capturevägen ska behålla sin
  befintliga ordning och felkodskontrakt. Run-intent valideras före I/O.
- Infrastructure-portarna är TASK140:s verkliga privata 0600-recorder och
  TASK171:s verkliga 0600-dump. Source-preflight använder befintlig
  PostgreSQL `REPEATABLE READ, READ ONLY` och exakt versionsbunden PM-läsare.
- Samma `backupId`, dumpbevis, canonical manifesthash och logiska store-id:n
  ska gå genom state, dump och preflight. Inga URL:er, PM-nycklar eller
  credentials får läggas i state, manifest, fel eller argument.
- En testägd opt-in-komposition använder ett nytt tomt syntetiskt
  PostgreSQL17/PostGIS-källmål och pinnad lokal MinIO-källa. Den bevisar
  verkliga källbytes och stateordning, inte ett operatörs-CLI.

## Acceptans

1. Felaktigt eller saknat `writeStopConfirmed: true` avvisas före state,
   dump, DB och PM-läsning.
2. `DUMP_PENDING` finns privat och varaktigt före dumpanropet. Dumpfel eller
   preflightfel ger inget källbevis och ingen målport anropas.
3. Lyckad källpreflight ger exakt det canonicala manifestet/hash/objektantalet
   och uppdaterar samma 0600-statefil till `TARGET_PREPARATION_PENDING` före
   retur. Ett fel i stateuppdateringen ger inte ett godkänt källbevis.
4. Ett opt-in-prov med verklig syntetisk PostgreSQL-dump och exakt historisk
   MinIO-PM-version använder denna source-only-ordning; samma dump kan fortsatt
   återställas och verifieras i TASK170:s isolerade kompositprov.
5. Riktade application-/infrastructure-prov, lint, typecheck och builds för
   berörda paket räcker. Ingen bred workspace-svit eller riktig tävling.

## Ingår inte

Automatiskt tekniskt skrivlås, operatörs-CLI, målprovisionering,
replicationsregel/resync, cleanup, kvittens, restoreprodukt, nya credentials,
Eventor, GPS, SPORTident/USB eller fältacceptans. Source-DB och
`pg_dump`-anslutning kommer i testet från samma explicita URL; en framtida
operativ konfigurationsadapter måste garantera denna bindning innan drift.

## Utfall och verifiering

`captureOperationalBackupSource` i application återanvänder den fulla
capturevägens första ordnade steg. Den validerar run-intent före I/O,
skriver `DUMP_PENDING`, tar dumpbeviset, kräver ett canonicalt
source-manifest bundet till exakt samma backup-id/tid/intyg/dump och skriver
`TARGET_PREPARATION_PENDING` först efter lyckad preflight. Source-only-
resultatet har `kind: SOURCE_CAPTURE_EVIDENCE`; full capture skapar sin
separata slutkvittens först efter målverifiering och cleanup. Infrastructure
och TASK170:s opt-in-runner kopplar in verklig privat statefil, verklig
`pg_dump -Fc`, en PostgreSQL `REPEATABLE READ, READ ONLY`-källsnapshot och
den versionsbundna PM-läsaren från pinnad lokal MinIO. Samma fil och
historiska PM-version återställs sedan till nytt tomt testmål.

Slutkontroller efter sista kodändring: application capture-prov **8/8**,
infrastructure state-/dump-/recorderprov **11/11**. Application och
infrastructure lint, typecheck och build gav exit 0 var för sig. Det
slutliga opt-in-kompositprovet mot ny syntetisk PostgreSQL17/PostGIS- och
MinIO-kedja gav **exit 0**. En tidigare opt-in-körning av samma nya
källsidesordning gav också exit 0 före den sista type-discriminanten.
Samtliga fyra exakt skapade testdatabaser och sex körningsunika MinIO-/mc-
kataloger kontrollerades utan anslutningar/processer och togs bort; de
syntetiska bytesen kan inte återställas. Inga riktiga tävlingar,
produktionscredentials eller Eventoranrop användes.

Det återstår en operativ konfigurationsbindning mellan databasläsning och
dumpanslutning, faktisk verifiering av operatörens skrivstopp,
mål-/regel-/cleanup-portar, återstartsbar CLI och fältacceptans. Dessa
ingår inte i TASK172:s källbevis och ingen backupkvittens får utfärdas.
