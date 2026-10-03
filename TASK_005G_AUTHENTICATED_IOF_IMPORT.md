# TASK 005G – autentiserad IOF-import för ett lopp

## Syfte

Produktionsautentisera endast den befintliga atomära IOF XML-importen för ett
bestämt lopp. Snittet återanvänder TASK 005F:s hash-only accesscredential och
serverlagrade session som ett smalt säkerhetssubstrat, men inför en separat
capability `IMPORT_IOF`, separat tokenprefix, separata cookies och separata
race-scopade sessionsroutes.

Snittet skyddar inte tävlingsskapande, klassändring, explicit omräkning,
simulator, deltagarvisning eller övrig `/admin`. Det lägger inte till StartList,
ResultList, Eventor, generell användar-/rollmodell, QR/kamera, SPORTidentparser,
riktig USB, stafett eller GPS.

## Berörda paket

- `packages/database`: additiva enumvärden, append-only importrequest och
  immutabilitetsskydd för importoriginal.
- `packages/contracts`: strikta import-login-, importresultat- och felkontrakt.
- `packages/iof-xml`: explicit förbud mot DTD/DOCTYPE/ENTITY.
- `packages/application`: capability-generaliserad credential/login/auth och
  autentiserad import med actor-audit och dubbel authkontroll.
- `apps/web`: race-scopade pairing-/importsessioner, bodybegränsad rå XML-route
  och separat svensk importadminyta.
- `scripts`: betrodd CLI för `IMPORT_IOF`-accesscredential.
- `tests`: kontrakts-, route-, PostgreSQL- och Playwrightbevis.
- `docs`: arkitektur, domänregler, offlinekonsekvens, acceptans och status.

## Avgränsat flöde

1. Betrodd CLI skapar en individuellt märkt, racebunden accesscredential med
   capability `IMPORT_IOF`. Formatet är
   `otid_org_import_v1.<credential-id>.<32-byte-secret>` och endast SHA-256
   lagras. Befintlig `PAIR_STATION` använder fortsatt sitt eget prefix.
2. Operatören öppnar `/admin/{raceId}/imports`. Sidan förklarar att endast
   IOF-importen är skyddad och att övriga adminytor fortfarande är
   utvecklingsytor.
3. Login sker mot en race- och capability-specifik route. Fel race eller
   capability avvisas innan en session skapas eller cookies skrivs.
4. Importsessionen använder egna host-only session-/CSRF-cookies och kan därför
   inte ge pairingbehörighet eller skriva över pairingcookies. Produktion
   kräver `Secure`, `__Host-`, `SameSite=Strict`, `Path=/` och exakt canonical
   HTTPS-origin; loopbackutveckling använder explicita andra namn.
5. Webbläsaren validerar 1–5 000 000 bytes, skapar ett request-UUID, beräknar
   SHA-256 med Web Crypto och skickar exakt
   `Idempotency-Key: iof-import:<request-id>`, CSRF och filens exakta bytes som
   `application/xml`. Fil, XML, requeststate och credential hålls endast i
   minnet.
6. Routen verifierar Origin, session, race, capability och CSRF före en enda
   bodybyte läses. Den läser den faktiska requestströmmen med en strikt
   totalgräns och verifierar filstorlek, UTF-8 och exakt XML-medietyp.
7. IOF-adaptern parser hela dokumentet efter första authkontrollen men före
   mutationstransaktionen. Ogiltig XML lämnar databasen oförändrad.
8. DTD, DOCTYPE och ENTITY avvisas före XML-parsning och parserns entity-
   behandling är avstängd.
9. Mutationstransaktionen låser session och credential, kontrollerar auth igen,
   låser därefter loppet exklusivt och tillämpar befintlig atomär import.
   Samtidig logout/revocation kan därför inte följas av en importcommit.
10. Ett append-only `iof_import_request` binder request-id till actor, race,
    serverberäknad content hash, importfil och ursprungligt utfall. Exakt retry
    returnerar samma metadata; samma request-id med annan actor/race/hash ger
    409. Samma innehåll med nytt request-id blir content-duplicate utan ny
    domänmutation eller mutationsaudit.
11. Första lagringen appenderar exakt en auditpost med accesscredential som
    actor och importfilens id som entity, request-id i auditfältet och inga XML,
    namn, filnamn, credentials eller authhashar.
12. Vid okänd HTTP-commit behåller UI:t samma `File`, hash och request-id och
    erbjuder explicit retry.
    Ingen automatisk omsändning sker. Efter bekräftad `stored` eller `duplicate`
    rensas filinput; efter 401/403, nätfel eller reload fabriceras inget besked.

## Beständighet och migration

- Migration `0005` använder `ALTER TYPE ... ADD VALUE IF NOT EXISTS` för
  `IMPORT_IOF` och `IOF_IMPORT_ACCESS_CREDENTIAL`, skapar append-only
  `iof_import_request` och lägger immutabilitetstrigger på `import_file`.
  Befintliga credentials, sessioner och cookies för pairing förblir giltiga.
- De fysiska tabellnamnen från TASK 005F behålls av migrationssäkerhetsskäl trots
  att applikationsbegreppet blir ett raceadministrativt säkerhetssubstrat. En
  framtida namnkontraktion kräver eget expand/migrate/contract-beslut.
- `import_file` är fortsatt oföränderlig i applikationsgränsen och original-XML
  förblir privat. Befintlig unik nyckel `(race_id, kind, content_hash)` är den
  beständiga innehållsbarriären; requesttabellens UUID är retrybarriären.
- Produktionsrollback tar inte bort enumvärdet destruktivt. Inaktivera routes
  och CLI eller rätta framåt; full återställning sker från verifierad backup.

## Säkerhets- och kontraktsgräns

- `PAIR_STATION` får aldrig importera och `IMPORT_IOF` får aldrig administrera
  pairinggrant.
- Fel credential/session ger generiskt 401; fel race/capability, Origin eller
  CSRF ger generiskt 403. Kontrakts-/medietyp-/bodyfel ger generiskt 400 och
  ogiltig stödd IOF XML ger stabilt 422 utan parser- eller databasdetaljer.
- Auth görs före body och igen under sessionslåset före race-/domänmutation.
  Låsordningen är `session -> accesscredential -> race -> domänrader`.
- Requestens faktiska XML-body begränsas oberoende av `Content-Length`;
  chunked/HTTP2-body får inte kringgå gränsen.
- Alla sessions-, import- och felsvar är `private, no-store`, `nosniff` och
  `no-referrer`; adminsidans inramning, kamera, mikrofon och geolocation stängs.
  Ingen credentialed cross-origin CORS tillåts.
- Filnamn är endast UI-metadata och lagras/auditeras inte. XML, personnamn,
  accesscredential, session, CSRF och authhash får inte loggas eller auditeras.
- Reverse proxy ansvarar fortsatt för generell volymbegränsning. Applikationen
  begränsar body innan XML-parsning och skapar ingen auth-felaudit.

## Acceptans

- `IMPORT_IOF`-credential kan logga in endast för exakt race; `PAIR_STATION`,
  fel race, expired eller revoked credential skapar ingen importsession.
- Import- och pairingcookies är separata och rätt `__Host-`-/Secure-/HttpOnly-/
  SameSite-/Path-policy verifieras.
- Saknad/fel auth, Origin, CSRF, idempotens-id, content type, UTF-8 eller storlek
  avvisas före import-/snapshot-/request-/auditmutation.
- Ogiltig XML är atomär och ger stabilt privat fel utan XML eller intern detalj.
- DTD, DOCTYPE, ENTITY och entity-expansion avvisas utan parserarbete eller
  mutation.
- Hundra samtidiga identiska importer skapar en importfil, en domänförändring,
  en requestrad, en snapshotökning och en actor-audit; 99 svar är exakta replay.
- Samma request-id med annan actor, race eller bodyhash ger 409; samma innehåll
  med nytt request-id ger en requestrad med `duplicate` utan snapshot-/auditökning.
- Sessionlogout/revocation som vinner före den andra authkontrollen blockerar
  importcommit.
- CourseData och EntryList fungerar genom den skyddade ytan och befintlig
  startregel/idempotens ändras inte.
- UI behåller samma fil vid nätfel/okänd commit och explicit retry ger
  `duplicate`; filen rensas endast efter bekräftad commit eller explicit val.
- Credential och XML förekommer aldrig i URL, cookies, Web Storage eller audit.
- Befintlig pairingadmin, station, ingest, resultat och publikflöden regresserar
  inte.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och buildgrind
  körs och redovisas exakt.

Se ADR-0017.
