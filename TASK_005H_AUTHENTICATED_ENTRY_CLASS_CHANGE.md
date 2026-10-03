# TASK 005H – autentiserad klassändring för en deltagare

## Syfte

Produktionsautentisera endast den befintliga klassändringen för en deltagare i
ett bestämt lopp. Snittet återanvänder det hash-only, racebundna
säkerhetssubstratet från TASK 005F–005G men inför capabilityn
`CHANGE_ENTRY_CLASS`, eget tokenprefix, egna cookies, versionskontroll från
klienten och requestbunden idempotens.

Klassändringen ökar deltagarens version och loppets snapshotversion men skapar
ingen `ResultRevision`. Explicit omräkning förblir ett separat, öppet
utvecklingsflöde och skyddas eller anropas inte av detta snitt.

Snittet skyddar inte tävlingsskapande, IOF-import med annan capability,
pairing, explicit omräkning, simulator, generell deltagarvisning eller övrig
`/admin`. Det lägger inte till en generell användar-/rollmodell, Eventor,
StartList, ResultList, QR/kamera, SPORTidentparser, riktig USB, stafett, GPS
eller automatisk resultatomräkning.

## Berörda paket

- `packages/database`: additiva enumvärden och append-only requestjournal.
- `packages/contracts`: strikt versionsmärkt klassändringskontrakt och svar.
- `packages/application`: capabilitypolicy, dubbel authkontroll, stale-skydd,
  idempotent klassmutation och actor-audit.
- `apps/web`: separata klassadminsessioner, skyddad befintlig PATCH-route och en
  avgränsad svensk klassadminyta.
- `scripts`: betrodd CLI-provisionering för `CHANGE_ENTRY_CLASS`.
- `tests`: kontrakts-, route-, PostgreSQL- och Playwrightbevis.
- `docs`: arkitektur, domänregler, offlinekonsekvens, acceptans och status.

## Avgränsat flöde

1. Betrodd CLI skapar en individuellt märkt, racebunden accesscredential med
   capability `CHANGE_ENTRY_CLASS`. Formatet är
   `otid_org_entry_class_v1.<credential-id>.<32-byte-secret>` och endast
   SHA-256 lagras.
2. Operatören öppnar `/admin/{raceId}/classes`. Sidan är ett privat shell och
   serverrenderar inte deltagaruppgifter före autentisering.
3. Login sker mot en race- och capability-specifik sessionroute. Fel race,
   prefix eller capability avvisas innan session eller cookies skapas.
4. Sessionen gäller högst en timme och använder egna host-only session-/CSRF-
   cookies. Produktion kräver `Secure`, `__Host-`, `SameSite=Strict`, `Path=/`
   och exakt canonical HTTPS-origin; loopback använder explicita andra namn.
5. Efter autentisering hämtar UI:t endast det minimala underlaget för
   klassändring: loppets snapshotversion, klasser samt deltagar-id, visningsnamn,
   organisation, aktuell klass och aktuell entry-version. Svaret är privat och
   får inte cachas.
6. För ett försök fryser webbläsaren request-UUID, entry-id, målklass och
   förväntad entry-version i React-minne och skickar exakt
   `Idempotency-Key: entry-class-change:<request-id>`, CSRF och strikt JSON:
   `{ "formatVersion": 1, "classId": "uuid", "expectedEntryVersion": 3 }`.
7. Den befintliga klass-PATCH-routen ersätts med en skyddad implementation.
   Routen verifierar Origin, session, race, capability, CSRF och
   idempotency-header före en bodybyte läses. Faktisk body begränsas till
   4 KiB, måste vara exakt JSON och strikt UTF-8.
8. Mutationstransaktionen autentiserar samma session igen under radlås, låser
   loppet och request-id:t, kontrollerar eventuell exact replay och låser sedan
   deltagaren. Låsordningen är
   `session -> accesscredential -> race -> request advisory -> entry`.
9. Deltagaren och målklassen måste höra till samma race. Entry-versionen måste
   exakt motsvara `expectedEntryVersion`, och målklassen måste skilja sig från
   aktuell klass. Stale eller no-op ger 409 utan versions-, snapshot-, request-
   eller auditmutation.
10. Första giltiga mutation uppdaterar klass och entry-version, ökar exakt en
    snapshotversion och appenderar samma transaktion en requestjournal samt en
    audit med accesscredential som actor.
11. En exakt retry med samma actor, race, entry, målklass och expected version
    återger det ursprungliga svaret med `replayed: true`, även om deltagaren
    senare har ändrats igen. Ändrad kontext för samma request-id ger 409.
12. UI:t säger uttryckligen att klassen ändrats men att resultatet inte räknats
    om. Vid okänd commit eller 401/403 behålls exakt försök för explicit retry;
    ingen automatisk retry sker. Reload fabricerar inget besked.

## Beständighet och migration

- Migration `0006` lägger additivt till `CHANGE_ENTRY_CLASS` och
  `ENTRY_CLASS_ACCESS_CREDENTIAL`, skärper capabilityns accesslivslängd till
  högst åtta timmar och skapar append-only `entry_class_change_request`.
- Request-UUID är ett internt protokoll-id och används som retryidentitet, inte
  ett externt Eventor-/IOF-objekt-id. Tabellen har ett separat servergenererat
  internt UUID som primärnyckel och en unik `request_id`.
- Journalen binder actorcredential, race, entry, förväntad version, föregående
  och ny klass samt entry-/snapshotversion före och efter. Checks bevisar att
  båda versionerna ökar exakt ett och att klass-id faktiskt ändras.
- Tabellen avvisar update och delete med databas-trigger. Audit och
  resultatrevisioner behåller sin befintliga append-only-semantik.
- PostgreSQL kan inte säkert ta bort enumvärden med enkel rollback. Vid incident
  inaktiveras routes/CLI och en korrigerande migration görs; full återställning
  sker från verifierad backup.

## Säkerhets- och kontraktsgräns

- `PAIR_STATION` och `IMPORT_IOF` får aldrig ändra klass;
  `CHANGE_ENTRY_CLASS` får aldrig para stationer eller importera.
- Auth sker före body och igen under sessions-/credentiallås före mutation.
- Exakt `Origin`, sessionscookie, CSRF-cookie/header, capability, race och
  canonical idempotency-key krävs. Ingen credentialed cross-origin CORS öppnas.
- Svarskontraktet innehåller endast request-, race-, entry- och klass-id,
  replayflagga, entry-/snapshotversioner och ändringstid. Det returnerar inte en
  hel databasrad.
- Audit innehåller request-id, actor-id, klass-id samt entry-/snapshotversioner
  före och efter. Namn, organisation, credentiallabel, token, cookie, CSRF,
  session och authhash auditeras eller loggas inte.
- Fel är stabila och detaljfria: 400 `INVALID_REQUEST`, 401 `UNAUTHORIZED`,
  403 `FORBIDDEN`, 404 `NOT_FOUND`, 409 `CONFLICT`, 500 `INTERNAL_ERROR`.
- Alla sessions-, data-, mutations- och felsvar är `private, no-store`,
  `nosniff` och `no-referrer`. Adminsidan förbjuder inramning och stänger
  oanvänd kamera, mikrofon och geolocation.

## Acceptans

- Rätt credential kan logga in endast för exakt race; fel prefix, capability,
  race, expired eller revoked credential skapar ingen klassadminsession.
- Klassadmin-, pairing- och importcookies är separata och rätt produktions- och
  loopbackattribut verifieras.
- Saknad/fel auth, Origin, CSRF eller idempotency-key avvisas före bodyläsning.
- Fel medietyp, UTF-8, JSON, okända fält, formatversion, UUID eller body över
  4 KiB ger stabilt privat 400 utan mutation eller intern feltext.
- Cross-race entry eller klass ger generiskt 404 utan informationsläcka eller
  mutation. Stale version och byte till redan aktuell klass ger 409 utan
  request-, versions-, snapshot-, resultatrevisions- eller auditförändring.
- Hundra samtidiga exakta retries ger en entryändring, en snapshotökning, en
  requestrad och en actor-audit; övriga svar återger exact replay.
- Samma request-id med annan actor, race, entry, målklass eller expected version
  ger 409. Två olika request-id med samma expected version ger exakt en commit
  och en stale-konflikt.
- En exact retry återger ursprungliga metadata även efter en senare separat
  klassändring och skriver ingen ny request eller audit.
- Logout eller credentialrevocation som vinner före transaktionsauth blockerar
  commit. Requestjournalens update/delete avvisas.
- En klassändring skapar ingen `ResultRevision`. Explicit omräkning förblir
  separat och anropas aldrig automatiskt.
- Den gamla oskyddade PATCH-routen kan inte längre ändra klass. Den separata
  klassadminsidans data- och mutationsroutes kräver rätt session.
- UI håller credential och pending försök endast i minnet, erbjuder explicit
  retry vid okänd commit och påstår inte omräkning eller framgång efter reload.
- Befintlig pairing, import, station, ingest, resultat och publikvy regresserar
  inte. Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och
  buildgrind körs och redovisas exakt.

Se ADR-0018.
