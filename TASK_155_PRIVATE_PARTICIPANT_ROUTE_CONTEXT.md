# TASK155: privat rutt på uttryckligen bunden karta och historisk bana

Status: syntetiskt verifierad 2026-09-23. Beslut: ADR-0149. C2b, inte hela C2.

## Användarutfall

En deltagare väljer en av sina privata GPX-versioner och ser just den på en
arrangörsvald, exakt versionsbunden privat karta med den historiska banans
verifierade kontrollpunkter. Är kopplingen saknad eller föråldrad förklarar
vyn det utan att gissa en karta eller visa en felaktig rutt.

## Minsta vertikala snitt

1. Additiv immutable kontextjournal enligt ADR-0149, migration och
   återställningsnot. Inga automatiska bindningar av historiska GPX.
2. `MANAGE_RACE`-läsning av aktuell bindning och separat idempotent bindning
   efter explicit val av GPX, karta, georeferens och geometrirevision. Resultat-
   revision och historisk banversion resolvas av servern.
3. Kontoskyddad JSON-projektion och exakt privat bildläsning för aktiv
   anmälningskoppling. JSON innehåller endast pixel- och mätdata; ingen rå
   koordinat eller lagringsreferens. UI skiljer tydligt mellan befintliga
   GPX-fakta och kartkontext som väntar.
4. Riktade kontrakts-, PostgreSQL- och webbprov samt ett 390 px-browserfall
   med syntetisk bild/GPX. Kör berörd lint, typecheck och build efter sista
   produktändringen; redovisa exakta resultat.

## Acceptans och stoppunkt

- Två GPX-versioner för samma anmälan kan bindas separat; endast den valda
  versionens exakta karta/bana används. Rebind är ny revision. Samma request
  återspelas exakt; ändrat intent ger konflikt.
- Annat race/entry, fel hash/kalibrering, ofullständig kontrollgeometri,
  GPX utanför kartan eller saknat aktivt publicerat resultat nekas vid bindning.
  Ny effektiv banversion stoppar gammalt överlägg tills explicit ombindning.
- Ägarens aktiva konto kan läsa karta och linje; anonym, annat konto och
  återkallad koppling/session får inget privat objekt. Kart- och ruttrelease
  samt deras återtagande påverkar inte denna privata läsning. Bildanrop med
  äldre kontextrevision efter ombindning avvisas i stället för att blanda
  gammal linje och ny karta.
- Ingen offentlig rutt, rå GPX, WGS84 eller påhittad passage lämnar gränsen.
  390 px fungerar utan horisontell sidscroll. Syntetiska prov märks inte som
  fysisk mobil- eller kartprecisionsacceptans.

## Ingår inte

GPS-inspelning/liveposition, nytt samtycke, publik ruttpublicering,
ruttjämförelse, stämplingsinferens, OMAP-import, verklig Eventortrafik,
SPORTident och andra tävlingsformer. C2c behandlar separat privat/offentlig
delning; C3 behandlar vidare uppmätt analys.

## Verifierat utfall 2026-09-23

- Kontraktsprovet passerade 4/4, applicationprovet mot en körningsunik
  isolerad PostgreSQL17/PostGIS passerade 1/1 och webbruttprovet 4/4.
  Applicationprovet täcker två GPX-versioner för samma anmälan, oberoende
  bindning/ombindning, idempotent retry, fel konto/anonym, spärrad koppling,
  fel version, ändrad effektiv bana och privat karta utan offentligt släpp.
- Playwright passerade 1/1 på 7,4 sekunder på 390 px mot en riktig lokal
  Next-server och körningsunik syntetisk PostgreSQL. Deltagarens overlay-GET
  samt fel konto/anonym begäran använde verklig HTTP/DB. Kartbildens bytes
  simulerades av en browserintercept; provet bevisar inte objektlagring.
  Testet täcker inte administratörens bind-knapp i browsern; skrivgränsen
  prövades i application och webbrutten.
- Database, contracts, application och web: lint, typecheck och build gav
  var för sig exit 0 efter sista produktkodändringen. Browserharnessens
  riktade TypeScript och ESLint gav exit 0. Ingen körningsunik TASK155-
  testdatabas återstod efter kontrollerna.
- Ett första kontraktsförsök saknade fixturefältet `contextRevision` efter
  att bildbegäran versionspinnats; fixturen rättades och 4/4 passerade. Ett
  första browserförsök föll på en testselektor som även träffade Nexts
  utvecklingsverktyg; selektorn begränsades till O-Tids kartkomponent och
  omkörningen passerade.

Kvarvarande antaganden: `MANAGE_RACE`-administratören väljer rätt karta
och geometri; matematisk in-bounds-projektion bevisar inte kartprecision i
fält. Konton och anmälningskoder provisioneras/överlämnas fortfarande
betrott utanför systemet. Riktig objektlagringsläsning, fysisk mobil,
internetdrift och kartprecision är inte verifierade i TASK155. C2c:s
privat/offentlig-delning återstår separat; ingen GPS-inspelning tillkom.
