# ADR-0017: Capability-separerad, racebunden IOF-importadministration

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 001:s atomära CourseData-/EntryList-import är fortfarande en öppen POST-
route som läser multipart före autentisering. TASK 005F skapade en säker men
avsiktligt pairing-specifik accesscredential, session, cookie och capability.
Att ge `PAIR_STATION` rätt att importera skulle bryta minsta behörighet. Att
bygga en generell användar-/rollplattform är samtidigt för brett för nästa
vertikala bevis.

Importen har en befintlig beständig innehållsbarriär över race, IOF-kind och
SHA-256, men HTTP-skalet saknar ett requestbundet idempotenskontrakt, strikt
faktisk bodygräns och actor-audit. En stor upload får inte läsas före auth eller
hålla sessions-/racelås medan nätströmmen anländer.

## Beslut

### Additiv capability och separata ytor

Befintligt hash-only credential-/sessionsubstrat utökas additivt med capabilityn
`IMPORT_IOF`. Det är fortfarande inte en generell rollmodell. Credentialen är
bunden till exakt race, individuellt märkt, högst åtta timmar och append-only
revokerbar. Importcredential använder prefixet `otid_org_import_v1`; pairing
behåller `otid_org_pair_v1`. Prefix och lagrad capability måste matcha.

Importsessionen gäller högst en timme;
pairing behåller 24 respektive åtta timmar. Sessiontabellen och
`otid_org_session_v1` återanvänds, men pairing och import får
separata cookiepar och separata race-scopade login/logout-routes. Importcookies
heter i produktion `__Host-otid-import-admin-session` och
`__Host-otid-import-admin-csrf`; loopback använder explicita icke-`__Host-`
namn. Därmed kan en importsession inte presenteras som pairingbevis och de två
funktionerna skriver inte över varandras browsercookies.

Loginrouten bär race och förväntad capability. Applikationen verifierar dessa
innan sessionsraden infogas. TASK 005F:s pairinglogin flyttas samtidigt till
en race-scopad route så fel-race-login inte först skapar en orphan-session och
skriver över en giltig cookie.

De fysiska tabellerna behåller TASK 005F:s `pairing_admin_*`-namn. Att byta
produktionsnamn till generella namn skulle kräva en bred, riskfylld migration
utan beteendevärde i detta snitt. Applikations- och ADR-språket beskriver dem
som ett raceadministrativt säkerhetssubstrat; fysisk namnkontraktion skjuts upp.

### Tvåfasig auth, rå XML-body och parserhärdning

Unsafe requests kräver exakt canonical Origin och importens egna session-/CSRF-
cookies. Första authkontrollen sker utan mutation innan body läses. Därefter
läses requestströmmen till en hårt begränsad buffer oberoende av deklarerad
`Content-Length`. Requesten måste vara exakt `application/xml`, 1–5 000 000
faktiska bytes och strikt UTF-8. Filnamn och multipartmetadata har inget
domänvärde och transporteras inte.

Webbläsaren skickar `Idempotency-Key: iof-import:<canonical-request-uuid>` och
behåller request-id, fil och serveroberoende SHA-256 i minnet för explicit retry.
Servern beräknar själv SHA-256 över exakt accepterade bytes och litar inte på
klienthashen.

Obetrodd XML får inte använda DTD eller entities. IOF-adaptern avvisar
`<!DOCTYPE` och `<!ENTITY` före parsing och konfigurerar parsern med
`processEntities: false`. Entity-expansion och externa entities får därmed inte
bli CPU-, minnes- eller filåtkomstväg.

IOF-adaptern parsar dokumentet efter första auth men före mutationstransaktionen.
Transaktionen autentiserar samma session igen under radlås och låser sedan race
exklusivt före import. Låsordningen är `session -> accesscredential -> race`.
Det undviker nät-I/O under lås men gör vunnen logout/revocation definitiv före
commit.

### Requestbunden idempotens, audit och UI

Befintlig unik nyckel `(race_id, kind, content_hash)` är innehållsbarriären. En
ny append-only `iof_import_request` har request-UUID som primärnyckel och binder
race, actorcredential, serverhash, importfil, utfall och tid i samma transaktion.
Exakt retry med samma actor/race/hash återger ursprungligt utfall och metadata.
Samma request-id med annan actor, race eller hash ger 409. Samma innehåll med ett
nytt request-id skapar ett duplicate-requestspår men ingen domänmutation.

Samtidiga identiska exakta requests serialiseras av sessions-/racelåsen: exakt
en requestrad, import, snapshotökning och mutationsaudit skapas. Endast första
lagring appenderar `IOF_IMPORT_STORED_BY_ADMIN` med importfilens id som entity,
request-id i requestfältet och accesscredentialens id/nya actor-kind
`IOF_IMPORT_ACCESS_CREDENTIAL`. Audit innehåller kind, byteantal, importantal
och snapshot före/efter men inte XML, hash, namn, filnamn, credentials,
session/CSRF eller authhash.

En separat svensk importsida håller accesscredential, `File` och beräknad hash
endast i minnet. Okänd commit eller 401/403 behåller filen för explicit login/
retry. Bekräftad `stored` eller `duplicate` rensar filen. Ingen automatisk retry
eller Web Storage används. Sidan säger uttryckligen att övrig admin inte skyddas
av denna capability.

### Fel och privat transport

Authfel är generiska 401/403. Medietyp-, idempotens- och storleksfel är stabila
400; stödd men ogiltig IOF XML ger stabilt 422 utan rå parser-/databasdetalj.
Alla svar är `private, no-store`, `nosniff`, `no-referrer` och utan credentialed
CORS. Sidan använder `frame-ancestors 'none'`, `DENY` och stänger oanvända
browserfunktioner.

## Konsekvenser

- IOF-import kan exponeras som en smal produktionsautentiserad mutation utan att
  `PAIR_STATION` eller en generell rollplattform får mer makt.
- Pairinglogin blir race-scopad och säkrare men befintliga sessionsrader,
  credentials och pairinggrant förblir giltiga.
- Endast mutationens säkerhet förbättras. Tävlingsskapande, read-only admin,
  klassändring och omräkning är fortsatt öppna utvecklingsytor.
- Fem megabyte buffras efter auth för deterministisk bodygräns. Det är ett
  medvetet litet tak; större filer/objektlagring kräver separat upload-ADR.
- Ingen ny dependency eller extern kod behövs.

## Migration och återställning

Migration 0005 lägger till capabilityn `IMPORT_IOF`, audit-actor-kind
`IOF_IMPORT_ACCESS_CREDENTIAL`, append-only `iof_import_request` och ett
immutabilitetsskydd på `import_file`. PostgreSQL kan inte ta bort enumvärden
säkert med enkel rollback. Vid incident inaktiveras nya routes/CLI och en
korrigerande migration görs; full rollback sker från verifierad backup.

## Avvisade alternativ

- Ge `PAIR_STATION` importbehörighet: bryter minsta privilege och trust domain.
- Duplicera hela credential-/sessiontabellerna: onödig kryptografi- och
  revocationyta för samma racebundna säkerhetsmekanism.
- En enda cookie för pairing och import: skapar flikkonflikter och gör
  capabilityförväxling svårare att upptäcka.
- Global login följd av klientkontrollerat race: kan skapa orphan-session och
  skriva över giltig cookie innan servern avvisar användningsrätten.
- Läs body eller multipart före auth: möjliggör obehörig minnes-/CPU-amplifiering och
  bryter dokumenterad auth-före-body.
- Håll databaslås under nätuppladdning: ökar DoS- och contentionrisk.
- Multipart för en enda fil: tillför filnamn/boundaryyta utan domänvärde.
- Förlita sig endast på filnamn, MIME eller `Content-Length`: obetrodd metadata
  och kringgåbart vid chunked/HTTP2.
- Automatisk retry: kan dölja okänd commit och bryter operatörens kontroll.
- Endast content-hash utan request-id: deduplicerar data men kan inte binda en
  okänd commit till actor/race eller upptäcka request-id-kontextkonflikt.
- Full generell arrangörs-/OIDC-/rollmodell: för brett för detta vertikala snitt.
