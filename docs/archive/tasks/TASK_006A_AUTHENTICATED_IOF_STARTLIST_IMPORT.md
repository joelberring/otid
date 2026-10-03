# TASK 006A – autentiserad IOF StartList-import

## Mål

Utöka den befintliga atomära IOF XML 3.0-importen med individuella
`StartList`-filer så att fasta starttider blir en versionsstyrd del av loppets
snapshot utan att importbehörigheten samtidigt får mutera resultat.

Snittet återanvänder den racebundna `IMPORT_IOF`-capabilityn, importsessionen och
uppladdningsrouten. Det inför ingen generell roll, Eventor-klient, startlottning
eller stafett.

## Arkitektur- och licensbeslut före implementation

- ADR-0025 låser matchning, single-race-subset, tidszon, idempotens,
  versionsökning och resultatrevisioner.
- IOF:s officiella Data Standard 3.0-schema används endast som faktakälla.
  Schemat kopieras eller vendlas inte eftersom repositoryt saknar ett uttryckligt
  återdistributionsbeslut.
- Ingen AGPL-kod eller struktur från MeOS/Oxygen används.
- Ingen konflikt finns med `CODEX_BRIEF.md`, arkitekturen eller domänreglerna.

## Berörda paket

- `packages/iof-xml`: strikt, avgränsad `StartList`-tolkning.
- `packages/contracts`: strikt rapporttyp för `StartList`.
- `packages/database`: additivt enumvärde för importtyp.
- `packages/application`: atomär matchning, deltaidentifiering och uppdatering.
- `apps/web`: svensk information och ändrings-/omräkningsbesked i befintlig importvy.
- `fixtures`, `tests` och `docs`: fixtures, parser-, policy-, PostgreSQL- och
  Playwrightregression samt status.

Inga nya dependencies, routes, cookies, tabeller eller capabilities krävs.

## Stött IOF-subset

Snittet accepterar endast individuell orientering för ett lopp:

1. Roten är `StartList` i IOF 3.0-namnrymden och innehåller `Event` samt minst en
   `ClassStart`.
2. Varje `ClassStart` har ett icke-tomt `Class.Id` som matchar exakt en befintlig
   IOF-importerad klass i loppet.
3. `TeamStart` avvisas. Varje `PersonStart` måste ha `EntryId`, exakt ett
   `Start` och en `StartTime`.
4. `Start/@raceNumber` får saknas eller vara `1`. Andra värden och flera
   `Start` avvisas eftersom intern event→race-mappning ännu inte finns.
5. `StartTime` måste vara ett giltigt ISO 8601-datum/tid med `Z` eller explicit
   UTC-offset och normaliseras till UTC.
6. `EntryId` matchar endast `entry.external_source = 'iof'` och
   `entry.external_id`; namn används aldrig för identitet.
7. Varje entry måste redan tillhöra filens klass. Klassbyte genom `StartList`
   avvisas.
8. Alla befintliga entries i varje refererad klass måste förekomma exakt en
   gång. Delvis klasslista, okänd/duplicerad entry eller klass gör hela importen
   ogiltig utan writes.
9. Högst 500 klasser och 10 000 individuella starter accepteras per fil.

Övriga standardfält får finnas endast där det avgränsade schemat uttryckligen
tillåter dem, men påverkar inte intern identitet, brickkoppling eller bana.

## Mutation, versioner och historik

- Originalfil, SHA-256 och strukturerad rapport lagras i `import_file`.
- Exakt samma race, importtyp och innehållshash är en domänmässig duplicate.
  Samma request-id återspelas enligt befintlig requestjournal.
- En ny accepterad fil tar race UPDATE-lås. All DB-matchning valideras före
  första domänwrite.
- Refererade klasser sätts till `FIXED`. Senare `CourseData` får inte skriva
  tillbaka en befintlig klass till `PUNCH`; `CourseData` bär ingen startregel.
- Ändrad `fixed_start_time` ökar entryversionen exakt ett steg. Senare
  `EntryList` får inte radera en starttid eftersom den filtypen inte bär tiden.
- Race-snapshotversionen ökar exakt ett steg endast när minst en startregel eller
  starttid faktiskt ändras. En ny fil med samma normaliserade effekt bevaras som
  importbevis utan versionschurn.
- `IMPORT_IOF` skapar aldrig resultatrevisioner. Tidigare resultat behåller sitt
  historiska snapshot. Rapporten anger hur många ändrade entries redan har
  resultat och därför kräver ett separat, explicit operatörsval i den befintliga
  `RECALCULATE_RESULT`-ytan.
- Importaudit redovisar antal klasser, starter, ändrade entries och
  omräkningskandidater utan namn, XML eller hemligheter.

## Offlinekonsekvens

En redan installerad station fortsätter med sitt gamla signerade snapshot när
den är offline. Servern accepterar bevarad rådata enligt paketpolicyn men märker
gammal paketversion. Operatören måste installera det nya signerade paketet för
att få de importerade fasta starttiderna lokalt. Ingen köpost eller gammal
paketversion skrivs om eller raderas av importen.

## Migration och återställning

Migration 0011 lägger endast till `StartList` i enumen `import_kind`.

Enumvärden tas inte bort destruktivt. Vid incident inaktiveras stödgrenen och
rättelse sker framåt; full återställning sker från verifierad backup.

## Acceptans

- En officiellt strukturerad individuell single-race-`StartList` importeras via
  befintlig skyddad route och rapporteras med klasser, starter, ändrade entries
  och antal befintliga resultat som behöver ett separat omräkningsbeslut.
- Fel namespace/version, team, fler-lopp, tidszonlös/ogiltig tid, okänd eller
  duplicerad klass/entry, klasskonflikt och delvis klasslista ger atomiskt avslag.
- Exakt retry och samma innehåll med nytt request-id skapar inga extra
  domänändringar eller revisioner.
- Ändrad starttid ökar entryversion en gång och hela importen ökar snapshot
  högst en gång. Identisk normaliserad effekt ökar ingen domänversion.
- Importen skapar ingen resultatrevision. Gammal revision och raw/readout är
  oförändrade; explicit omräkning sker via separat capability och request.
- Senare CourseData/EntryList bevarar importerad startregel/starttid.
- Ett nytt signerat stationspaket innehåller `FIXED` och starttiden; gammal
  paketversion är fortfarande läsbar och synken signalerar stale enligt befintlig
  policy.
- Befintlig CourseData-, EntryList-, station-, ingest-, historik- och publikvy
  regresserar inte.

## Utanför snittet

- Eventor-HTTP/API-nycklar,
- startlottning eller redigering av startlista,
- bib/startplats, vakanta tider, flera race/etapper och stafett,
- ändrad klass, bana eller bricka från `StartList`,
- `ResultList`-export/import,
- riktig SPORTident, GPS, kartor och speaker.
