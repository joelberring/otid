# TASK 005F – autentiserad pairingadministration för ett lopp

## Syfte

Ersätt normal utfärdning och spärrning av TASK 005E:s pairinggrant via direkt
databas-CLI med en smal, autentiserad arrangörsyta för exakt ett lopp och
capabilityn `PAIR_STATION`. En individuellt märkt accesscredential provisioneras
fortfarande av en betrodd CLI, men används endast för att skapa en kort
serverlagrad webbsession. Pairinggrant skapas och spärras därefter via skyddade
HTTP-routes med aktörsbunden audit.

Snittet är inte generell användaradministration och skyddar inte retroaktivt
TASK 001:s övriga öppna arrangörssidor eller mutationer. Det omfattar inte
registrering, lösenord, e-post, OIDC, generell rollmodell, QR/kamera,
SPORTidentprotokoll, riktig USB, stafett eller GPS.

## Berörda paket

- `packages/database`: additiva operatorcredential-, session-, revocation- och
  aktörsauditfält samt issuerkoppling på pairinggrant.
- `packages/contracts`: strikta login-, issue-, list- och revokekontrakt.
- `packages/application`: hash-only accesscredential, serverlagrad session,
  race/capability-authorization och idempotent hashbaserad grantutfärdning.
- `apps/web`: sessionsroute, privata pairingadmin-routes och svensk
  arrangörskomponent.
- `scripts`: betrodd CLI för individuell accesscredential och revocation.
- `tests`: kontrakts-, route-, PostgreSQL- och Playwrightbevis.
- `docs`: arkitektur, domängräns, offlinekonsekvens, acceptans och status.

## Avgränsat flöde

1. Betrodd CLI skapar en individuellt märkt accesscredential för exakt race och
   `PAIR_STATION`. Formatet är
   `otid_org_pair_v1.<credential-id>.<32-byte-secret>`; endast SHA-256 lagras.
   Credentialen gäller högst 24 timmar och kan spärras append-only.
2. Operatören klistrar credentialen i pairingadminpanelen. Den skickas endast i
   en bodybegränsad, same-origin loginrequest, aldrig i URL eller Web Storage.
3. Servern autentiserar accesscredentialen och skapar en session som gäller
   högst åtta timmar och aldrig längre än accesscredentialen. Sessionssecret
   och sessionbunden CSRF-secret genereras med 32 slumpbytes vardera; endast
   hash lagras. Sessionsbearern sätts i HttpOnly-cookie och CSRF-värdet i en
   separat läsbar, host-only cookie. Båda är `SameSite=Strict`; produktion kräver
   `Secure`, `__Host-` och konfigurerad publik origin.
4. Varje unsafe pairingadminrequest kräver exakt konfigurerad `Origin`, korrekt
   sessioncookie och constant-time verifierad `X-Otid-CSRF` innan body läses.
   Authorization kontrolleras igen under sessionsradlås i mutationens
   PostgreSQL-transaktion.
5. Vid issue skapar webbläsaren själv ett UUID och 32 kryptografiskt slumpade
   bytes med Web Crypto. Endast SHA-256 skickas i exakt body tillsammans med
   en tillåten credentiallivslängd. Servern sätter `READOUT`, tio minuters
   grantlivslängd och serverbaserade tider.
6. `Idempotency-Key` är exakt `pairing-grant:<grant-id>`. Identisk actor,
   race, id och hash ger samma metadata och ingen ny audit. Ändrad hash,
   actor eller kontext ger generiskt `409`.
7. Efter bekräftad commit bygger webbläsaren
   `otid_pair_v1.<grant-id>.<secret>` lokalt och visar den exakt en gång.
   Secret/token lagras aldrig av servern, i URL, cookie eller Web Storage.
   Explicit retry kan återanvända samma in-memory secret efter tappat svar.
   Efter omladdning kan en okänd utfärdandestatus endast listas, spärras och
   ersättas.
8. Listan returnerar endast metadata och härledd status `ACTIVE`, `REDEEMED`,
   `REVOKED` eller `EXPIRED`. Revocation är race-scopad och idempotent. Ett
   redan inlöst grants spärrning spärrar inte den skapade stationscredentialen
   och UI:t säger detta uttryckligen.

## Beständighet och migration

- Migration `0004` är additiv och skapar accesscredential, dess revocation,
  session och sessionsrevocation. Samtliga är append-only.
- `station_pairing_grant` får en nullable issuerreferens så äldre CLI-grant
  förblir giltiga. `audit_event` får nullable typade aktörs- och requestfält;
  befintliga auditposter förblir giltiga.
- Sessions- och credentialrevocation kontrolleras vid varje skyddad request.
  En spärrad accesscredential ogiltigförklarar alla dess sessioner utan att
  gamla rader muteras.
- Mutationer låser session före pairinggrant. Sessionrevoke använder samma
  sessionslås så ingen issue/revoke får committa efter en vunnen revocation.
- SQLite, stationens Keystore/pendingstate, outbox, resultatmotor och
  ingest-idempotens ändras inte.
- Produktionsrollback är verifierad backup eller korrigerande roll-forward;
  inga nya tabeller eller auditfält droppas automatiskt.

## Säkerhets- och kontraktsgräns

- Malformed, okänd, felaktig, utgången eller spärrad access-/sessioncredential
  ger generiskt `401`. Giltig session för annat race/capability ger generiskt
  `403`. Saknat eller annat races grant ger generiskt `404`.
- Auth, Origin och CSRF kontrolleras före body. Body är strikt JSON, högst
  4 KiB, med content type `application/json` och utan extra fält.
- Alla admin- och sessionssvar är `private, no-store`, `nosniff` och
  `Referrer-Policy: no-referrer`. Ingen credentialed cross-origin CORS tillåts.
- Okända credential-/session-id:n går genom dummyhashväg utan databasmutation.
  Generell volymbegränsning ligger vid betrodd reverse proxy; obetrodda
  forwardingheaders används inte som identitet.
- Audit identifierar credentialaktören och idempotens/request-id men innehåller
  aldrig access-, session-, CSRF- eller pairingtoken, plaintextsecret eller
  secrethash. Endast första faktiska mutation appenderar issue/revoke-audit.
- Individuell operatorcredential får inte delas. Label är operativ metadata och
  får inte innehålla onödiga personuppgifter.
- TASK 005E:s publika redemption och TASK 005D:s stationcredential förblir helt
  separata från arrangörssessionen.

## Acceptans

- Accesscredential, session och CSRF lagras endast hashade och kan inte läsas
  tillbaka från API, listor eller audit.
- Cookiepolicy, expiry, logout och append-only revocation verifieras.
- Saknad/fel auth, Origin, CSRF, content type, body eller race ger ingen
  grant-, revocation- eller auditmutation.
- Hundra samtidiga identiska issue-anrop skapar exakt ett grant och en
  aktörsbunden auditpost; explicit retry returnerar samma metadata.
- Samma idempotensnyckel med ändrad hash, race eller actor ger `409`.
- Hundra samtidiga revoke-anrop skapar exakt en revocation och auditpost och
  returnerar samma `revokedAt`.
- Revoke och redeem serialiseras: revoke först stoppar inlösen; redeem först
  skapar exakt en credential som inte retroaktivt spärras av grantrevocation.
- Grantlistan är privat, race-scopad och innehåller aldrig token eller hash.
- UI håller access- och pairingsecret endast i minnet, visar pairingtoken exakt
  en gång och rensar den explicit eller vid omladdning.
- Ett webbutfärdat grant kan lösas in av befintligt TASK 005E-flöde och ger en
  fungerande stationcredential.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och buildgrind
  körs och redovisas exakt.

Se ADR-0016.
