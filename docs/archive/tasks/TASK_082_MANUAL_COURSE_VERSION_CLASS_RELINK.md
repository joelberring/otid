# TASK082: ny manuell banversion och resultatfri klassomlänkning

Påbörjad 2026-09-19 som B1:s andra avgränsade snitt.

## Användarvärde

En tävlingsadministratör ska före första resultatet kunna ändra en manuell kontrollföljd för en befintlig klass utan XML-omväg och utan att förlora anmälda deltagare. Det ska vara tydligt när ändringen inte längre är säker eftersom resultat redan finns.

## Arkitektur och avgränsning

- Följ ADR-0104.
- Återanvänd racebunden `MANAGE_RACE`-session, CSRF/origin-skydd och idempotensmönstret från TASK081.
- Skapa alltid en ny immutable `CourseVersion`; uppdatera aldrig tidigare `CourseControl` eller banversion.
- Begränsa writer till en manuell Course och en manuell Class som redan hör ihop i samma race.
- Tillåt entries men blockera atomärt om någon entry i klassen har minst en resultatrevision.
- Byt endast `Class.courseVersionId`; ändra inte entries, starttider, brickor, resultatrevisioner, publiceringar, finaliseringar eller installerade stationspaket.
- Höj race-snapshot exakt ett steg på lyckad första write.
- Ingen auto-omräkning, IOF-mutering, karta, GPS, stafett eller USB.

## Berörda delar

- `docs/adr/ADR-0104-manual-course-version-class-relink.md`
- additiv databasjournal/migration och schema
- nytt strikt kontrakt i `packages/contracts`
- en applikationstjänst i `packages/application`
- tunna MANAGE_RACE-routes i `apps/web`
- den befintliga `/manage`-ytan med svensk skrivfri granskning och bekräftelse
- riktade kontrakts-, PostgreSQL-, route- och browserprov
- `docs/status.md`, plan, funktionsmatris, domän-/offline-notering och migrationsnotering efter verifiering

## Acceptans

1. En giltig manuell Course/Class med entries men utan resultatrevisioner får version `N + 1` med exakt angiven ordning och dubblettkoder; klassen pekar på den nya versionen och entries är oförändrade.
2. Race-snapshot ökar exakt ett steg. Tidigare CourseVersion/CourseControl, publiceringar/finaliseringar och installerade stationsdata ändras inte.
3. Exakt retry returnerar samma journalerade kvittens utan nya rader. Ändrat intent, race eller aktör samt stale snapshot/klassversion ger konflikt med full rollback.
4. Varje resultatrevision – publicerad, opublicerad, manuell eller historisk – för en entry i klassen blockerar mutationen atomärt.
5. IOF Course/Class, korsande race och en klass som inte redan pekar på vald Course blockeras utan write.
6. Databasen avvisar update/delete på den nya requestjournalen och på gamla banversionskontroller.
7. Administratören kan granska före write, ser tydligt antal deltagare och resultat, måste bekräfta granskningen och ser ny version efter lyckad write. Ett resultatunderlag blockerar med begriplig svensk text.
8. Browserfallet verifierar flödet mot riktig HTTP/PostgreSQL samt 390 px utan horisontell scroll. Resultat-/finaliserings- och samtidighetsgränser provas i riktat PostgreSQL-test, inte duplicerat i browsern.

## Riktad verifieringsplan

- kontraktstest för strikt request/idempotency-key, heltal, 1–1 000 koder, ordning och bevarad dubblett,
- fokuserat PostgreSQL-integrationsprov för lyckad resultatfri omlänkning, retry/konflikter/rollback, varje resultatspärr, manual/IOF-scope, journal-/banimmutabilitet och samtidighet mot ingest,
- utökad route-handlerenhetssvit för auth, CSRF, statusmappning och preview,
- ett browserfall i befintlig TASK029-konfiguration för granskning, bekräftelse, oförändrade entries, ny version och 390 px,
- berörd lint/typecheck och webbuild.

Breda resultat-, hårdvaru-, GPS- och fulla browserregressioner körs inte när den berörda transaktionsgränsen redan täcks av de riktade kontrollerna.

## Arkitektur- och licensbedömning

ADR-0104 låser append-only versionssemantik, resultatspärr och IOF-gräns före kod. Ingen extern eller AGPL-licensierad kod används.

## Slutfört 2026-09-19

Den gemensamma /manage-vyn har nu en separat skrivfri påverkansgranskning för
en befintlig manuell klass. Den visar aktuell bana, version, kontrollföljd,
deltagarantal och antal resultatrevisioner. Endast när resultatantalet är noll
kan administratören bekräfta och atomiskt skapa nästa immutable banversion samt
länka om klassen. Entries är oförändrade.

Migration0052 lägger till en egen immutable requestjournal. Den rättar också
TASK081-journalens dynamiska class/version-FK till class/race-scope, medan dess
ursprungliga CourseVersion fortfarande är referensierad separat; annars skulle
en senare legitim klassomlänkning göra gammal immutable skapelsehistorik
omöjlig. Rättning sker framåt eller från verifierad full backup, aldrig genom
att droppa historik.

Riktade kontrakts-, route-, PostgreSQL- och browserprov passerade. Browserfallet
använder riktig Next/HTTP/PostgreSQL, tappar första svaret efter commit och
verifierar exakt retry, ny version, bevarad entry och 390 px utan horisontell
scroll. Ingen omräkning, IOF-mutation, karta, GPS, stafett eller hårdvara ingår.
