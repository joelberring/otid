# ADR-0115: Operativ backup och återställning är en samordnad, skrivstoppad helhet

- Status: Accepterad för TASK099
- Datum: 2026-09-19

## Kontext

O-Tid har en auktoritativ PostgreSQL/PostGIS-databas och privat
objektlagring för PM-dokument. Tävlingsdata, importer, råa enhetsmeddelanden,
resultatrevisioner och manuella beslut är bevarandevärd historik. Det finns
ännu ingen kedja som bevisar att en faktisk O-Tid-installation kan tas säkerhets-
kopierad och återställas till en separat miljö.

En databasdump utan motsvarande objektversioner kan lämna återställd data med
trasiga PM-referenser. MinIO tilldelar version-ID vid skrivning; en normal
S3-kopia till en ny miljö får därför nya ID:n medan PostgreSQL-manifestet
fortfarande pekar på källans ID:n. `mc mirror` bevarar inte
versionsattribut. Forskningen och källorna finns i
`docs/research/minio-version-restore-2026-09-19.md`. Credentials,
Eventor-nycklar, sessionsdata och Android-stationens lokala SQLite-kö har andra
säkerhets- och ägargränser och får inte blandas in i ett tävlingsarkiv.

## Beslut

TASK099 bygger en liten driftkedja, inte en generell arkiv- eller HA-produkt.

1. Operatören sätter installationens skrivande funktioner i dokumenterat
   skrivstopp före backup. Första snittet bygger inte PITR, repliker,
   automatisk failover eller en ny global maintenance-mode.
2. En backup omfattar en full PostgreSQL/PostGIS-dump inklusive migrations-
   metadata och exakt de privata objektversioner som det lagrade PM-manifestet
   refererar till. En manifestfil binder backup-id, tidpunkt, dump-hash,
   schema-/migrationsversion, objektidentifierare, objektversioner, storlek och
   SHA-256 till samma backup.
3. Backuparkivet innehåller aldrig lösenord, API-nycklar, master keys,
   sessionsdata, stationcredentials eller Androids privata SQLite/outbox.
   Sådana credentials utfärdas separat efter en återställning.
4. Återställning tillåts bara till en uttryckligen ny, tom och separat
   PostgreSQL/PostGIS- och objektlagringsmiljö. Den får inte skriva till den
   aktiva källmiljön och får inte radera data för att skapa ett retryläge.
5. Restore verifierar dump- och objekt-hashar, schema/migrationer och en liten
   läsande tävlingskedja: event/lopp, deltagare, råavläsning, resultatrevision,
   immutable journal, publicerat/fryst resultat och PM-objekt. Återställningen
   får inte skapa en ny resultatrevision, ändra journal eller publicera något.
6. En skrivande PM-objektrestore får inte byggas med vanlig S3/MinIO-kopia,
   `putObject`, `mc cp` eller `mc mirror`. Före den delen av TASK099 ska
   driftprofilen välja en dokumenterat versions-ID-bevarande mekanism och ett
   isolerat prov ska visa att den befintliga PM-läsaren hittar återställda
   objekt med PostgreSQL-manifestets ursprungliga `versionId`. Om en sådan
   mekanism saknas stannar TASK099 före ett påstått helhets-restorebevis.

## Konsekvenser

- En genomförd TASK099 blir ett praktiskt återställningsbevis, inte ett löfte
  om kontinuerlig backup eller katastroftålig produktion.
- Första backupen är installationstäckande. En portabel, begränsad export av
  exakt en tävling är en senare egen uppgift eftersom relationer och
  objektgränser då måste specificeras.
- Skrivstoppet är en medveten och synlig operativ förutsättning. Anrop som
  skrivs under kopieringen hör inte till den backupens konsistenspunkt.
- MinIO:s objektversion och hash måste bevaras; en senare overwrite får inte
  tyst ändra det återställda underlaget. En vanlig bytekopia är uttryckligen
  inte tillräcklig eftersom den får ett nytt MinIO-version-ID.

## Återställning och rollback

En misslyckad backup eller restore bevaras för felsökning i den privata
arbetskatalogen och får inte markeras som verifierad. Återställning görs om i
en ny tom målmiljö efter att manifest, hash eller miljöorsak rättats. Ingen
produktionsdatabas raderas eller ändras för att återställa ett test.

## Avvisade alternativ

- Endast `pg_dump`: saknar PM-objektens versionsbundna data.
- Kopiera enbart aktuellt MinIO-innehåll: kan ge fel objektversion.
- S3/MinIO `putObject`, `mc cp` eller `mc mirror` till ny bucket: MinIO skapar
  nya version-ID:n och den återställda databasen kan då inte läsa sina
  historiska PM-manifest.
- Översätta databasens objektversioner efter restore: skulle ändra bevarad
  historik och kräver en separat ADR.
- Inkludera credentials i arkivet: bryter hemlighets- och återutfärdandegränsen.
- Restore ovanpå en befintlig tävling: riskerar sammanblandad historik.
- PITR, repliker eller Kubernetes: större än första återställningsbeviset.
