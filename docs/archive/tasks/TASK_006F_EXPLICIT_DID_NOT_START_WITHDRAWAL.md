# TASK 006F – explicit återtagande av manuellt ej-startbeslut

Status: Genomförd och verifierad 2026-08-31.

## Mål

Ge en separat behörig arrangör möjlighet att uttryckligen återta ett felaktigt
manuellt `DNS / DID_NOT_START` när den DNS-revisionen fortfarande är entryns
absoluta resultathuvud. Återtagandet ska göra att entryn åter saknar ett
aktuellt resultat utan att radera eller uppdatera DNS-beslutet,
resultatrevisionen, audit eller tidigare frysta Complete-exporter.

Snittet inför endast återtagande av TASK 006E:s manuella DNS. Det inför inte en
ny resultatstatus, DNF, DSQ, generell resultateditor, generell
publiceringsmodell eller återtagande av kortbaserade resultat.

## Arkitektur- och licensbeslut före implementation

- ADR-0030 låser beslutsmodell, aktiv resultatprojektion, capability,
  idempotens, samtidighet, finalisering och IOF-gräns före implementation.
- `did_not_start_withdrawal` är en immutable, append-only revision av det
  manuella beslutets livscykel. Den är inte en SPORTident-avläsning, en ny
  `ResultOutcome` eller en IOF-status.
- Ursprungligt `did_not_start_decision`, dess publicerade DNS-revision och audit
  förblir byte- och radmässigt oförändrade. Ingen `published`-flagga muteras.
- Den rena domänregeln avgör om ett valt resultathuvud är aktivt eller återtaget.
  SQL, React och IOF-adaptern får inte själva uppfinna livscykelregeln.
- IOF:s pinnade officiella 3.0-schema används endast som faktakälla. Ingen
  extern kod, schemafil eller AGPL-struktur kopieras.
- Ingen konflikt finns med styrande dokument. CODEX_BRIEF skiljer manuella
  beslut från beräknade resultat och kräver append-only historik; snittet
  tillämpar den riktningen utan att i förtid införa diskvalifikation.

## Berörda paket

- `packages/domain`: ren DNS-återtagningspolicy och resolver för aktivt
  resultathuvud; kortmotorn och `ResultOutcome` ändras inte.
- `packages/contracts`: separat login-, list-, intent-, svars- och felkontrakt.
- `packages/database`: additiv migration för capability, auditaktör, starkare
  DNS decision↔revision-parning och immutable återtagningsjournal.
- `packages/application`: privat beslutslista, exact-retry-mutation och en delad
  fail-closed overlay för levande resultatprojektioner.
- `apps/web`: separat svensk tvåstegsyta med egna cookies och minnesburet intent.
- `tests` och `docs`: domän-, kontrakts-, PostgreSQL-, route-, UI-, E2E-,
  export-, finaliserings- och återställningsbevis.

`packages/iof-xml`, stationens paket, SQLite, outbox, device-batch, parser och
native USB får ingen ny semantik.

## Domän- och livscykelregler

1. Endast en revision med exakt `cause=MANUAL_DID_NOT_START`, `status=DNS`,
   `reason=DID_NOT_START`, null readout och korrekt immutable decisionkoppling
   kan återtas.
2. Target måste vara entryns absoluta högsta resultatrevision vid första
   commit. En senare kort-, omräknings- eller annan revision blockerar.
3. Ett återtagande skapar ingen ny resultatrevision och ingen ny status. Det
   appenderar ett immutable manuellt livscykelbeslut och actor-audit.
4. Levande urval väljer först sitt vanliga resultathuvud och applicerar sedan
   withdrawal-overlayn. Ett återtaget huvud ger `NO_ACTIVE_RESULT`; urvalet får
   aldrig falla tillbaka till en äldre revision.
5. En senare riktig ingest appendar nästa vanliga `CARD_READOUT`-revision och
   blir aktiv. Withdrawal targetar endast den historiska DNS-revisionen.
6. Okänd bricka kopplas inte till en entry genom gissning. Predikatet i detta
   snitt är därför exakt DNS-huvud och ingen senare resultatrevision, inte en
   osäker sökning efter card readouts via aktuellt bricknummer.
7. Ett klass-/snapshotbyte får inte göra ett felaktigt DNS omöjligt att rätta.
   Operatörens aktuella entry, klass, bana och snapshot måste däremot bindas i
   intentet så att ett stale formulär aldrig committar.

## Capability, idempotens och samtidighet

- `WITHDRAW_DID_NOT_START` är en separat racebunden write-capability med eget
  credentialprefix, egna host-only cookies, högst en timmes session och egen
  auditaktör. `DECIDE_DID_NOT_START` implicerar inte återtagningsrätt.
- Privat GET visar efter auth bounded manuella DNS-beslut och tillståndet
  `WITHDRAWABLE | WITHDRAWN | SUPERSEDED`, med minimal display- och
  revisionsmetadata men utan bricka, punches, rawdata eller full evaluation.
- Mutationen använder
  `Idempotency-Key: did-not-start-withdrawal:<canonical-uuid>` och en strikt body
  om högst 4 KiB. Intentet binder aktuell entry/klass/bana/snapshot, exakt DNS-
  decision, exakt targetrevision och policyversion.
- Exakt samma aktör och intent returnerar samma withdrawal med
  `replayed=true`, även efter senare ingest. Ändrad aktör, target eller ett enda
  intentfält med samma request-id ger konflikt.
- Låsordningen är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → entry `UPDATE` → target-/huvudkontroll → withdrawal
  och audit i samma transaktion.
- Om ingest vinner först blockeras withdrawal. Om withdrawal vinner först får
  senare ingest revision 2. Finaliseringens race `UPDATE` ser ett helt före-
  eller efterläge.

## Publik-, IOF-, historik- och finaliseringsgräns

- Före withdrawal visas DNS normalt. Efter withdrawal saknas entryn ur levande
  publikresultat och ranking tills en ny riktig resultatrevision finns.
- Snapshot-export utelämnar entryn och ökar `omittedEntryCount`; den
  serialiserar varken `DidNotStart` eller någon ersättningsstatus för ett
  återtaget beslut.
- `packages/iof-xml` får ingen withdrawal-status. Tidigare fryst Complete-XML
  förblir exakt och historisk; ett återtagande ändrar aldrig dess bytes/hash.
- Aktuell klassfinalisering blockeras uttryckligen av
  `WITHDRAWN_DID_NOT_START`. Withdrawal-id och target måste ingå i den nya
  basisen så att äldre klassfinalisering blir inaktuell.
- Den privata withdrawal-listan visar originalbeslutets kvarvarande historik
  och eventuell withdrawal. Den readout-bundna historikytan får inte få en
  syntetisk readout eller breddad capability.

## Acceptans

- Giltigt återtagande skapar exakt en immutable withdrawal och actor-audit,
  men noll resultatrevisioner, rawmeddelanden, readouts och snapshotändringar.
- Databasen bevisar exakt decision↔DNS-revision↔race↔entry-target med
  komposit-FK och avvisar update/delete samt dubbelt target.
- Stale entry/klass/bana/snapshot/target, senare revision, fel capability,
  race, Origin eller CSRF ger avslag utan domänwrite.
- Hundra samtidiga exact retries ger en withdrawal och en audit. Ändrat intent
  med samma request-id och två olika request-id:n mot samma target ger konflikt.
- Samtidig ingest ger antingen withdrawal följd av CARD_READOUT revision 2,
  eller CARD_READOUT revision 2 och write-fritt withdrawalavslag.
- Publikresultat och Snapshot går från DNS till ingen aktiv rad utan fallback;
  senare riktig revision visas normalt.
- Withdrawal före finalisering blockerar nytt Complete; finalisering före
  withdrawal lämnas byte-exakt oförändrad men aktuell basis blir inaktuell.
- Privat svensk UI kräver en separat bekräftelse, håller credential och pending
  intent endast i minnet och gör aldrig automatisk retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E- och buildgrind körs och
  redovisas exakt.

## Utanför snittet

- återtagande eller manuell ersättning av kortbaserat OK/MP,
- nytt DNS efter ett återtaget DNS,
- DNF, DSQ, utom tävlan, utan tidtagning och generell resultateditor,
- generell publicerings-/unpublishmodell,
- Eventor-uppladdning, multi-race, stafett och lag,
- GPS, kartor, SPORTident-parser och riktig USB.
