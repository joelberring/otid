# ADR-0024: Capability-separerad avläsnings- och resultathistorik

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 001 kräver att arrangören kan se normaliserade avläsningar, resultat och
förklaringskod samt hela revisionshistoriken. Den nuvarande
`VIEW_RACE_OVERVIEW`-ytan är genom ADR-0020 uttryckligen PII-fri och får endast
visa struktur och aggregat. `RECALCULATE_RESULT` är enligt ADR-0019 en separat
mutationsbehörighet och dess kandidat-DTO är avsiktligt dataminimerat.

En äldre applicationfunktion `resultHistory(db, entryId)` är varken race-scopad
eller autentiserad och väljer breda revisionsrader. Att exponera den, bredda
overview eller ge en mutationscredential läsrätt skulle bryta befintliga
capability- och dataminimeringsgränser.

Historiken kan växa utan fast tak och samtidig ingest/omräkning kan appenda nya
revisioner. Ett enda obegränsat race-svar eller offsetpaginering är därför inte
ett stabilt eller bounded kontrakt.

## Beslut

### Egen smal read-only-capability

Säkerhetssubstratet utökas med `VIEW_READOUT_RESULT_HISTORY`. Credentialen är
bunden till exakt race, gäller högst åtta timmar och har prefixet
`otid_org_readout_result_history_v1`. Sessionen gäller högst en timme och har
egna host-only session-/CSRF-cookies.

Det befintliga fysiska `pairing_admin_*`-substratet och generiska
sessionstokenformatet återanvänds, men capabilitypolicy, login-schema, cookies,
routes och CLI är separata. Detta skapar ingen generell arrangörsroll och ger
ingen mutation eller åtkomst till andra adminytor.

### Två bounded projektioner

En readoutlista är discoveryytan och returnerar högst 50 rader i fallande
ordning efter serverns mottagningstid och readout-id. En opaque, strikt cursor
kodar exakt dessa keysetfält. Listan visar endast minsta identifiering och första
serverstatus, inte punches eller revisionspayload.

En separat detaljprojektion för ett route-bundet readout-id visar den
normaliserade readouten, första bevarade serverbedömningen och den lösta
entryns immutable revisionshistoria i stigande revisionsordning. Första sidan
fryser högsta befintliga revisionsnummer. Cursorn binder detta vattenmärke och
nästa revisionsnummer, så senare append kan inte skapa dubletter eller ändra en
pågående genomgång. En helt ny detaljrequest får ett nytt vattenmärke.

Okänd bricka har ingen resultatrevision och returnerar därför `entry: null` och
tom historik. Om äldre data saknar `device_ingest_outcome` returneras
`firstServerAssessment: null`; servern hittar inte på historik.

Alla projektioner är explicita. Evaluation valideras med det delade strikta
domänkontraktet innan serialization. Både publicerade och opublicerade
revisioner ingår, eftersom arrangörens revisionshistorik annars vore
ofullständig.

### Transaktionsbunden auth och konsistens

Varje privat GET kör utan writes under en `REPEATABLE READ`-transaktion:

```text
session FOR SHARE
  -> accesscredential FOR SHARE
  -> revocation- och expirycheck
  -> race FOR SHARE
  -> bounded explicit projektion
```

Logout och credentialrevocation tar UPDATE-lås i samma session→credential-
ordning. En vinnande revoke lämnar ingen privat projektion; en redan låst
auktoriserad läsning får slutföras. Race SHARE serialiserar mot import och
klassändringens race UPDATE. Repeatable read ger ett koherent svar när ingest
append:ar parallellt. Revisionsvattenmärket ger dessutom stabilitet mellan
detaljsidor.

GET skapar ingen audit- eller journalwrite. Issue och revoke behåller befintlig
append-only säkerhetsaudit. Transaktionen deklareras inte PostgreSQL `READ ONLY`,
eftersom `FOR SHARE`-låsen som serialiserar revocation då inte är tillåtna;
noll-write-egenskapen verifieras i integrationstest.

### Privat browser- och DTO-gräns

Förauth-sidan serverrenderar endast race-id och statiskt shell. Credential och
DTO hålls i React-minne; sessionshemlighet är endast HttpOnly-cookie och CSRF i
egen cookie/minne enligt befintligt mönster. Ingen privat data skrivs till URL,
Web Storage eller cache. UI hämtar bara på login eller explicit operatörsval;
ingen polling, timer eller automatisk retry införs.

Tillåten projektion begränsas till normaliserad readout, intern nuvarande
entry-identitet, första centrala bedömning och immutable resultatrevisioner.
Namn är uttryckligen aktuellt visningsnamn, inte ett historiskt snapshot.

Raw payload/raw-id, device/session/sequence, packageversion, hashes,
transport/parserstatus, organisation, externa id:n, importinnehåll,
auditmetadata, credentialmetadata, tokens och authhashar väljs eller returneras
aldrig.

## Konsekvenser

- TASK 001:s arrangörskrav kan uppfyllas utan att försvaga PII-fri overview
  eller mutationscapabilities.
- Hela historiken är åtkomlig genom bounded paginering och append-only
  revisionsnummer, inte genom ett obegränsat svar.
- Aktuellt namn kan visas operativt men får inte tolkas som historisk identitet;
  modellen saknar ett immutable namnsnapshot per revision.
- Discoveryfeed är levande mellan sidor. Varje sida är koherent, men nya
  backdaterade stationreadouts kan förändra en framtida traversal; det är inte
  en exportfunktion.
- Ingen ny dependency, resultatregel, resultattabell eller hårdvarufunktion
  införs.

## Migration och återställning

Migration 0010 lägger additivt till capabilityvärdet, en validerad
åttatimmarscheck och ett index för racebunden fallande ingestordning. Inga
befintliga data skrivs om.

PostgreSQL-enumvärdet tas inte bort destruktivt. Vid incident inaktiveras
historyroute/CLI, credentials spärras och rättelse sker med additiv
roll-forward. Full återställning sker från verifierad backup.

## Avvisade alternativ

- Bredda `VIEW_RACE_OVERVIEW`: bryter ADR-0020:s PII-fria kontrakt.
- Återanvända `RECALCULATE_RESULT`: blandar läsning och mutation.
- Generell `VIEW_RACE_ADMIN`: bredare behörighet än den beslutade DTO:n.
- Exponera gamla `resultHistory`: saknar auth/race-scope och väljer breda rader.
- Ett obegränsat race-svar: saknar finite minnes-/svarskuvert.
- Offsetpagination: instabil vid samtidiga append och ger onödigt växande
  databaskostnad.
- Endast senaste revisionen: uppfyller inte revisionshistorik.
- Filtrera till publicerat: döljer faktisk arrangörshistorik.
- Aktuell klass-/namntext som historiskt snapshot: stöds inte av lagrad modell.
- Per-GET auditwrite: gör en read-only-yta skrivande och skapar obegränsad volym.
- Serverrendera privat historik: ökar RSC-/cacheläckage utan operativt behov.
