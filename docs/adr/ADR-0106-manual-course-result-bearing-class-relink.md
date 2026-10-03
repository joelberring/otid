# ADR-0106: kontrollerad manuell banomlänkning för klass med resultat

- Status: Accepterad för TASK084
- Datum: 2026-09-19

## Kontext

TASK082 spärrar avsiktligt banomlänkning när klassen har resultatrevisioner. TASK083 visar det berörda underlaget men är strikt läsande. En arrangör kan ändå behöva rätta en felaktig kontrollföljd efter första avläsningen.

`ResultRevision` bevarar redan banversion, snapshot, evaluation och orsak. Befintlig individuell omräkning använder klassens aktuella banversion, men är ett separat kommando och får aldrig startas av en konfigurationsändring. Race-snapshot räcker inte ensam som granskningsbevis: ingest, omräkning och manuella beslut kan skapa resultat utan snapshotsprång.

## Beslut

TASK084 inför en egen racebunden `MANAGE_RACE`-writer för exakt en manuell `Course` och dess redan länkade manuella `Class` i samma race, även med resultatrevisioner.

Writern får bara skapa immutable `CourseVersion N + 1` med en ordnad kontrollföljd, ändra den enda klassens `courseVersionId` och öka race-snapshot exakt ett steg. Den får aldrig skapa eller ändra `ResultRevision`, manuellt beslut, publicering, finalisering, IOF-XML, stationspaket, outbox eller rådata. Gamla resultat fortsätter sanningsenligt peka på sin gamla banversion. Senare individuell omräkning är fortsatt separat, explicit och skyddad av `RECALCULATE_RESULT`.

### Kandidat och commit

TASK083 återanvänds aldrig som skrivbevis. TASK084 får ett eget skyddat kandidatunderlag med en canonical, gemen SHA-256-`basisHash` över race-id/snapshot, klass-id, Course-id och aktuell CourseVersion, hela entrymängden i UUID-ordning med entryversion, respektive senaste revisionshuvud eller null, historiskt revisionsantal samt effektivt manuellt beslut med relevanta beslut-/revisionsid:n eller null. Revisionshuvudet innehåller id, revision, banversion, snapshot, publicering, status, reason och cause. Namn, `generatedAt`, mål-kontrollföljd och annan presentationsdata ingår inte i hashgrunden.

POST kräver `requestId`, `expectedSnapshotVersion`, `expectedClassCourseVersionId`, `expectedBasisHash`, Course/Class-id, 1–1 000 ordnade positiva kontrollkoder och `acknowledgedImpact: true`. Mål-kontrollerna hör till normaliserad request, inte till pre-state-hashen. Under race `FOR UPDATE` byggs grunden om före insert; annan snapshot, klassversion eller hash ger konflikt utan delwrite. Exakt samma request-id, race, verkliga aktör och fulla intent returnerar lagrad kvittens. Ändrat intent eller aktör ger konflikt.

### Historik, samtidighet och finalisering

Låsordningen är autentisering -> race `FOR UPDATE` -> request-advisory lock. Den serialiserar ingests och individuella omräkningar som tar race `FOR SHARE`. Aktiva manuella beslut bevaras och writer får varken återta, flytta eller återspela dem.

Gamla klass-/racefinaliseringar och fryst Complete-XML är byteexakta och fortsatt läsbara. Ny klassbana och snapshot gör endast live-grunden inaktuell; ny finalisering kräver befintlig fail-closed validering och ett nytt explicit beslut. Snapshot-exporten fortsätter använda historiska publicerade revisionsdata. Stationpaket blir stale via snapshotversionen men installerade paket och lokal outbox ändras inte.

### Journal och återställning

Migration0053 skapar separat immutable `manual_course_result_bearing_relink_request`: request-id, race/course/klass, föregående och ny banversion, verklig aktör/capability, källsnapshot, basis-hash, fryst semantisk grund, normaliserad request, kvittens och ändringstid. Den har scope-FK:er, `MANAGE_RACE`-check, gemen-SHA-256-check och update/delete-spärr. TASK082-journalen återanvänds inte eftersom dess resultatspärr är en annan garanti.

Återgång sker genom att stänga writer/UI och rätta framåt, eller återställa verifierad full backup. Append-only journal, banversion eller resultathistorik droppas aldrig för att ångra en rättning.

## Gränssnitt och avgränsning

`/manage` får ett separat, initialt stängt flöde efter TASK083. Kandidaten visar gammal bana, föreslagen kontrollföljd, berörda entries, deras senaste resultathuvuden och effektiva manuella beslut. Svensk varning säger att gamla resultat bevaras, omräkning inte görs automatiskt och ny finalisering/publicering kräver separat handling. Bekräftelse krävs före granskning och commit. Mobilbredd 390 px får inte ge horisontell scroll.

Ingen massomräkning, ändring av gammal CourseVersion, IOF-objekt, karta, banritning, GPS, rutter, stafett eller SPORTident/USB ingår.
