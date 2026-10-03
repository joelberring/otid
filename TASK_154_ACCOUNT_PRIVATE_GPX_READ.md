# TASK154: deltagaren återfinner egen privat GPX efter inloggning

Status: syntetiskt verifierad 2026-09-23. Beslut: ADR-0148.
Del av C2a; inte hela C2 och inte fysisk mobil-/fältverifierad.

## Användarutfall

En deltagare med aktiv koppling till exakt anmälan loggar in på en annan
enhet, öppnar ”Mitt resultat”, hittar sina redan uppladdade privata
GPX-versioner och väljer en. Detaljen visar sann spårlängd,
punkt-/segmentantal och om GPX har en fullständig, monoton tidsserie.
Ingen karta eller kontrollpassage låtsas vara verifierad ännu.

## Avgränsat vertikalt snitt

1. Strikta kontrakt för kontots privata lista och valda detalj; opak
   `routeUploadId` är endast väljare, aldrig behörighet. Ingen migration.
2. Applicationläsningar autentiserar kontosessionen, resolverar aktiv
   ADR-0146-koppling till exakt `(raceId, entryId)` och kontrollerar spärr
   under entry-lås. De läser enbart immutable ruttmanifest och normaliserade
   punkter och använder befintlig ren `deriveRouteMetadata` för fakta.
3. Två `GET`-routes med `private, no-store`, neutral 404 vid saknad/icke
   ägd version och ingen request-body. En svensk, kompakt ruta på `/me`
   listar egna versioner och länkar till en detalj som tydligt säger att
   exakt kart-/banpassning ännu saknas.
4. Riktade kontrakts-, PostgreSQL- och webbprov samt ett kort browserflöde
   med syntetiska data. Kör berörd lint, typecheck och build efter sista
   produktändringen; redovisa exakta resultat och bevisnivå.

## Acceptans

- Samma konto ser två skilda lagrade versioner för samma anmälan efter ny
  session; väljaren öppnar exakt vald version, inte ett senaste-val.
- Ett annat konto och en anonym besökare får varken lista eller detalj.
  Känd `routeUploadId` ger ingen rätt. Spärr av anmälningskoppling eller
  kontosession stoppar nästa läsning; gammal upload-grant påverkar inte
  redan lagrad privat läsning.
- GPX med komplett monoton tidsserie visar verklig start/sluttid och
  varaktighet; saknad/icke-monoton tid visar `UNAVAILABLE`, inte påhittad
  tid. Summa distans hoppar aldrig över segmentgräns. Manifest/punkt-mismatch
  ger inget giltigt detaljsvar.
- Browsern får inte råa koordinater, GPX-original, objektlagrings- eller
  grantuppgifter, intern entry-/resultatrevision, kartbild eller kontroll-
  passage. Privata svar är `no-store`; 390 px har ingen horisontell
  sidscroll och kritiskt läge uttrycks i text.

## Ingår inte

Uppladdning via konto, GPS-inspelning, karta/georeferens/banöverlägg,
GPX-nedladdning, nytt samtycke eller publiceringsknapp, offentlig
ruttändring, resultatregel, OMAP, Eventor-anrop, SPORTident eller stafett.
C2b kräver ett separat beslutat versionsbevis; C2c återanvänder den redan
separata samtyckes-/släppgränsen. Fysisk mobil-/fältacceptans kvarstår.

## Säker testmiljö

PostgreSQL-test körs sekventiellt mot en ny isolerad migrerad syntetisk
PostgreSQL/PostGIS, aldrig demo-/privat-/tävlingsdatabas. Browserprovet
använder loopback, egen port och separat byggkatalog. Inga verkliga namn,
GPX-filer, Eventor-nycklar eller externa tjänster behövs.

## Verifierat utfall 2026-09-23

- Kontraktsprovet passerade 3/3, applicationprovet mot en körningsunik
  isolerad PostgreSQL17/PostGIS passerade 3/3 och webbruttprovet passerade
  3/3. Applicationprovet använder riktiga claim-/upload-journaler med
  syntetisk GPX och kontrollerar även extra punkt mot manifestets antal.
- Playwright passerade 1/1 på 17,1 sekunder mot riktig lokal Next-server,
  egen syntetisk PostgreSQL-databas och 390 px. Ägarkontot öppnade vald
  version efter ny inloggning i ett separat browsercontext; annat konto och
  anonym besökare nekades och ingen horisontell overflow uppmättes.
- Contracts, application och web: lint, typecheck och build gav var för sig
  exit 0 efter sista produktändring. Browserharnessens riktade TypeScript
  och ESLint gav exit 0. Testservern stannade och ingen körningsunik
  testdatabas återstod.
- Ett första applicationförsök gav 1/3 på grund av en återanvänd syntetisk
  engångskod mellan fixturefall. Ett första browserförsök tidsutgick när
  arrangör och deltagare delade cookies i testet. Båda testunderlagen
  rättades; slutkörningarna ovan passerade utan att rättighetsgränsen
  försvagades.

Kvarvarande antaganden: claim-kod och konto överlämnas fortfarande betrott
utanför systemet. Ruttmanifestet bevisar ännu inte exakt karta/georeferens/
historisk bana, så ingen kartlinje eller kontrollpassage visas. Fysisk mobil,
internetdrift och fältbruk är inte verifierade. C2b:s versionsbevis är nästa
separata snitt.
