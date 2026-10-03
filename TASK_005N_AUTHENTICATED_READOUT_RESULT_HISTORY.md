# TASK 005N – autentiserad avläsnings- och resultathistorik

## Mål

Slutför den återstående privata arrangörsdelen i TASK 001 som gäller att se
normaliserade avläsningar, resultatens förklaringskoder och hela den
append-only revisionshistoriken.

Snittet ska vara en separat racebunden read-only-yta. Det får inte bredda den
PII-fria tävlingsöversikten eller återanvända en mutationscapability.

## Arkitektur- och licensbeslut före implementation

- ADR-0024 inför capabilityn `VIEW_READOUT_RESULT_HISTORY`.
- Befintligt `pairing_admin_*`-substrat återanvänds med separat credential,
  session och cookies; det är inte en generell arrangörsroll.
- Den oskyddade, entry-bundna hjälpfunktionen `resultHistory` får inte
  exponeras eller återanvändas som HTTP-gräns.
- SQL-projektionen är explicit och får aldrig läsa eller returnera raw payload,
  raw-message-id, device/session/sequence, hash, importinnehåll, externa id:n,
  authhemligheter eller auditaktör.
- Ingen AGPL-kod eller extern implementation används. MeOS/Oxygen är inte
  källor för detta snitt.

Det finns ingen konflikt mellan `CODEX_BRIEF.md`, arkitekturdokumenten och
TASK 001 för denna avgränsning. Ingen domängräns eller teknikstack ändras.

## Berörda paket

- `packages/contracts`: strikta login-, list-, detalj-, cursor- och felkontrakt.
- `packages/database`: additiv capabilitymigration, livslängdscheck och
  läsindex; inga resultattabeller ändras.
- `packages/application`: transaktionsbunden auth och race-scopade, begränsade
  readout-/revisionsprojektioner.
- `apps/web`: egen sessionroute, list-/detaljroutar och svenskt adminshell.
- `scripts`: betrodd CLI-provisionering för den nya capabilityn.
- `tests`: kontrakts-, route-, UI-, PostgreSQL- och Playwrightbevis.
- `docs`: ADR, arkitektur, domänregler, offlinekonsekvens, acceptans och status.

`packages/domain`, resultatmotorn, ingestmutationen och publikresultaten ändras
inte.

## Avgränsat flöde

1. Betrodd CLI utfärdar en individuellt märkt credential för exakt race och
   capability `VIEW_READOUT_RESULT_HISTORY`. Giltighet är högst åtta timmar;
   sessionen högst en timme.
2. `/admin/{raceId}/history` serverrenderar före login endast race-id och ett
   privat shell. Ingen deltagare, bricka, stämpling eller revision läses.
3. Login/logout använder egna host-only cookies och samma strikta origin-,
   body-, CSRF-, expiry- och revocationregler som övriga capabilities.
4. `GET /api/admin/races/{raceId}/readouts` returnerar högst 50 poster per sida
   i stabil fallande ingestordning. En opaque cursor använder mottagningstid
   och readout-id; offset används inte.
5. Listan visar endast readout-id, lästid, bricknummer, första serverstatus/-
   orsak och eventuell nuvarande intern entry-identitet. Den påstår inte att
   nuvarande namn eller klass är ett historiskt snapshot.
6. `GET /api/admin/races/{raceId}/readouts/{readoutId}` returnerar den valda
   normaliserade avläsningen, första serverbedömningen när den finns och högst
   50 immutable revisioner åt gången i stigande revisionsordning.
7. Första detaljsidan fryser `upperRevision`. Cursorn binder detta vattenmärke
   och nästa revision. Senare append påverkar inte pågående historiepaginering;
   en ny detaljrequest ser den nya revisionen.
8. Okänd bricka visas med `entry: null`, `UNKNOWN_CARD` när bevarat utfall
   finns och tom historik. Äldre readout utan bevarat ingestutfall får `null` i
   stället för ett fabricerat utfall.
9. Historiken omfattar publicerade och opublicerade revisioner och samtliga
   orsaker. Evaluation valideras mot domänens strikta status-/orsaksregler och
   visar tider, missing, extra och splits.
10. Varje privat GET kör utan writes i en `REPEATABLE READ`-transaktion och
    autentiserar under låsordningen `session SHARE -> credential SHARE -> race
    SHARE` före projektionen. GET gör ingen write eller per-läsningsaudit.
11. Credential, sessiontoken, CSRF och DTO hålls endast i React-minne/cookies
    enligt befintlig modell. Ingen URL-hemlighet, Web Storage, polling,
    automatisk retry eller servercache används. Äldre sidor hämtas explicit.
12. List- och detaljsvar samt fel är `private, no-store`; shell och API förbjuder
    framing och sätter nosniff/no-referrer. Avvisade fel är detaljfria.

    Transaktionen kan inte deklareras PostgreSQL `READ ONLY`, eftersom de
    revocationsserialiserande `FOR SHARE`-låsen då vore förbjudna.

## Dataminimering

Tillåtet är endast det operativa underlaget som TASK 001 kräver:

- normaliserad brickidentitet, start/mål/stämplingar och lästid,
- intern entry-id och nuvarande visningsnamn när readouten är känd,
- första centrala status/förklaringskod och dess motor-/snapshot-/banversion,
- varje immutable resultatrevisions nummer, orsak, status, förklaringskod,
  publiceringsflagga, versioner, tid och validerad evaluation.

Förbjudet är raw payload och raw-message-id, device-/session-/sekvensfält,
packageversion, content-/evaluationhash, transport-/parserstatus,
credential-/session-/CSRF-värden och hash, label, importfil/XML/rapport/hash,
externa id:n, organisation och auditmetadata.

## Migration och återställning

Migration `0010`:

- lägger additivt till enumvärdet `VIEW_READOUT_RESULT_HISTORY`,
- lägger en validerad capabilityspecifik check för högst åtta timmar,
- lägger ett race-/mottagningstid-/id-index för keysetlistan.

Inga resultatrader eller rawrader skrivs om. PostgreSQL-enumvärdet eller indexet
tas inte bort destruktivt i produktion. Vid incident inaktiveras route/CLI,
credentials spärras och korrigering sker framåt; full återställning sker från
verifierad backup.

## Acceptans

- Rätt capability och race loggar in; varje annan capability, race, prefix,
  expiry, logout och revocation avvisas utan privat projektion.
- Login-, list-, detalj-, cursor- och svarskontrakt är strikta, bounded och
  avvisar okända fält, ogiltiga UUID/tider/limits/cursors och inkonsistent
  evaluation.
- Keysetlistan är deterministisk vid lika mottagningstid och har inga
  dubletter/luckor i en statisk fixture.
- Känd readout visar normaliserade punches och samtliga revisioner, inklusive
  `CARD_READOUT`, historisk `CLASS_CHANGE_RECALCULATION` och
  `EXPLICIT_RECALCULATION`, publicerade och opublicerade.
- Okänd bricka syns utan fabricerad entry eller revision. Äldre readout utan
  ingestutfall ger `firstServerAssessment: null`.
- Fryst revisionscursor påverkas inte av en senare omräkning; en ny request ser
  den senare revisionen.
- Ett annat races canarydata kan aldrig synas. Alla förbjudna fält och
  authhemligheter saknas från SQL-resultatets DTO, API, shell och fel.
- Hundra samtidiga GET gör noll writes. Logout/revocation serialiserar mot
  läsning enligt låsordningen; samtidig ingest/klass/import ger ett koherent
  före- eller efterläge per svar.
- Förauth-HTML/RSC saknar privat data. UI lagrar inget privat i URL/Web Storage,
  pollar inte och rensar DTO före logoutrequest.
- Befintlig overview, pairing, import, klassändring, omräkning, station, ingest,
  simulator och publikresultat regresserar inte.
- Lint, typecheck, enhets-, PostgreSQL-integrations-, Playwright- och buildgrind
  körs och redovisas exakt.

## Uttryckligen utanför snittet

- generell användar-/organisations-/rollmodell,
- redigering eller borttagning av readouts/revisioner,
- export, sökning och massurval,
- per-GET auditlogg,
- SSE eller polling för den privata ytan,
- ny resultatregel eller automatisk omräkning,
- riktig SPORTident-USB/protokollparser, Eventor, GPS, kartor eller stafett.

Se ADR-0024.
