# ADR-0110: klassbunden neutralisering av en kontrollförekomst

- Status: Accepterad för TASK092
- Datum: 2026-09-19

## Kontext

En enskild kontroll kan saknas, vara felaktigt placerad eller annars behöva
tas ur resultatbedömningen för en klass. Att skriva om `CourseVersion` eller
äldre `ResultRevision` skulle ändra historisk innebörd. Att göra ett generellt
avkortnings- eller tidsrättningsverktyg nu skulle också blanda flera olika
resultatregler och dölja den fysiska stämplingshistoriken.

TASK084 kan redan skapa en ny immutable banversion och TASK091 kan senare,
explicit och atomiskt räkna om en vald grupp. Det saknas en liten regel för
just den vanliga kontrollavvikelsen.

## Beslut

TASK092 inför ett append-only `MANAGE_RACE`-beslut som neutraliserar exakt en
`CourseControl`-förekomst för en aktuell Class och dess aktuella
`CourseVersion`. Omfattningen binds till `classId`, `courseVersionId`,
`sequence` och kontrollkod: samma kontrollkod kan förekomma flera gånger och
bara den valda förekomsten får påverkas. Andra klasser, även med samma bana,
påverkas inte.

Beslutet skapar en ny race-snapshot men ingen ResultRevision och ingen
automatisk omräkning. Det ursprungliga banobjektet, kontrollförekomsten,
råstämplingarna, äldre revisioner, manuella beslut, finaliseringar och
färdigfrysta XML-filer är immutabla. En följande explicit omräkning väljer
själv vilka tekniskt redo Entries som ska bedömas med den nya snapshoten.

Den rena resultatmotorn får neutraliseringsunderlag som explicit snapshotdata;
den gör ingen I/O och letar aldrig beslut själv. En stämpling på den
neutraliserade kontrollen bevaras som fakta och får i senare projektion inte
framstå som en borttagen, vanlig saknad eller fabricerad kontrolltid. Löptid är
fortsatt faktisk start–mål och neutralisering skapar ingen tid.

Första snittet tillåter högst ett sådant beslut per class/course-version och
ingen återtagning. Ny neutralisering, fler förekomster, avkortad bana,
tidsrättning, auto-omräkning och massomräkning är separata framtida beslut.

## Säkerhet, samtidighet och presentation

Preview och commit måste binda klass, aktuell CourseVersion, exact sequence/
kod, snapshot och canonical kandidatgrund till en idempotensnyckel. Commit
gör all validering i en transaktion under race-lås. Stale klass/bana/snapshot,
ny relevant ingest eller resultatrevision mellan preview och commit samt annan
actor eller ändrat intent ger konflikt utan journal- eller snapshotwrite.

En ny teknisk revision måste ha spårbar referens till det neutraliseringsbeslut
som dess evaluator använde. Aktiva DNS/DNF/DSQ/approval/OOC/NT fortsätter vara
det effektiva manuella resultatet ovanpå sådan teknisk revision. Ny
finalisering failar stängt tills underlaget är hanterat; publik-/Snapshot-export
får aldrig antyda att gamla revisionsrader redan neutraliserats.

## Konsekvenser

- Domain, snapshotladdare, revisionprovenans, IOF-/splitprojektioner och
  finaliseringskontroller berörs; detta är därför inte en UI-specialregel.
- Admin får ett litet tvåstegsflöde med svensk tydlig text om att resultat inte
  räknas om automatiskt och att den fysiska stämplingen behålls.
- Ingen GPS, karta/rutt, stafett eller SPORTident-hårdvara tillkommer.

## Återställning

Vid incident stängs skrivvägen. Journalen och efterföljande revisioner raderas
inte; återställning följer ordinarie backup/restore och eventuellt framtida
återtagande behöver ett eget append-only beslut.
