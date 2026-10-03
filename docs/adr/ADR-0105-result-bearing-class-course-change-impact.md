# ADR-0105: läsande påverkansunderlag före banändring för klass med resultat

- Status: Accepterad för TASK083
- Datum: 2026-09-19

## Kontext

TASK082 kan skapa en ny immutable `CourseVersion` och länka om en manuell
klass, men avvisar avsiktligt varje klass som har en `result_revision`. Det
skyddar den historiska betydelsen hos ett resultat tills en framtida policy för
omräkning, publicering och finalisering har beslutats.

Arrangören behöver ändå kunna förstå omfattningen av spärren. Ett enkelt antal
resultatrevisioner räcker inte för att avgöra om en tänkt banrättning berör
publicerade, manuellt korrigerade eller historiska resultat. Den informationen
finns redan i interna revisionshuvuden, men får inte medföra att aktuell
klassbana eller ett gammalt resultat skrivs om.

## Beslut

TASK083 lägger till ett racebundet, autentiserat och **enbart läsande**
påverkansunderlag för en befintlig manuell klass som redan är länkad till en
manuell bana.

Underlaget visar den nuvarande banan/versionen och kontrollföljden samt, för
varje entry med resultat, endast det senaste revisionshuvud som redan är
tillgängligt för administratören: entryidentitet, revision, status,
`courseVersionId`, snapshotversion, publiceringsmarkering och om revisionen
har ett effektivt manuellt beslut. Det visar också totalsummor för entries,
entries med resultat och historiska revisioner.

Svaret är en observation, inte ett reservations- eller preview-token. Det får
inte användas som bevis för en senare mutation, och inga hash-, lås- eller
bekräftelseprotokoll införs för det i detta snitt. Om en framtida writer efter
resultat ska bli möjlig måste den fatta ett nytt ADR-beslut och själv verifiera
ett kanoniskt påverkanstillstånd under rätt transaktionslås.

UI:t visar tydligt att ingen ändring är sparad och att resultat aldrig räknas
om automatiskt. Det får erbjuda att återgå till klassöversikten, men inte en
knapp för omlänkning, massomräkning, resultatstatus eller publicering.

## Konsekvenser

- Gammal `ResultRevision`, rådata, manuella beslut, publiceringar,
  finaliseringar och tidigare IOF-XML lämnas helt orörda.
- Ingen CourseVersion, CourseControl, Class, Entry, race-snapshot, journal eller
  auditrad skapas från den nya läsvägen.
- Befintlig individuell, explicit omräkning är inte en del av vyn och anropas
  aldrig automatiskt.
- En användare kan få en föråldrad observation om ingest sker efter läsningen;
  detta är korrekt för en läsvy. En framtida writer måste upptäcka det som
  konflikt, inte lita på TASK083:s svar.
- Endast samma manuella Course/Class-scope som TASK082 visas. IOF-importerade
  objekt, andra lopp och otillräcklig MANAGE_RACE-behörighet returnerar ingen
  data.

## Avvisade alternativ

- Att låta TASK082:s writer godkänna resultatbärande klasser redan nu avvisas:
  det skulle ändra en etablerad resultatspärr innan krav för omräkning,
  publicering, finalisering och samtidighet är beslutade.
- Att skapa en pseudo-omräkningsjournal eller en hash i läsvyn avvisas: ingen
  mutation följer i TASK083, så sådana objekt skulle antyda en reservation som
  inte finns.
- Att presentera detta för deltagare eller publikt avvisas: underlaget innehåller
  operativa revisionsdetaljer och är endast för tävlingsadministratör.
