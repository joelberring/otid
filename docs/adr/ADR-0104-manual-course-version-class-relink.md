# ADR-0104: ny manuell banversion kan länkas till en resultatfri klass

- Status: Accepterad för TASK082
- Datum: 2026-09-19

## Kontext

TASK081 kan skapa en manuell `Course`, dess immutabla version 1 och en länkad manuell `Class`. I en verklig förberedelse behöver arrangören ibland ändra kontrollföljden efter att deltagare har registrerats. Den interna modellen bevarar däremot varje `result_revision` med exakt `courseVersionId`, race-snapshot och beräkningsgrund. Att skriva om en klasskoppling efter resultat skulle göra det möjligt att påstå att en äldre revision hör till den nya banan utan en uttrycklig och spårbar omräkning.

IOF-importen har en separat adapteridentitet för Course/Class. Den får inte blandas med en manuell editör genom namnmatchning eller en ny intern extern identitet. Den redan etablerade principen är append-only banversioner, inte redigering av `course_control`.

## Beslut

TASK082 inför en smal, racebunden `MANAGE_RACE`-mutation för exakt en befintlig **manuell** bana och exakt en befintlig **manuell** klass i samma lopp.

Mutationen får bara genomföras när:

1. banan och klassen båda har `externalSource` och `externalId` satta till `NULL`,
2. klassens aktuella `courseVersionId` redan tillhör den valda banan,
3. ingen entry i klassen har någon `result_revision`, oavsett om revisionen är publicerad, opublicerad, teknisk, manuell eller historisk,
4. klientens `expectedSnapshotVersion` och `expectedClassCourseVersionId` fortfarande stämmer.

Vid giltig mutation skapas version `N + 1` av samma `Course`, med en ny exakt ordnad kontrollföljd. Dubblettkoder är fortsatt giltiga och bevaras. Endast den valda klassens `courseVersionId` byts till den nya versionen. Dess entries behåller `classId`, egna versionsnummer, starttider och brickkopplingar. Race-snapshot ökar exakt ett steg.

En enda resultatrevision i klassen blockerar hela mutationen före insert eller update. Då visas orsaken i en skrivfri påverkansgranskning och arrangören får behålla den gamla banversionen tills ett senare, separat snitt har bestämt omräknings- och publiceringssemantiken. TASK082 skapar aldrig en resultatrevision, räknar aldrig om, ändrar aldrig en publicering/finalisering och fabricerar aldrig ett resultat.

En tidigare immutable finalisering eller dess IOF-XML skrivs aldrig om eller raderas. En lyckad ny version gör det vanliga stationspaketet stale via den nya snapshotversionen; installerade paket och lokal outbox muteras inte.

## Transaktion, retry och databasbarriär

Requesten innehåller ett UUID `requestId`, `expectedSnapshotVersion`, `courseId`, `classId`, `expectedClassCourseVersionId` och 1–1 000 positiva kontrollkoder. HTTP använder idempotency-nyckeln `manual-course-version-link:<requestId>`.

Efter autentisering låser tjänsten session/credential, loppet med `FOR UPDATE` och ett request-id-bundet advisory lock. Den immutable journalen kontrolleras före aktuell snapshot: exakt samma race, aktör och normaliserade intent returnerar samma sparade kvittens; ändrat scope, aktör eller intent är konflikt. Ny request med stale snapshot eller gammal klassversion är konflikt utan delwrite.

Under lopplåset verifieras manuell origin och ägarskap, varefter antalet resultatrevisioner för klassens entries räknas. Först om antalet är noll infogas CourseVersion `N + 1`, dess ordnade `CourseControl`, klassens FK uppdateras, race-snapshot höjs, och journal/audit sparas i samma transaktion. Låsordningen är den befintliga `auth -> race -> request advisory`; entry-lås behövs inte eftersom det exklusiva lopplåset serialiserar ingest och resultatrevisioner.

En additiv migration skapar en egen immutable requestjournal och dess relationsbevis. Återställning är att stänga writer/UI och rätta framåt eller att återställa en verifierad full PostgreSQL-backup; ingen append-only historik droppas för att ångra en felaktig mutation.

## Gränssnitt

`/admin/{raceId}/manage` får ett separat, initialt stängt block efter TASK081:s skapandeformulär: **Ändra bana för befintlig klass**. En skrivfri granskning visar klass, gammal bana/version och kontrollföljd, avsedd ny följd, antal entries och antal resultatrevisioner.

Om resultatantalet är större än noll visas att ändringen inte kan sparas och varför. Om antalet är noll krävs en kryssruta om att påverkan har granskats innan knappen **Skapa ny banversion och länka om klassen** aktiveras. Klienten använder den befintliga MANAGE_RACE-sessionen, CSRF/origin-skyddet och explicit retry; granskningssvaret är aldrig en write. Mobilvyn får inte få horisontell scroll.

## Utanför beslutet

TASK082 är inte en generell banredigerare. Den omfattar inte IOF-objekt, bulk-omlänkning, ändring av en gammal banversion, automatiskt resultatbyte eller omräkning, kontrollneutralisering, karta/banritning, GPS/rutter, stafett eller SPORTident/USB.

## Avvisade alternativ

- Att tillåta omlänkning efter resultat och bara märka resultatet som stale avvisas: den historiska banbetydelsen skulle ändå ha ändrats utan att den nya regel- och publiceringskedjan var beslutad.
- Att uppdatera entries individuellt avvisas: de pekar på klass, inte bana, och en sådan versionsbump skulle påstå en deltagarändring som inte har skett.
- Att låta samma writer hantera IOF Course/Class avvisas: importadaptergränsen och dess externa identiteter ska förbli separata.
- Ett preview-hash-protokoll avvisas i detta snitt: snapshot- och exakt klassversionskontroll ger den nödvändiga konfliktbarriären utan en ny livscykel för temporära granskningsobjekt.

