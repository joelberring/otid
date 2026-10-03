# ADR-0016: Race-scopad pairingadministration med kort serverlagrad session

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 005E har en säker engångsinlösen men pairinggrant utfärdas och spärras
endast genom en betrodd direktdatabas-CLI. Projektet saknar arrangörsidentitet,
session, raceägarskap och generell rollmodell; `/admin` och dess äldre
mutationer är fortfarande uttryckligen utvecklingsytor. Att lägga öppna
issue/revoke-routes där skulle flytta säkerhetsgränsen utan autentisering.

En servergenererad pairingsecret gör dessutom webbutfärdning svår att retrya:
efter commit och tappat svar kan plaintext inte återskapas ur den lagrade
hashen. Att lagra plaintext eller skapa nya grant vid varje retry bryter
sekretess respektive idempotens.

## Beslut

### Smal accesscredential och session

Snittet inför ingen generell användare eller rolladministration. En betrodd CLI
provisionerar en individuellt märkt, hash-only accesscredential bunden till
exakt race och den enda capabilityn `PAIR_STATION`. Den gäller högst 24 timmar,
kan spärras append-only och används endast för att skapa en serverlagrad session.

Sessionen gäller högst åtta timmar och aldrig längre än accesscredentialen.
Servern genererar 32-byte sessions- och CSRF-secrets, lagrar endast SHA-256 och
sätter två host-only cookies. Sessionsbearern är HttpOnly; CSRF-cookien är
läsbar för att kunna skickas i `X-Otid-CSRF`. Båda är `SameSite=Strict` och
produktion använder `Secure`, `__Host-`, `Path=/` och ingen `Domain`.
Loopbackutveckling använder uttryckligt andra cookienamn och får stänga av
`Secure`; den policyn får aldrig väljas i produktion.

Accesscredentialen får skapa flera korta sessioner fram till expiry. Ett tappat
login-svar kan därför retryas utan att lagra plaintextsession på servern; en
eventuell orphan-session ger ingen större capability, löper ut och kan
ogiltigförklaras genom credentialrevocation. Logout appenderar en
sessionsrevocation och rensar cookies.

Varje skyddad mutation kräver exakt `Origin` från konfiguration, giltig session,
exakt race/capability och constant-time verifierad CSRF-header före bodyparsning.
Authorization görs om i mutationens databastransaktion medan sessionsraden är
låst. Sessionrevoke tar samma lås. Låsordningen är session och därefter
pairinggrant.

### Förlustsäker grantutfärdning

Webbläsaren skapar grant-id och 32-byte secret med Web Crypto och skickar bara
SHA-256. Servern sätter race från routen, scope `READOUT`, tio minuters
grantgiltighet och en serverberäknad credentialgiltighet från en strikt enum på
8, 24 eller 72 timmar.

`Idempotency-Key: pairing-grant:<grant-id>` är obligatorisk. En unik grant-id
och issuerkoppling gör samma accesscredential, race, id, hash och
credentialexpiry till en read-only duplicate med samma metadata. Annan hash,
actor eller kontext ger `409`. Endast första insert skapar audit.

Efter bekräftad commit konstruerar webbläsaren
`otid_pair_v1.<grant-id>.<secret>` lokalt. Servern får aldrig plaintext. Ett
tappat svar kan retryas så länge sidan har samma secret i minnet. Efter reload
visar den privata metadata-listan grantet men kan inte återge token; operatören
spärrar det och utfärdar nytt.

### Racegräns, status och audit

Issue/list/revoke ligger under race-scopade adminroutes. Sessionens race och
capability kommer aldrig från bodyn. Revoke söker grant under samma race och
är idempotent. Status härleds från grant, revocation och redemption och är
`ACTIVE`, `REDEEMED`, `REVOKED` eller `EXPIRED`.

Pairinggrant får nullable issuercredential för bakåtkompatibla CLI-grant.
`audit_event` får nullable `actor_kind`, `actor_id` och `request_id`. Webbissue
och revoke använder operatorcredentialens id som actor; äldre händelser och
betrodd CLI kan sakna actor-id. Token, secret och hash förbjuds i audit.

Att spärra ett redan inlöst grant spärrar inte den skapade
stationcredentialen. UI och kontrakt skiljer därför grantstatus från
credentialstatus och erbjuder inte revocation som om den vore retroaktiv.

### Fel och privat transport

Malformed/okänd/utgången/spärrad access eller session ger generiskt `401`.
Fel race/capability, Origin eller CSRF ger generiskt `403`; saknat eller annat
races grant ger generiskt `404`; idempotenskonflikt ger generiskt `409`.
Auth/Origin/CSRF sker före en strikt, 4 KiB JSON-body. Alla svar är
`private, no-store`, `nosniff` och `no-referrer`. Ingen credentialed wildcard-
CORS tillåts. Okända id:n använder dummyhash men skapar ingen audit/write-
amplification; generell DoS-rate limit är ett reverse-proxykrav.

## Konsekvenser

- Normal pairinggrantadministration kan ske i webben med individuell,
  racebunden aktörsaudit utan att exponera en generell authmodell.
- Accesscredentialen är fortfarande CLI-provisionerad. Det är en avsiktlig
  bootstrapgräns, inte färdig registrering, federation eller återställning.
- Den nya pairingadminytan är skyddad, men befintliga öppna TASK 001-adminsidor
  får inte kallas produktionssäkra förrän ett separat authsnitt omfattar dem.
- Pairingsecret blir klientägd och issue retry-säker utan plaintextlagring.
- Stationens redemption, credentialvalv, SQLite, outbox, resultatmotor och
  ingest-idempotens ändras inte.
- Ingen ny kryptografidependency behövs; Node/Web Crypto och PostgreSQL räcker.

## Migration och återställning

Migration 0004 är additiv. Credential-, revocation-, session- och
sessionsrevocationtabeller är append-only. Nya auditfält och issuerreferensen är
nullable så befintliga rader förblir giltiga. Produktionsrollback är verifierad
full backup eller korrigerande roll-forward; automatisk destruktiv `DROP` är
förbjuden.

## Avvisade alternativ

- Öppna adminroutes ovanpå nuvarande `/admin`: saknar autentisering och race-
  behörighet.
- Stationcredential eller pairinggrant som arrangörsauth: blandar separata
  trust domains och capabilities.
- Långlivad operatorbearer i Web Storage: ökar XSS- och exfiltrationsytan.
- Enbart `SameSite` utan Origin och CSRF: otillräckligt skydd för cookieauth.
- Full OIDC/lösenords-/rollplattform: för brett för denna capability och kräver
  externa beslut som inte behövs för pairingflödet.
- Servergenererad pairingsecret i HTTP-svar: kan inte återges säkert efter
  tappat svar.
- Plaintext eller reversibelt krypterad pairingsecret i PostgreSQL: onödig
  återläsnings- och nyckelyta.
- Nytt grant vid retry: förlorar idempotens och lämnar oklart aktiva grant.
