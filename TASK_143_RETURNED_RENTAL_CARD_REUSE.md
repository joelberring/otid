# TASK143: återanvänd en registrerat återlämnad hyrbricka

Påbörjad 2026-09-22. Se ADR-0142. Detta är nästa lilla praktiska snitt efter
TASK142 och återanvänder TASK073/076/077:s befintliga hyrbricksstatus och
historik.

## Användarvärde

När en deltagare har lämnat tillbaka en hyrbricka ska tävlingsadministratören
kunna ge samma fysiska bricka till en annan redan registrerad deltagare utan att
den förra deltagarens brick- eller resultathistorik förändras. Den nya
deltagaren ska därefter direkt synas som innehavare av en ej återlämnad
hyrbricka.

## Avgränsning

- En uttrycklig, granskad återanvändning inom exakt ett Race.
- Källa: aktiv, hyrd och uttryckligt återlämnad assignment. Mål: annan Entry
  utan aktiv assignment.
- Ny assignment för målet; gammal assignment blir endast inaktiv historik.
- Atomisk journal, audit, idempotency, CSRF, `MANAGE_RACE`, båda entryversioner
  och race-snapshot.
- Partiell unikhet: högst en aktiv assignment per race och bricknummer.
- Kompakt val i befintlig adminvy, med samma tappat-svar/exakt-retry-beteende
  som övriga deltagaråtgärder.

Ingår inte: klubbglobalt lager, automatisk inventering, deposition/betalning,
fysisk brickskanning, SPORTident/USB, offlinekö, Eventor, GPS, karta eller
stafett. Direktanmälan får fortsatt inte tilldela ett historiskt känt nummer
automatiskt.

## Berörda delar

- `packages/database`: migration0076, schema och immutable reuse-journal.
- `packages/contracts`: strikt request/receipt för käll- och målgrund.
- `packages/application`: låst, atomisk writer samt säkert bevarad vanlig
  brickbytesregel när flera historiska assignmenter finns.
- `apps/web`: skyddad PATCH-route och ett litet val/granskning i befintliga
  brickpanelen.
- riktade kontrakts-, PostgreSQL-, route-handler- och ett enda browserprov.

## Acceptans

1. En återlämnad hyrbricka kan väljas från samma privata roster och flyttas till
   en annan deltagare utan aktiv bricka; commit skapar ny assignment med samma
   nummer, `isRental=true`, `rentalReturned=false` och gör exakt källraden
   inaktiv.
2. Källans id/entry/klass/version, målets id/klass/version, source-assignment,
   snapshot, actor och fulla intent binds. Stale, annan aktör, annan måldeltagare,
   fel eller ej återlämnad källa, redan aktivt kort och mål med bricka avvisas
   utan delskrivning.
3. Samma idempotency-id och canonicalt intent ger samma kvittens; ändrat intent
   eller aktör ger konflikt. Rådata, readouts, resultatrevisioner, tidigare
   hyr-/returjournaler och frysta exporter är byte-stabila.
4. Databasen tillåter aldrig två aktiva assignmenter med samma race/bricknummer,
   men behåller käll- och målassignmentens egna immutable identiteter och
   komposita historik-FK.
5. Den vanliga direktanmälan och det vanliga brickbytet låter inte ett nummer
   med tidigare annan ägare glida över till en deltagare. Egen tidigare
   brickhistoria följer endast den dokumenterade vanliga brickbytesregeln.
6. Efter commit höjs båda entryversionerna och snapshot exakt ett steg; roster
   visar målets hyrbricka som återlämning saknas och källan utan aktiv bricka.
7. UI:t visar källans deltagare/nummer, kräver granska/bekräfta, återanvänder
   exakt samma request efter tappat svar och har ingen horisontell sidscroll på
   390 px.

## Verifieringsplan

Kör en liten kontraktssvit, ett namngivet PostgreSQL-integrationsprov och
berörd route-handler-svit. Kör därefter berörda lint/typecheck och ett enda
`TASK143`-browserfall mot en ny isolerad PostgreSQL/PostGIS-databas, följt av
berörda builds. Ingen bred workspace-svit, riktig tävlingsdata, fysisk hårdvara
eller Eventorcredential används.

## Utfall 2026-09-22

Utfört enligt avgränsningen. Migration0076 kördes mot en ny tom, isolerad
PostgreSQL17/PostGIS-testdatabas. Kontraktstestet passerade 2/2,
PostgreSQL-integrationen 2/2, den berörda routesviten 39/39 och det enda
390 px-browserfallet 1/1. Berörd lint, typecheck och build för contracts,
database, application och web passerade. Browserfallet verifierade också
avbrutet svar och exakt återförsök mot samma syntetiska databas.

## Arkitektur- och licensbedömning

ADR-0142 är accepterad före implementation eftersom den ändrar
assignmentlivscykelns databasunikhet. Teknikval, resultatdomän och
integrationsgränser ändras inte. Ingen extern eller AGPL-licensierad kod
används.
