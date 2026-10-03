# TASK 005I – autentiserad explicit resultatomräkning

## Syfte

Produktionsautentisera endast den befintliga explicita omräkningen för en
deltagare i ett bestämt lopp. Snittet återanvänder det hash-only, racebundna
säkerhetssubstratet från TASK 005F–005H men inför capabilityn
`RECALCULATE_RESULT`, eget credentialprefix, egna cookies, fryst
operatörsavsikt och requestbunden idempotens.

En bekräftad åtgärd skapar exakt en ny append-only, publicerad
`ResultRevision`. Den ändrar inte klass, entry-version, snapshotversion,
brickkoppling, råmeddelande eller card readout. Resultatmotorns regler ändras
inte och ingen omräkning startas automatiskt av klassändring eller andra flöden.

Snittet skyddar inte tävlingsskapande, klassändring med annan capability,
IOF-import, pairing, simulator, generell deltagarvisning eller övrig `/admin`.
Det lägger inte till generell användar-/rollmodell, Eventor, StartList,
ResultList, QR/kamera, SPORTidentparser, riktig USB, stafett eller GPS.

## Berörda paket

- `packages/domain`: additiv revisionsorsak `EXPLICIT_RECALCULATION`.
- `packages/database`: additiva enumvärden och append-only requestjournal.
- `packages/contracts`: strikta login-, kandidat-, request-, svar- och
  felkontrakt.
- `packages/application`: capabilitypolicy, privat kandidatläsning, dubbel auth,
  fryst intent, idempotent revisionsskapande och actor-audit.
- `apps/web`: separata sessioner, skyddad befintlig POST-route och svensk privat
  omräkningsyta.
- `scripts`: betrodd CLI-provisionering för `RECALCULATE_RESULT`.
- `tests`: kontrakts-, route-, PostgreSQL- och Playwrightbevis.
- `docs`: arkitektur, domänregler, offlinekonsekvens, acceptans och status.

## Avgränsat flöde

1. Betrodd CLI skapar en individuellt märkt, racebunden accesscredential med
   capability `RECALCULATE_RESULT`. Formatet är
   `otid_org_result_recalc_v1.<credential-id>.<32-byte-secret>` och endast
   SHA-256 lagras.
2. Operatören öppnar `/admin/{raceId}/recalculation`. Sidan är ett privat shell
   och serverrenderar inte deltagaruppgifter före autentisering.
3. Login sker mot en race- och capability-specifik route. Fel race, prefix eller
   capability avvisas innan session eller cookies skapas.
4. Sessionen gäller högst en timme och använder egna host-only session-/CSRF-
   cookies. Produktion kräver `Secure`, `__Host-`, `SameSite=Strict`, `Path=/`
   och exakt canonical HTTPS-origin; loopback använder explicita andra namn.
5. Efter auth hämtar UI:t endast kandidatuppgifter som krävs för ett säkert
   beslut: namn/organisation, klass, entry-version, readiness, exakt aktiv
   assignment, deterministiskt senaste readout, senaste resultatrevision,
   snapshotversion och serverns motorversion. Bricknummer, punches, evaluation
   och rådata lämnas inte.
6. Ett försök fryser request-UUID och följande observerade intent i React-minne:
   entry-version, klass-id, snapshotversion, assignment-id, readout-id, senaste
   resultatrevisions id/nummer eller null samt motorversion.
7. Webbläsaren skickar exakt
   `Idempotency-Key: result-recalculation:<request-id>`, CSRF och strikt JSON med
   `formatVersion: 1` samt hela det frysta intentet.
8. Den befintliga POST-routen
   `/api/races/{raceId}/entries/{entryId}/recalculate` ersätts med den skyddade
   implementationen. Origin, session, race/capability, CSRF och idempotency-key
   verifieras före en bodybyte. Faktisk JSON-body begränsas till 4 KiB och måste
   vara strikt UTF-8.
9. Mutationstransaktionen autentiserar samma session igen under radlås. Den
   låser `session -> accesscredential -> race SHARE -> request advisory -> entry
   UPDATE -> revision` och kontrollerar exact replay före aktuell entry-/resultat-
   status.
10. För en ny request måste alla frysta fält exakt matcha. Det ska finnas exakt
    en aktiv assignment; vald readout ska vara deterministiskt senaste för dess
    bricka och evaluation ska mappa tillbaka till exakt entry. Stale, saknad
    förutsättning eller tvetydig assignment ger 409 utan write.
11. Första giltiga request kör den oförändrade rena resultatmotorn mot den låsta
    snapshoten, skapar nästa obrutna revision med orsaken
    `EXPLICIT_RECALCULATION` och appenderar requestjournal samt actor-audit i
    samma transaktion.
12. Exakt retry med samma actor, race, entry och samtliga expected-fält återger
    ursprunglig immutable revision med `replayed: true`, även efter senare
    ingest, klassändring, import eller omräkning. Ändrad kontext för samma
    request-id ger 409.
13. Två olika request-id från samma observerade senaste revision ger exakt en
    commit och en stale-konflikt. Efter en medveten refresh får operatören skapa
    en ny revision även om evaluation skulle bli identisk; endast exact replay
    är read-only.
14. UI:t säger uttryckligen att en ny publicerad revision skapas och att klass
    och råavläsning inte ändras. Vid okänd commit eller 401/403 behålls exakt
    försök för explicit retry; ingen automatisk retry sker. Definitiva
    400/404/409 rensar försöket och 409 uppdaterar kandidaterna.

## Beständighet och migration

- Migration `0007` lägger additivt till `RECALCULATE_RESULT`, actor-kind
  `RESULT_RECALCULATION_ACCESS_CREDENTIAL` och revisionsorsaken
  `EXPLICIT_RECALCULATION`. Äldre revisionsorsaker och rader lämnas orörda.
- Capabilityns accesslivslängd begränsas i PostgreSQL till högst åtta timmar.
- Append-only `result_recalculation_request` får servergenererat internt UUID-PK
  och separat unikt request-id. Request-id är intern retryidentitet, inte ett
  externt Eventor-/IOF-objekt-id.
- Journalen binder actor, race, entry, klass, assignment, readout, entry-/
  snapshot-/motorversion, föregående revisions id/nummer och skapad
  resultatrevision. Checks binder skapad revision till exakt föregående + 1.
- Unik request-id, skapad resultatrevision och `(entry, revision före)` är
  beständiga concurrencybarriärer. Tabellen avvisar update/delete; befintlig
  `result_revision` är redan immutable.
- PostgreSQL-enumvärden tas inte bort destruktivt vid rollback. Vid incident
  inaktiveras route/CLI och rättelse sker additivt; full återställning sker från
  verifierad backup.

## Säkerhets- och kontraktsgräns

- `PAIR_STATION`, `IMPORT_IOF` och `CHANGE_ENTRY_CLASS` får aldrig räkna om;
  `RECALCULATE_RESULT` får inte använda deras mutationsytor.
- Auth sker före body och igen under session-/credentiallås före mutation.
- Exakt Origin, egna cookies, CSRF, capability, race och canonical
  idempotency-key krävs. Ingen credentialed cross-origin CORS öppnas.
- Mutationens svar innehåller endast request-/race-/entry-/readout-/revision-/
  course-id, replayflagga, status/reason, cause, motor-/snapshotversion och tid.
  Full evaluation eller databasrad returneras inte.
- Audit innehåller actor/request och samma begränsade resultatmetadata. Namn,
  organisation, bricknummer, punches, rawdata, credentiallabel, token, cookie,
  CSRF, session och authhash ingår inte.
- Fel är stabila och detaljfria: 400 `INVALID_REQUEST`, 401 `UNAUTHORIZED`,
  403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 500 `INTERNAL_ERROR`.
- Alla sessions-, kandidat-, mutations- och felsvar är `private, no-store`,
  `nosniff` och `no-referrer`. Sidan förbjuder inramning och stänger kamera,
  mikrofon och geolocation.

## Acceptans

- Rätt credential loggar in endast för exakt race; fel prefix, capability,
  race, expiry eller revocation skapar ingen omräkningssession.
- Omräkning, klass, import och pairing har separata cookies med rätt produktions-
  och loopbackattribut.
- Origin, auth, CSRF och idempotency-key avvisas före bodyläsning. Medietyp,
  faktisk storlek, UTF-8, JSON, extra fält och formatversion valideras strikt.
- Kandidat-GET kräver session och lämnar ingen bricka, punches, evaluation,
  rawdata eller credentialinformation.
- En giltig request skapar exakt en publicerad `EXPLICIT_RECALCULATION`-revision,
  requestjournal och actor-audit utan att ändra entry, klass, snapshot,
  assignment, readout eller rawdata.
- Hundra samtidiga exact retries ger en revision/journal/audit och 99 read-only
  replay. Två request-id från samma intent ger en commit och en 409.
- Samma request-id med annan actor/race/entry eller något ändrat expected-fält
  ger 409. Exact replay efter senare domänhändelser återger originalsvaret.
- Stale entry, klass, snapshot, assignment, readout, senaste revision eller
  motorversion ger 409 utan write.
- Ingen, eller fler än en, aktiv assignment, saknad readout eller evaluation som
  inte mappar exakt till entry ger 409 utan write.
- Samtidig ingest och omräkning ger obrutna revisionsnummer. Samtidig import/
  klassändring ger en hel serialiserad snapshot före eller stale 409 efter.
- Logout/revocation som vinner transaktionsauth blockerar commit. Journal och
  resultatrevision kan inte uppdateras eller raderas.
- Den gamla öppna POST-vägen ger 401 utan rätt session och ingen parallell bypass
  finns. Klassändring startar fortsatt aldrig automatisk omräkning.
- UI håller credential och pending request endast i minnet, retryar endast
  explicit och påstår inget efter reload.
- Befintlig pairing, import, klassändring, station, ingest, publikresultat och
  trusted intern omräkning regresserar inte.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och buildgrind
  körs och redovisas exakt.

Se ADR-0019.
