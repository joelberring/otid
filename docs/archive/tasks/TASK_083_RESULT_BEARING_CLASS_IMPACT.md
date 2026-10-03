# TASK083: påverkansunderlag för manuell klass med resultat

Påbörjad 2026-09-19 som B1:s tredje avgränsade snitt.

## Användarvärde

När en arrangör vill rätta en manuell kontrollföljd efter att resultat har
kommit in ska hen se exakt vilka resultatkedjor som berörs, utan att systemet
råkar ändra banan eller ett resultat.

## Arkitektur och avgränsning

- Följ ADR-0105 och behåll TASK082:s skrivspärr oförändrad.
- Använd samma racebundna `MANAGE_RACE`-session som /manage-vyn.
- Läs bara manuell Course/Class i samma race; IOF-objekt och korsande scope
  avvisas utan informationsläcka.
- Returnera nuvarande CourseVersion/kontrollföljd, räknare och senaste
  revisionshuvud per entry med resultat.
- Skapa inte CourseVersion, klass-/entry-/resultatändring, snapshot, request-
  journal eller auditrad.
- Visa aldrig råstämplar, brickbytes, kontrollpasseringar eller full evaluation
  i denna administrativa summering.
- Ingen omräkning, publicering, finalisering, IOF-export, karta, GPS, stafett
  eller SPORTident/USB.

## Berörda delar

- `docs/adr/ADR-0105-result-bearing-class-course-change-impact.md`
- strikt read-kontrakt i `packages/contracts`
- en read-tjänst i `packages/application`
- tunn GET-route och svensk panel i befintliga `/manage`
- riktade kontrakts-, applikations-, route- och browserprov
- status, plan och funktionsmatris efter verifiering

## Acceptans

1. En manuell klass med blandade historiska, publicerade och manuellt beslutade
   resultatrevisioner visar aktuell bana samt senaste revisionshuvud per entry,
   utan dubbletter eller full evaluation.
2. Resultatfri klass visar tom resultatlista och rätt räknare; TASK082:s
   befintliga writerbeteende ändras inte.
3. IOF Course/Class, annat race, obehörig session och CSRF-irrelevanta GET-fel
   returnerar ingen påverkan och skapar aldrig en rad i databasen.
4. Read-anropet förändrar inte race-snapshot, CourseVersion, Class, Entry,
   ResultRevision, audit eller någon immutable requestjournal.
5. 390 px-vyn har ingen horisontell scroll och säger på svenska att ingen
   ändring är sparad och att omräkning inte sker automatiskt.

## Riktad verifieringsplan

- kontraktstest för strikt revisionshuvud och räknare,
- isolerat PostgreSQL-test för scope, latest-revision-val, manuellt beslut och
  bevisad skrivfrihet,
- route-handler-test för auth och statusmappning,
- ett browserfall med syntetiskt underlag vid 390 px,
- berörd lint/typecheck och webbuild.

Inga breda resultat- eller hårdvaruregressioner körs när den nya vägen är
strikt läsande och den berörda databasgränsen täcks riktat.

## Arkitektur- och licensbedömning

ADR-0105 bevarar resultatspärren och introducerar ingen ny teknik eller
domängräns. Ingen extern eller AGPL-licensierad kod används.

## Slutfört 2026-09-19

En separat, initialt stängd panel i `/manage` visar nu aktuell manuell
bana/kontrollföljd, räknare och ett senaste revisionshuvud per berörd deltagare.
Den visar deltagarnamn, revision, status, publicering och ett säkert härlett
effektivt manuellt beslut, men inte råstämplar eller full evaluation.

GET-vägen är racebunden och kräver MANAGE_RACE. Den avvisar IOF-objekt,
korsande scope och obehörighet utan att läcka data. Den skapar inte
CourseVersion, Class, Entry, ResultRevision, race-snapshot, audit eller
requestjournal. Ingen omräkning, publicering, finalisering, IOF-export, karta,
GPS, stafett eller hårdvara ingår.

Riktade kontrakts-, PostgreSQL-, route- och browserprov passerade. Browserfallet
använder riktig Next/HTTP och isolerad PostgreSQL med syntetisk avläsning och
verifierar 390 px utan horisontell scroll samt oförändrad klass, snapshot och
resultatrevision.
