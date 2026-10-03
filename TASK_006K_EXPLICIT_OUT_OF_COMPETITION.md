# TASK 006K – explicit individuellt utom tävlan

Status: Genomförd och verifierad 2026-09-01, med Androidgrindar blockerade av
saknad Java-runtime på värden.

## Mål

Ge en separat behörig arrangör möjlighet att uttryckligen markera en enskild
deltagare som `OOC / OUT_OF_COMPETITION` mot entryns exakta aktuella,
publicerade och direkta tekniska `OK|MP`-revision.

Beslutet ska appendera en immutable decisionjournal och en publicerad manuell
resultatrevision som deep-kopierar all verifierbar teknisk fakta men alltid är
orankad. Senare offlineingest ska bevaras utan att tyst upphäva beslutet.
Snittet inför inget withdrawal, ingen generell resultateditor och ingen
funktion för utan tidtagning.

## Arkitektur- och licensbeslut före implementation

- ADR-0035 låser `OOC/OUT_OF_COMPETITION`, tekniskt targetsubset, permanent
  overlay, ranking, IOF `NotCompeting`, formatversioner, capability,
  idempotens och låsordning.
- `EvaluationResult`, `evaluateCardReadout`, stationens kontrakt och ingest
  breddas inte. OOC är endast en lagrad manuell `ResultOutcome`.
- Target måste vara entryns absoluta senaste, publicerade, direkt
  readoutbaserade och strikta tekniska `OK|MP`-revision på exakt aktuell
  entry-/klass-/ban-/snapshotgrund.
- OOC deep-kopierar entry, historisk klass/bana, eventuella tider,
  missing/extra controls och splits canonicalt och ändrar endast status/reason.
  Ingen tid, punch, kontroll eller split får skapas eller räknas om.
- OOC är permanent aktivt i detta snitt. Senare tekniska revisioner får
  appenderas men upphäver inte overlayn. Rättning kräver en separat senare ADR.
- Den pinnade officiella IOF 3.0-XSD:n vid commit
  `24eb108e4c6b5e2904e5f8f0e49142e45e2c5230` definierar `NotCompeting` som
  löpning utanför tävlan. Endast fakta dokumenteras; ingen extern kod eller
  schemafil kopieras, porteras eller vendlas.
- Ingen konflikt hittades mellan CODEX_BRIEF, arkitekturdokumenten och
  ADR-0028–0035. Briefen anger funktionen men lämnar dess avgörande semantik
  till detta ADR.

## Berörda paket

- `packages/domain`: ren OOC-konstruktor, statusordning och orankad regel.
- `packages/contracts`: lagrat outcome format 5, separat adminformat, publik
  format 5 samt historik/finalisering format 6 med bakåtkompatibel läsning.
- `packages/database`: migration 0020 med capability, actor kind,
  revisionsorsak, provenienskolumn och immutable decisionjournal.
- `packages/application`: kandidatlista, mutation, exact retry, gemensam
  manualgrind, levande projektion, historik, IOF och finalisering.
- `packages/iof-xml`: explicit `OOC` → `NotCompeting` med bevarad tillåten
  teknisk fakta men utan ranking/proof.
- `apps/web`: separat svensk tvåstegsyta med egen session och CSRF.
- `scripts`, `tests` och `docs`: credential-CLI, PostgreSQL-, route-, UI-,
  E2E-, export-, migrations- och finaliseringsbevis.

Stationens SQLite, outbox, device-batch, SPORTidenttransport/parser och native
USB får ingen ny semantik.

## Domän- och revisionsregler

1. `createOutOfCompetitionResult` accepterar endast ett strikt tekniskt
   `OK/COMPLETE` eller tekniskt MP med befintlig giltig teknisk reason och
   canonical entry-, klass- och banidentitet.
2. Konstruktorn deep-kopierar källans eventuella start, mål, elapsed,
   missing/extra controls och splits och ändrar endast till
   `OOC/OUT_OF_COMPETITION`.
3. Manuell approval, DSQ, DNF, DNS, alla restaureringsrevisioner,
   `UNKNOWN_CARD`, opublicerad eller äldre källa och korrupt shape avvisas.
4. `not_competing_decision` binder actor/request, race/entry, aktuell
   entry-/klass-/bana-/snapshotversion, policyversion, exakt tekniskt target
   och skapad OOC-revision.
5. OOC-revisionen är `target.revision + 1`, publicerad, har null direkt readout,
   orsaken `MANUAL_OUT_OF_COMPETITION`, unik decisionreferens och outcome som
   canonicalt motsvarar konstruktorn över target.
6. Decision, target, OOC-revision, rawdata, readout och snapshot muteras aldrig.
7. Aktiv OOC väljer den frysta OOC-revisionen även över senare tekniska
   revisioner. Ingen prioritetsordning eller fallback tillämpas vid korruption.
8. Den gemensamma entry-låsta grinden tillåter högst ett aktivt manuellt
   tillstånd av DNS, DSQ, approval, DNF och OOC.
9. TASK 006K har inget withdrawal. Ett felaktigt beslut förblir aktivt tills
   ett framtida separat append-only-snitt har accepterats.

## Capability, idempotens och samtidighet

- `DECIDE_OUT_OF_COMPETITION` är en separat racebunden write-capability med
  tokenprefix `otid_org_out_of_competition_v1`, egna host-only cookies och
  actor kind `OUT_OF_COMPETITION_ACCESS_CREDENTIAL`. Access gäller högst åtta
  timmar och session högst en timme.
- Privat kandidat-GET är bounded och lämnar endast minimal display-, versions-
  och targetmetadata. Bricknummer, punches, rawdata, full evaluation, token och
  hash lämnas inte ut.
- Body är strikt versionsmärkt JSON om högst 4 KiB. Origin, session,
  capability, race och CSRF valideras före bodyläsning och mutation.
- Idempotency key är `out-of-competition:<canonical-uuid>` och policyversionen
  är `out-of-competition-v1`.
- Exact retry matchar actor, race, entry och varje fryst intentfält och
  returnerar samma decision/OOC-revision även efter senare ingest. Ändrad actor
  eller ett enda intentfält är konflikt.
- Låsordning är session `UPDATE` → credential `UPDATE` → race `SHARE` →
  request advisory lock → exact replay → entry `UPDATE` → full manualgrind →
  absolut targetkontroll → append och audit.
- Om ingest vinner först blir OOC-intentet stale och write-fritt. Om OOC vinner
  får ingest appendera nästa revision medan OOC förblir effektivt.

## Publik, ranking, IOF, historik och finalisering

- OOC är alltid `NOT_RANKABLE_STATUS`. Det påverkar inte OK-positioner,
  ledartid eller mixed-course-bedömning. Statusordningen blir
  `OK`, `MP`, `DSQ`, `DNF`, `OOC`, `DNS`.
- Publikformat 5 visar svensk status ”Utom tävlan”, bevarade tekniska fakta och
  inga rankingfält eller interna decision-id:n. Format 1–4 förblir läsbara.
- IOF Snapshot och nya Complete-dokument mappar OOC till `NotCompeting`,
  bevarar tillåtna tider och SplitTime från target men förbjuder Position,
  TimeBehind och `manualApprovalProof`. Intern reason/provenans serialiseras
  aldrig.
- Historikformat 6 lägger till den diskriminerade källan
  `MANUAL_OUT_OF_COMPETITION` och visar tekniskt target → OOC → eventuell
  senare teknik. Format 1–5 förblir läsbara.
- Nya klass-/loppsfinaliseringar använder format 6 och fryser decision, target,
  effektiv OOC och absolut underliggande revisionshuvud. Senare teknik gör
  aktuell basis inaktuell men ändrar aldrig äldre Complete-bytes eller hash.
- Complete kräver fortsatt separat finalization proof. Serializeraren får inte
  härleda OOC, beslutets aktivitet eller täckning.

## Acceptans

- Ren konstruktor godtar strikt tekniskt OK och samtliga befintliga tekniska
  MP-shapes, deep-kopierar dem och avvisar manuella/korrupta källor.
- Giltigt beslut skapar exakt en immutable journal, OOC-revision och audit men
  inga raw/readout/snapshotmutationer.
- Hundra samtidiga exact retries ger en decision, revision och audit. Ändrad
  actor eller ett intentfält konflikterar; två request-id:n ger en vinnare.
- Samtidig ingest och OOC ger helt före/efter under lås. Senare ingest bevaras
  men aktiv OOC styr publik, Snapshot och finalisering.
- Gemensam manualgrind gör DNS/DSQ/approval/DNF/OOC ömsesidigt uteslutande och
  failar stängt på dubbelaktiv eller korrupt provenance.
- Databasens komposit-FK, unique/check och immutable-trigger avvisar
  felparning, dubbel target/entry, update och delete. Restore 0000–0020 provas.
- OOC förblir orankat men bevarar exakta tekniska tider/kontrollfakta i publik,
  historik och IOF `NotCompeting` utan Position/TimeBehind.
- Nya finaliseringar fryser format 6; äldre format och Complete XML/hash är
  byte-stabila efter OOC och senare ingest.
- Svenskt UI har separat capability, andra bekräftelsesteg, minst 52 px
  touchmål, synligt tangentbordsfokus, text/symbol utöver färg, minnesburet
  intent och endast explicit same-id-retry efter okänd commit.
- Full lint, typecheck, enhets-, PostgreSQL-, E2E-, produktions- och buildgrind
  körs och redovisas exakt.

## Utanför snittet

- OOC-withdrawal, bulkåtgärd och generell resultateditor,
- ”utan tidtagning”, manuella tider, punch-/splitändring och
  kontrollneutralisering,
- automatisk OOC från import, entryflagga eller readout,
- Eventor-uppladdning, multi-race, stafett/lag, GPS, kartor,
  SPORTidentparser och riktig USB.

## Utfall

- Det avgränsade OOC-snittet är genomfört i domän, kontrakt, migration 0020,
  applikation, IOF-adapter och en separat svensk administrationsyta.
- Beslut, tekniskt target, OOC-revision och audit appenderas atomiskt och
  idempotent. Aktiv OOC förblir den effektiva revisionen över senare teknisk
  ingest utan att rådata, readout eller snapshot muteras.
- Publik format 5, historik/finalisering format 6 och IOF `NotCompeting` är
  implementerade. OOC är orankat och Complete kräver fortsatt explicit proof
  med `finalizationId`, `revision` och `sourceHash`.
- OOC-withdrawal, utan tidtagning, generell editor, stafett, GPS,
  SPORTidentparser och riktig USB har inte påbörjats.
