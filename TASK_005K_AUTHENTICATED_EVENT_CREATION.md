# TASK 005K – autentiserat och idempotent tävlingsskapande

## Syfte

Ersätt den öppna event-/racemutationen med ett separat, icke-racebundet och
produktionsautentiserat bootstrapflöde. Ett event och dess första individuella
lopp skapas atomiskt och idempotent från ett strikt versionerat intent.

Snittet får inte göra befintliga racebundna credentials globala. Det inför
heller ingen generell användar-, medlemskaps-, organisations- eller rollmodell.
Det skyddar endast skapandet av ett event och exakt ett första lopp.

Snittet ändrar inte IOF-import, pairing, klassändring, omräkning, overview,
stationens ingest eller publik resultatläsning. Det lägger inte till Eventor,
StartList, ResultList, stafett, GPS, SPORTidentparser, riktig USB eller annan
senare funktion.

## Berörda paket

- `packages/database`: additiva globala credential-, session-, revocation- och
  requestjournaltabeller samt en audit actor kind.
- `packages/contracts`: strikta login-, create- och responsekontrakt.
- `packages/application`: credentiallivscykel, låst sessionauth och atomiskt
  idempotent event-/racetillverkande.
- `apps/web`: separat sessionsroute, skyddad befintlig create-route och svenskt
  `/admin/events/new`-shell.
- `scripts`: betrodd CLI-provisionering och revocation.
- `tests`: kontrakts-, route-, PostgreSQL- och Playwrightbevis.
- `docs`: arkitektur, domänregler, offlinekonsekvens, acceptans och status.

`packages/domain`, resultatmotorn och stationen ändras inte.

## Avgränsat flöde

1. Betrodd CLI skapar en individuellt märkt global accesscredential för den
   enda capabilityn `CREATE_EVENT`. Formatet är
   `otid_org_event_create_v1.<credential-id>.<32-byte-secret>` och endast
   SHA-256 lagras.
2. Operatören öppnar `/admin/events/new`. Första HTML/RSC innehåller endast ett
   privat shell; credential, session och mutationssvar hålls i React-minne.
3. Login sker mot `GET/POST/DELETE /api/admin/event-creation-session`.
   Credentialen gäller högst åtta timmar och sessionen högst en timme.
4. Sessionen använder egna host-only session-/CSRF-cookies. Produktion kräver
   `Secure`, `__Host-`, `SameSite=Strict`, `Path=/` och canonical HTTPS-origin;
   loopback använder explicit andra namn.
5. Den befintliga `POST /api/events` blir helt skyddad; ingen parallell öppen
   create-route eller testbypass får finnas.
6. Mutationsordningen är exakt Origin, session/CSRF-preauth, canonical
   idempotency key, begränsad JSON-body, strikt schema och därefter låst
   application-reauth.
7. Intentet är
   `{formatVersion:1,eventName,raceName,raceDate,timeZone}`. Body måste vara
   UTF-8 `application/json`, 1–4096 bytes och avvisar okända fält.
8. `Idempotency-Key` är `event-create:<canonical-uuid>`. Request-id, aktör och
   hela normaliserade intentet binds i en append-only requestjournal.
9. En transaktion låser `session -> accesscredential -> request-id`, skapar
   event och första lopp, journal och auditpost atomiskt. Exakt replay returnerar
   samma IDs med `replayed:true`; samma request-id med annan aktör eller ändrat
   intent ger 409 utan extra event, lopp, journal eller audit.
10. Olika request-id:n med identiskt intent representerar två uttryckliga
    skapandebeslut. Systemet gissar inte deduplicering utifrån namn eller datum.
11. Klienten genererar request-id en gång per avsikt och behåller exakt samma
    normaliserade body endast i React-minne vid okänd commit. Retry är alltid
    explicit; ingen timer, polling, automatisk retry eller Web Storage används.
12. Efter strikt validerat svar visar UI:t skapade IDs och en länk till
    `/admin/{raceId}`. Det skapar inte automatiskt overview- eller annan
    racecredential; varje senare yta behåller sin egen capability.
13. Publika `/` behåller sin minimala tävlingslista men får inget createformulär
    och inga admincookies. Event-/racenamn, datum och race-id behandlas tills
    vidare som publik rubrikmetadata, i linje med befintlig publik resultatsida.

## Beständighet och migration

- Migration `0009` skapar separata append-only-tabeller för
  `event_creation_access_credential`, credentialrevocation,
  `event_creation_session`, sessionrevocation och `event_creation_request`.
- Globala credentials saknar `race_id` avsiktligt. Befintliga
  `pairing_admin_*`-tabeller förblir strikt racebundna och oförändrade.
- Credentialraden är det beständiga issuance-spåret; revocationraden bevarar
  tid och orsak. Ingen artificiell race-id eller ny generell security-audittabell
  skapas.
- Lyckad create/replay har exakt en `audit_event` med det nyss skapade loppets
  race-id, actor kind `EVENT_CREATION_ACCESS_CREDENTIAL`, aktörens credential-id,
  request-id och event-/raceintent utan hemligheter.
- Journalen har ett internt UUID som primärnyckel och ett unikt request-id samt
  FKs till credential, event och race. Created race måste höra till created event.
- Schemaändringen är additiv. Rollback i produktion sker genom route-/CLI-stopp,
  revocation och korrigerande migration; full återställning sker från verifierad
  backup. Tabeller eller enumvärden droppas inte destruktivt i drift.

## Säkerhets- och kontraktsgräns

- `CREATE_EVENT` är globalt endast därför att inget race existerar före
  mutationen. Den ger ingen rätt att läsa eller ändra något befintligt race.
- En event-creation-session får inte användas på pairing-, import-, klass-,
  omräknings-, overview-, station- eller ingestvägar.
- Login/logout behåller strikt Origin/body/CSRF-policy. Create kräver Origin,
  session, CSRF, canonical key och begränsad strikt body.
- Auth, Origin och CSRF avvisas innan body läses. Application gör alltid om auth
  under lås; routekontrollen är inte den auktoritativa säkerhetsgränsen.
- Alla session-, create- och felsvar är `private, no-store`, `nosniff` och
  `no-referrer`. Sidan förbjuder inramning och stänger kamera, mikrofon och
  geolocation.
- Fel är stabila och detaljfria: 400 `INVALID_REQUEST`, 401 `UNAUTHORIZED`,
  403 `FORBIDDEN`, 409 `CONFLICT`, 500 `INTERNAL_ERROR`.

## Acceptans

- Rätt credential kan endast logga in i event-creation-flödet; fel prefix,
  expiry eller revocation skapar ingen session eller cookie.
- Åtta timmars credential och en timmes session accepteras; längre livslängder
  avvisas i både application och PostgreSQL.
- Cookies är separata från samtliga racebundna capabilities och har rätt
  produktions- respektive loopbackattribut.
- Origin/auth/CSRF avvisas före body-pull. Tom, överstor, fel Content-Type,
  ogiltig UTF-8, trasig JSON och extra fält ger stabilt detaljfritt 400.
- Exakt replay returnerar samma event-/race-id och skapandetid. Ändrad aktör
  eller något ändrat intentfält med samma request-id ger 409.
- Hundra samtidiga identiska request ger exakt ett event, ett lopp, en journal
  och en auditpost; övriga svar är replay utan deadlock.
- Credentialrevocation/logout som låser först stoppar väntande mutation. En
  mutation som låser först får committa atomiskt.
- Requestjournal, audit och svar innehåller inga access-, session-, CSRF- eller
  hashhemligheter.
- UI dubbelinskickslåser, visar internet/session/försöksstatus med text och
  symbol, och bevarar exakt okänd commit endast för explicit retry i minnet.
- Logout rensar klientens credential-, session- och requeststate och påstår inte
  bekräftad serverlogout vid okänt nätutfall.
- Publika `/` saknar createformulär, credentialfält och admincookies.
- Befintliga E2E-fixtures skapar race genom betrodd applicationkod, inte genom
  en publik eller test-only HTTP-bypass.
- Befintlig pairing, import, klassändring, omräkning, overview, station, ingest
  och publikresultat regresserar inte.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och buildgrind
  körs och redovisas exakt.

Se ADR-0021.
