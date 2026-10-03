# TASK 005J – autentiserad PII-fri tävlingsöversikt

## Syfte

Ersätt den öppna generella adminsidan med en racebunden, read-only och
produktionsautentiserad översikt. Snittet återanvänder det hash-only
säkerhetssubstrat som infördes i TASK 005F–005I men får en separat capability,
`VIEW_RACE_OVERVIEW`, eget credentialprefix och egna cookies.

Översikten visar endast tävlingens struktur, aggregerade antal och senaste
aktivitet. Den lämnar aldrig individ-, brick-, rå-, resultat- eller
importinnehåll. Den publika resultatsidan får samtidigt en egen minimal publik
rubrikprojektion och får inte längre överläsa det privata adminunderlaget.

Snittet skyddar inte tävlingsskapande, pairing, IOF-import, klassändring,
omräkning, simulator eller stationens ingest. Det lägger inte till en generell
användar-/rollmodell, Eventor, StartList, ResultList, QR/kamera,
SPORTidentparser, riktig USB, stafett, GPS eller annan senare funktion.

## Berörda paket

- `packages/database`: additiv capability och åttatimmarsgräns.
- `packages/contracts`: strikt login- och responsekontrakt.
- `packages/application`: låst läsautentisering, explicit privat projektion och
  separat publik race-rubrik.
- `apps/web`: egen sessionroute, privat overview-route och svenskt adminshell.
- `scripts`: betrodd CLI-provisionering för `VIEW_RACE_OVERVIEW`.
- `tests`: kontrakts-, route-, PostgreSQL- och Playwrightbevis.
- `docs`: arkitektur, domänregler, offlinekonsekvens, acceptans och status.

`packages/domain` och resultatmotorn ändras inte.

## Avgränsat flöde

1. Betrodd CLI skapar en individuellt märkt, racebunden accesscredential med
   capability `VIEW_RACE_OVERVIEW`. Formatet är
   `otid_org_race_overview_v1.<credential-id>.<32-byte-secret>` och endast
   SHA-256 lagras.
2. Operatören öppnar `/admin/{raceId}`. Serversvaret innehåller endast ett
   privat shell och race-id; ingen race-, deltagar-, brick- eller aktivitetsdata
   läses eller serverrenderas före autentisering.
3. Login sker mot en egen race- och capability-specifik route. Fel race,
   prefix, capability, expiry eller revocation avvisas innan session eller
   cookies skapas.
4. Sessionen gäller högst en timme och använder egna host-only session-/CSRF-
   cookies. Produktion kräver `Secure`, `__Host-`, `SameSite=Strict`, `Path=/`
   och exakt canonical HTTPS-origin; loopback använder explicit andra namn.
5. Browsern hämtar ett strikt versionerat DTO från
   `/api/admin/races/{raceId}/overview`. GET kräver session men inte CSRF och
   gör ingen audit-, journal- eller domänwrite.
6. Samma transaktion tar lås i ordningen `session SHARE -> accesscredential
   SHARE -> race SHARE` innan någon privat projektion körs. Logout och
   credentialrevocation använder `UPDATE`-lås. Om revoke vinner lämnas ingen
   data; om läsningen vinner får just den auktoriserade läsningen slutföras.
7. DTO:t innehåller endast race-/eventrubrik, datum, tidszon,
   snapshotversion, klass-/banstruktur, aggregerade antal och senaste
   aktivitetstider. SQL väljer endast dessa kolumner och beräknar individdata
   med `count`/`max`; breda rader läses inte och redigeras inte i efterhand.
8. Förbjudet är entry-id, namn, organisation, bricknummer, assignment-id,
   punches, readout-id, råpayload, revision-id, evaluation, individresultat,
   importfil-id/hash/XML/rapport, externa id:n, device-/sessionidentitet,
   credentiallabel, token och lagrade hashvärden.
9. UI:t håller credential och DTO endast i React-minne, hämtar en gång efter
   login och därefter endast vid explicit uppdatering. Ingen polling, timer,
   Web Storage eller automatisk retry används.
10. Logout kräver exakt Origin, CSRF och tom body. UI:t rensar privat data
    direkt när logout begärs. Ett okänt logoututfall påstås inte vara bekräftat
    utan kan retryas explicit.
11. Länkar till pairing, import, klassändring och omräkning visas först efter
    overview-auth. Varje mål kräver fortsatt sin egen separata capability och
    session; overview-sessionen ger ingen mutationsbehörighet.
12. Den befintliga simulatorn tas bort från adminsidan. Dess lokala kö och
    stationscredential påverkas inte och får inte rensas av overview-logout.
13. Den publika resultatsidan använder `publicRaceSummary`, som endast väljer
    den publika race-/eventrubrik den behöver. Den privata översikten eller
    breda gamla `raceOverview` får inte importeras från webben.

## Beständighet och migration

- Migration `0008` lägger additivt till `VIEW_RACE_OVERVIEW` i befintlig enum
  och en capabilityspecifik PostgreSQL-check för högst åtta timmars livslängd.
- Befintliga credentials, sessioner, revocations och auditposter lämnas
  orörda. Inga nya tabeller eller audit actor kinds krävs.
- Issue/revoke återanvänder befintlig append-only revocation och audit med
  entity type `race_overview_access_credential` och actions
  `RACE_OVERVIEW_ACCESS_CREDENTIAL_ISSUED` respektive
  `RACE_OVERVIEW_ACCESS_CREDENTIAL_REVOKED`.
- GET skapar ingen auditpost. Obegränsad per-läsning-audit skulle göra en
  read-only-yta skrivande och ingår inte i detta snitt.
- PostgreSQL-enumvärdet tas inte bort destruktivt vid rollback. Vid incident
  inaktiveras route/CLI och rättelse sker additivt; full återställning sker från
  verifierad backup.

## Säkerhets- och kontraktsgräns

- `VIEW_RACE_OVERVIEW` ger endast denna uttryckligen dataminimerade läsning.
  Den får inte användas som generell adminroll eller på mutationsroutes.
- `PAIR_STATION`, `IMPORT_IOF`, `CHANGE_ENTRY_CLASS` och
  `RECALCULATE_RESULT` får inte läsa översikten.
- Login/logout behåller strikt Origin/body/CSRF-policy. GET behöver ingen CSRF
  eftersom den är read-only och gör noll writes.
- Alla session-, overview- och felsvar är `private, no-store`, `nosniff` och
  `no-referrer`. Sidan förbjuder inramning och stänger kamera, mikrofon och
  geolocation.
- Fel är stabila och detaljfria: 400 `INVALID_REQUEST`, 401 `UNAUTHORIZED`,
  403 `FORBIDDEN`, 404 `NOT_FOUND`, 500 `INTERNAL_ERROR`.

## Acceptans

- Rätt credential loggar in endast för exakt race; fel prefix, capability,
  race, expiry eller revocation skapar ingen overview-session.
- Åtta timmar accepteras och mer än åtta timmar avvisas i både application och
  PostgreSQL. Sessionexpiry är `min(login + 1h, credential expiry)`.
- Overview har separata host-only cookies med korrekta produktions- och
  loopbackattribut.
- Förauth-sidan och dess RSC/HTML innehåller ingen race-, deltagar-, brick-,
  import- eller aktivitetsdata.
- Avvisad auth kör ingen race-/overviewfråga. Giltig läsning sker under
  session-/credential-/racelås och lämnar endast det strikta DTO:t.
- Canaryvärden för namn, organisation, brickor, punches, rawdata, evaluation,
  XML, rapport, hash, externa id:n, credentiallabel och authhashar förekommer
  aldrig i DTO, shell eller 401/403/404/500.
- Annat races canarydata kan inte påverka count, max eller struktur.
- Hundra samtidiga GET ger inga writes eller deadlocks. Revoke/logout som
  låser först gör väntande GET unauthorized; en GET som låser först får
  slutföras och nästa GET blir unauthorized.
- Samtidig import/klassändring ger en hel racekonfiguration före eller efter
  snapshotmutationen. Samtidig ingest får endast påverka aggregat/aktivitet och
  exponerar aldrig individdata.
- Responsekontraktet är strikt och avvisar extra privat fält. Den publika
  race-rubriken kan inte innehålla adminfält.
- UI lagrar inga credentials eller privata svar i URL eller Web Storage, gör
  ingen polling och rensar DTO direkt vid logoutbegäran.
- Simulatorn finns inte på overview-ytan och overview-capabilityn kan inte
  använda station-, import-, klass-, omräknings- eller pairingroutes.
- Publikresultatsidan läser endast sin minimala publika projektion.
- Befintlig pairing, import, klassändring, omräkning, station, ingest och
  publikresultat regresserar inte.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och buildgrind
  körs och redovisas exakt.

Se ADR-0020.
