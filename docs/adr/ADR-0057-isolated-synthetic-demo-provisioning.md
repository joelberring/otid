# ADR-0057: Explicit isolerad syntetisk demoprovisionering

- Status: Accepterad; implementation inom TASK 007
- Datum: 2026-09-06
- Ingen ny teknik, domängräns eller produktionsbehörighet.

## Beslut före implementation

En betrodd lokal CLI ska ge en reproducerbar demo utan produktionsroute eller
auth-bypass. Den kräver uttrycklig bekräftelse `synthetic-empty-database`,
NODE_ENV som development eller test, samt en PostgreSQL-URL med explicit
loopbackvärd, port och databasnamn `otid_demo_` följt av 1–48 gemena
ASCII-bokstäver/siffror/underscore. URL-fragment, queryparametrar och kodade
databasnamn avvisas. Bekräftelsen ersätter inte serverkontrollen.

Före första write ska anslutningen verifiera faktiskt `current_database()` mot
det valda namnet. Under en transaktion låses samtliga O-Tid-applikationstabeller
i stabil ordning och kontrolleras tomma. Befintliga roller, journaler eller
andra applikationsdata betyder avslag, inte reset. Detta är en användningsgrind
för betrodd operatör, inte skydd mot en databasadministratör som avsiktligt
döper om/ersätter databasen. Inga tabeller eller databaser raderas automatiskt.
Migration är ett separat explicit steg mot ny isolerad databas, inte CLI:s
sidoeffekt. Demons redan provisionerade databas ska aldrig seedas om.

## Atomisk applikationsprovisionering

Nytt slumpat event-/race-id, repositoryts fasta syntetiska IOF-fixtures och
tre kortlivade minst-behöriga roller (VIEW_RACE_OVERVIEW, START_CHECKIN,
FINISH_FOREST_WATCH) skapas inom samma överordnade transaktion. Befintlig
IOF-import och credentialutfärdning ska återanvändas under transaktion, med
savepoints där befintliga användningsfall behöver det. Resultatlogik dupliceras
inte i seed eller CLI. Ingen riktig Eventortrafik eller användarvald XML-fil.
En andra körning mot samma databas avvisas eftersom den inte längre är tom;
omkörning kan inte tyst skapa en ny credentialuppsättning.

## Privat output och osäkert commitutfall

CLI kräver en explicit ny absolut privat outputfil utanför repositoryt och
en privat föräldrakatalog ägd av operatören. Symlänkar och existerande mål
avvisas; exklusiv filskapning och mode 0600 används. Tokenmaterial får inte
finnas i argv, stdout, stderr, länkar eller auditpayload. Stdout får bara en
hemlighetsfri validerad sammanfattning med scope, utgångstid och testlänkar.

Outputfilen förbereds exklusivt före databasmutation. Hemligheterna skrivs och
fsyncas medan databastransaktionen fortfarande kan rullas tillbaka. Ett
filskrivfel avbryter transaktionen. Databascommit kan fortfarande få osäkert
nätutfall: behåll då den privata filen, rapportera generiskt att operatören
måste kontrollera databasen innan något nytt försök. Påstå aldrig att två
olika lagringssystem har atomisk gemensam commit. Innehållet får inte skrivas
över eller rensas automatiskt på ett osäkert fel.

## Verifiering och avgränsning

Rena tester provar targetpolicy, inklusive fel miljö, kodning, query,
fjärrvärd och databasprefix, utan att återge hemlig anslutningssträng i fel.
PostgreSQL provar fel faktisk databas, icke-tomma tabeller, rollback vid sent
fel och konkurrerande provisionering. Filprov verifierar exklusiv skapning,
permissions, felvägar och generiska loggar. Browserprovet använder faktisk
provisionering och genomför simulator → resultat samt avprickning → målvy.

Runtime startas separat på loopback med befintlig simulatorpolicy. En annan
mobil kräver avsiktligt betrodd HTTPS-konfiguration; nätpublicering, riktig
SPORTident, GPS och stafett ingår inte. Hela V1 kan inte kallas klart för att
en syntetisk demo fungerar.

Browserprovet kör på separat loopbackport 3107 och fast byggkatalog
`.next-demo-test` när NODE_ENV=development och O_TID_DEMO_E2E=1. Produktions-
bygget och den öppna manuella demon behåller standardkatalogen. Simulatorns
enhetsbundna READOUT-token utfärdas separat med befintlig station-CLI efter
att simulatorns device-id skapats; de tre arrangörsrollerna får inte användas
som stationsbehörighet. Ingen ny implicit roll eller auth-bypass tillkommer.
