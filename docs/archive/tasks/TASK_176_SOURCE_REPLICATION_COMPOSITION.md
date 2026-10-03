# TASK176: faktisk syntetisk källfångst genom en-store-replikering

Status: syntetiskt verifierad lokalt 2026-09-23; ingen operativ backup.
Avgränsat D1b.4-snitt enligt
[produktmålplanen](docs/product-goal-roadmap-2026-09-23.md).

## Utfall

Samma backup-id och canonicala manifesthash från **verklig**
`captureOperationalBackupSource` (TASK172) med en privat `pg_dump -Fc`,
PostgreSQL-migration-/PM-preflight och exakt källobjektläsning ska gå genom
TASK174:s nya bundna MinIO-mål och TASK175:s enda regel/resync/cleanup-port.
Den vanliga PM-läsaren ska efter cleanup läsa den version som databasens
`pm_object_manifest` pekar på, med oförändrat `versionId`, hash och längd.
En andra version på samma syntetiska MinIO-nyckel finns i underlaget men
är inte kvittensgrund: TASK175 har redan bevisat överföring av två versioner
när **båda** ingår i manifestet, medan TASK176 prövar en autentisk DB-referens.

Det är viktigt att inte låtsas att två versioner av samma objekt är två
databasreferenser: nuvarande `pm_object_manifest` har en rad per uppladdning
och nyckeln är bunden till försökets ID. TASK172:s riktiga manifest kommer
därför i detta prov att innehålla **en** DB-refererad version; den andra
versionen får inte göras till ett extra krav för denna backupkvittens. Ingen domän- eller
schemaregel ändras.

## Avgränsning och ordning

1. Återanvänd TASK170:s opt-in-härva med en helt ny tom, uttryckligen vald
   syntetisk PostgreSQL17/PostGIS-källa och pinnad privat MinIO-källa. Den
   andra testdatabasen får endast kontrolleras som tom; ingen restore/migration
   körs där. Inga förvalda `DATABASE_URL`, tävlingsdata eller Eventor-nycklar.
2. Skapa den syntetiska tävlings- och PM-referensen som i TASK172, kör
   `captureOperationalBackupSource` och kontrollera att privat state,
   dumpbevis, DB-referens och manifestet binder exakt samma backup-id,
   store-id och manifesthash.
3. Nyprovisionera ett TASK174-mål för detta backup-id, återläs dess privata
   bindning och credentialfil, kontrollera TASK173-readiness och använd endast
   den exakt bundna käll-/målkonfigurationen för TASK175-porten. Ingen
   credential skrivs till manifest, state, argv eller utskrift.
   En godkänd `/minio/health/live` ensam är inte bevis för att det
   autentiserade S3-API:t är redo: före första bucket-skrivning krävs en
   tidsbegränsad läsande S3-beredskapskontroll. Fel ska ange enbart säkert
   steg (beredskap/bucket/versionering), aldrig SDK-meddelande eller hemlighet.
4. Efter portens lyckade cleanup: läs `CLEANUP_VERIFIED` från privat state,
   läs manifestets DB-refererade historiska version via den vanliga PM-läsaren
   och kontrollera oberoende att källan har noll replikeringsregler. En
   andra, icke DB-refererad version får mätas separat men får inte bli ett
   krav på kvittens eller hävda att manifestet innehåller två rader. Dumpens
   privata hash/längd får också jämföras med källbeviset; ingen backupkvittens
   eller restore utfärdas.
5. Fail closed vid käll-/mål-/manifestmismatch. TASK175:s riktade fel- och
   SIGKILL-prov återanvänds som bevis för cleanupvägen; detta snitt ska inte
   skapa en andra bred kraschhärva.

## Acceptans och kvarstående gräns

Ett separat opt-in-kommando med hashpinnad MinIO/`mc`, uttryckligen valda nya
testdatabaser och privata kataloger ger exit 0 endast om hela
source-capture → bound target → en-store-resync → cleanup-kedjan ovan håller.
Kör bara riktad lint/typecheck/test/build för berörda paket och redovisa
exakta resultat. Testprovet får aldrig rensa en redan använd databas eller
en oidentifierad privat katalog.
Ett mål som stoppar vid beredskap eller bucket-konfiguration förblir
`started`/reserverat och återanvänds inte; ett omprov kräver ny backup-id,
tomma databaser och nytt mål. Ett säkert stopp räknas inte som godkänd
starttillförlitlighet.

TASK176 är **inte** ett operatörs-CLI, ett tekniskt bevisat skrivstopp,
produktionssäkert exklusivt regelägande, kvittens eller restore. Ingen
writer-release, GPS, Eventor, SPORTident eller fältacceptans ingår. Nästa
beslut får tas först från uppmätta resultat och ADR-0140:s kvarvarande grindar.

## Uppmätt utfall

Den första opt-in-kedjan stannade **före** regelstart med exit 1 i
`BUCKET_CONFIGURATION` hos ett nytt privat mål. Källan och målet återanvändes
inte. Kodgranskning visade att HTTP-livstecknet följdes direkt av enstaka
autentiserade S3-skrivningar; en tidsbegränsad läsande S3-beredskapsgrind och
separata hemlighetsfria felsteg infördes. Detta är en rimlig men **inte
bevisad** förklaring till den intermittenta målstarten.

Ett nytt backup-id, nytt privat MinIO-par och två nya tomma isolerade
PostgreSQL17-databaser gav därefter **exit 0** för faktisk TASK172-capture →
TASK174-bindning/readiness → TASK175-replikering/cleanup. Enda DB-refererade
PM-versionen lästes via vanlig målläsare efter `CLEANUP_VERIFIED`; oberoende
kontroll visade noll källregler. Mål-DB hade **0 användarrelationer** efteråt.
Efter sista kodändringen: infrastructure lint **exit 0**, typecheck **exit 0**,
riktade tester **3 filer, 18 passerade, 2 opt-in överhoppade, exit 0**, build
**exit 0**. Det genomgående opt-in-provet är separat från de överhoppade
enhetstesternas MinIO-fall.

De fyra exakt skapade testdatabaserna (två försök) kontrollerades som ägda
av testoperatören med noll anslutningar, togs bort och bekräftades frånvarande;
syntetiska databasbytes kan inte återställas. Den tomma privata katalogen
från ett misslyckat försök att initiera en egen PostgreSQL-process togs bort
med `rmdir`. Körningsunika privata MinIO-källor/mål, inklusive det första
misslyckade målet, lämnades orörda som syntetiskt felsökningsunderlag.
