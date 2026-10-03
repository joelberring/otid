# ADR-0103: manuell bana och klass skapas atomiskt

- Status: Accepterad för TASK081
- Datum: 2026-09-19

## Kontext

En liten träning kan i dag förberedas genom IOF CourseData, men inte direkt i
O-Tids gemensamma administratörsvy. Den interna modellen har redan stabil
`Course`, append-only `CourseVersion`, ordnade `CourseControl`, racebundna
`Control` och `Class` som pekar på en exakt banversion. IOF-importen identifierar
sina objekt med `externalSource = 'iof'` och ett externt id.

Den nya skrivvägen är en konsekvent verksamhetsmutation: flera rader måste
skapas tillsammans, loppets snapshot ska flyttas exakt en gång och ett tappat
HTTP-svar får inte skapa dubbla banor eller klasser. `CourseVersion` skyddas
redan mot update/delete i databasen, men dess ägda `CourseControl` saknar samma
barriär trots domänregeln om append-only banversioner.

ADR-0069 kräver att varje nytt arbetsområde i `MANAGE_RACE` integreras
uttryckligen. Beslut behövs därför före implementation. Ingen extern kod eller
AGPL-kod används.

## Beslut

TASK081 inför en enda racebunden `MANAGE_RACE`-mutation som atomiskt skapar:

1. en manuell `Course`,
2. dess första `CourseVersion` med version 1,
3. den angivna ordnade följden `CourseControl`, med racebundna `Control` som
   återanvänds per kontrollkod,
4. en manuell `Class` som pekar på den nya banversionen.

Requesten innehåller `requestId`, `expectedSnapshotVersion`, `courseName`,
`className`, explicit `startRule` (`PUNCH` eller `FIXED`) och `controlCodes` i
avsedd ordning. Namn trimmas och måste vara 1–160 tecken. Minst en och högst
1 000 positiva PostgreSQL-heltal tillåts. Samma kod får förekomma flera gånger;
ordning och multiplicitet är bansemantik och får inte sorteras eller
dedupliceras.

Startupplägget gissas aldrig från klassnamn. `PUNCH` betyder fri start genom
startstämpling. `FIXED` skapar endast klassens regel; inga deltagare eller
starttider fabriceras. `maxEntries` är `NULL` och `capacityVersion` är 1.

Manuella banor och klasser har `externalSource = NULL` och `externalId = NULL`.
IOF-importen fortsätter därför att endast återfinna och uppdatera sina egna
IOF-identiteter. Namn är visningsdata och inte identitet; två avsiktliga
requester får skapa lika namngivna objekt.

## Transaktion, samtidighet och retry

Efter autentisering låser tjänsten session/credential, därefter loppet med
`FOR UPDATE`, och tar ett request-id-bundet advisory lock. En immutable
`manual_course_class_create_request` kontrolleras före aktuell snapshot:

- exakt samma request, race och credential returnerar samma sparade kvittens,
  även om loppets snapshot senare har ändrats,
- samma request-id med annan aktör, race eller normaliserat intent är konflikt,
- en ny request med stale `expectedSnapshotVersion` är konflikt utan delwrite.

En första lyckad mutation skapar samtliga objekt, höjer `race.snapshotVersion`
exakt ett steg och sparar requestjournal samt audit i samma transaktion.
Responsen fryser skapade id:n, kontrollföljd, startregel och snapshot före/efter.
Inga entries, resultatrevisioner, publiceringar eller befintliga klasskopplingar
ändras. Installerade stationspaket blir stale genom den vanliga
snapshotmekanismen; historiska resultat förblir oförändrade.

## Databasbarriär och återställning

En additiv migration skapar requestjournalen med relations-, roll- och
JSON-villkor samt update/delete-trigger. Samma migration lägger en
update/delete-trigger på `course_control`, så att en banversions kontrollföljd
inte kan skrivas om under den redan accepterade append-only-modellen.

Vid incident inaktiveras routen och UI:t och rättning sker framåt. En befolkad
journal eller kontrollföljd droppas inte. Återställning sker endast från en
verifierad full PostgreSQL-backup. Migrationen ändrar inget teknikval.

## Gränssnitt

Den befintliga `/admin/{raceId}/manage` återanvänder samma `MANAGE_RACE`-
session. Ett kompakt, initialt stängt block låter administratören ange bannamn,
klassnamn, startupplägg och en separerad kontrollföljd. Först visas en tydlig
granskning utan skrivning; därefter krävs explicit bekräftelse. Upprepad
kontrollkod visas och bevaras. Mobilvyn staplar fälten utan horisontell
sidoscroll.

## Utanför beslutet

TASK081 bygger inte banredigering, ny banversion, omlänkning av befintlig klass,
kontrollneutralisering, kartgeometri, banritning, deltagare, lottning, GPS,
stafett eller SPORTident/USB. Nästa B1-snitt för en ändrad banversion kräver en
egen granskad versionssemantik eftersom befintliga deltagare och resultat då
kan påverkas.

## Avvisade alternativ

- XML-generering bakom formuläret avvisas; manuella objekt är interna objekt,
  inte fabricerade externa identiteter.
- En separat capability/inloggning avvisas; detta är ett uttryckligt integrerat
  arbetsområde för den redan tilldelade tävlingsadministratören.
- Namn som unik identitet avvisas; exact retry och interna UUID:n är identitet.
- Deduplicering av kontrollkoder avvisas eftersom en bana kan kräva samma kod
  flera gånger.
- Direkt redigering av version 1 avvisas; banversionen och dess kontrollföljd
  ska förbli append-only.
