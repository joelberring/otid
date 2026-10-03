# ADR-0020: Capability-separerad PII-fri tävlingsöversikt

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

Den generella sidan `/admin/{raceId}` anropar `raceOverview` före
autentisering. Use casen väljer hela klass-, ban-, readout-, resultatrevisions-
och importrader och joinar deltagare med både namn, organisation och
brickkoppling. Sidan renderar delar av dessa privata data i HTML/RSC. Även den
publika resultatsidan använder samma breda use case enbart för en rubrik och
överläser därför raw-, evaluation- och importinnehåll.

TASK 005F–005I skyddar fyra olika mutationsdomäner med separata racebundna
capabilities. Ingen av dem innebär generell läsbehörighet. Att använda en
mutationscapability eller ”vilken adminsession som helst” skulle blanda
förtroendedomäner. En generell arrangörsidentitet, raceägarskap och rollmodell
är inte definierade och är för breda för detta snitt.

En skyddad wrapper runt den befintliga `raceOverview` är inte tillräcklig.
Dataminimering måste ske i SQL-projektionen så att förbjudna kolumner aldrig
hämtas. Auth utanför lästransaktionen lämnar dessutom ett fönster där logout
eller credentialrevocation kan committa mellan kontroll och privat läsning.

## Beslut

### En separat, smal läscapability

Säkerhetssubstratet utökas additivt med `VIEW_RACE_OVERVIEW`. Namnet uttrycker
att privilegiet gäller en enda begränsad overview, inte generell
raceadministration. Credentialen är bunden till exakt race, individuellt märkt,
högst åtta timmar och använder prefixet `otid_org_race_overview_v1`.
Sessionen gäller högst en timme och får egna cookies:
`__Host-otid-race-overview-session` och
`__Host-otid-race-overview-csrf`, med explicit namngivna loopbackvarianter.

Fysisk `pairing_admin_*`-lagring och det generiska sessionstokenprefixet
återanvänds av migrationssäkerhetsskäl. En exhaustiv capabilitypolicy väljer
prefix, strikt login-schema, livslängder och auditmetadata. Issue/revoke
auditeras; GET gör ingen write och skapar ingen obegränsad läsaudit.

### Transaktionsbunden read-auth

Overview-usecasen kör en enda transaktion och låser i ordningen:

```text
session FOR SHARE
  -> accesscredential FOR SHARE
  -> revocation- och expirycheck
  -> race FOR SHARE
  -> explicita aggregerade/projicerade frågor
```

Logout och credentialrevocation tar `FOR UPDATE` i samma session→credential-
ordning. Om läsningen får låset först är just den läsningen auktoriserad och får
slutföras innan revocation. Om revoke vinner ser den väntande läsningen den nya
revocationen och lämnar 401 utan overviewfråga. Race SHARE blockerar
snapshotmuterande import/klassändring som tar race UPDATE.

Ingest använder också race SHARE och kan append:a readouts/revisioner under en
overview. DTO:t visar endast oberoende aggregat och senaste tidsstämplar för
sådan aktivitet, aldrig individrader. Dessa fält beskriver aktuell operativ
aktivitet och påstår inte en ny domänsnapshot.

### SQL-minimerad privat DTO och separat publik projektion

Den privata usecasen hårdkodar `VIEW_RACE_OVERVIEW`. Caller får inte välja
capability. SQL väljer endast:

- race-id, event-/racenamn, racedatum, tidszon och snapshotversion,
- klass-id, klassnamn, startregel och aggregerat entryantal,
- ban-id och bannamn,
- totala antal klasser, banor, entries, aktiva brickkopplingar, readouts,
  resultatrevisioner och importer,
- senaste readout-, resultatrevisions- och importtid.

Inga entry-id:n, namn, organisationer, bricknummer, assignments, punches,
readout-/revision-/importfil-id:n, rawpayload, evaluation, individresultat,
original-XML, hash, rapport, externa id:n, device-/sessionsidentiteter,
credentialmetadata, tokens eller authhashar får väljas eller returneras.
Responsekontraktet är strikt och runtimevaliderat.

Den publika resultatsidan får `publicRaceSummary`, som endast väljer race-id,
eventnamn, racenamn och racedatum. Den privata overview-usecasen är aldrig en
publik beroendekedja. Den breda gamla `raceOverview` tas bort från webben och
ska inte behållas som en bekväm generell datagräns.

### Privat browseryta

`/admin/{raceId}` blir ett statiskt privat shell före login. Race-id är den
enda racespecifika input som får finnas i första HTML/RSC. Efter login hämtar
en client component DTO:t en gång och därefter endast vid explicit
uppdatering. Credential och DTO hålls i React-minne; ingen polling, timer,
Web Storage eller automatisk retry används.

Logout kräver Origin, CSRF och tom body. UI rensar DTO direkt när logout
begärs. Vid okänt svar påstås inte att serverlogout är bekräftad; operatören kan
retrya explicit. Länkar till mutationsytor visas först efter overview-auth men
varje yta fortsätter kräva sin egen capability och cookie.

Simulatorn tas bort från den generella overviewytan. Den använder
stationscredential, localStorage-baserad utvecklingskö och ingestbehörighet,
vilket är en annan trust domain. Overview-logout får varken ge, lagra eller
rensa stationscredential eller simulatorns lokala kö.

## Konsekvenser

- Den kvarvarande öppna generella admin-PII-läckan stängs utan att skapa en
  generell rollplattform.
- Privata kolumner hämtas inte och kan därför inte oavsiktligt läcka genom
  serialization, error handling eller framtida renderändring.
- Logout/revocation och privat läsning har en definierad serialiseringspunkt.
- Overviewcapabilityn kan inte mutera tävlingen och ger ingen implicit rätt till
  andra adminytor.
- Publika resultat hämtar inte längre privat admin-/rawdata för sin rubrik.
- Simulatorn är inte längre tillgänglig från overview; ett separat framtida
  utvecklings-/stationsbeslut krävs för att exponera den igen.
- Ingen ny dependency, domänregel eller extern kod behövs.

## Migration och återställning

Migration 0008 lägger additivt till enumvärdet `VIEW_RACE_OVERVIEW` och en
capabilityspecifik check som begränsar accesslivslängden till åtta timmar.
Befintliga credentials, sessioner, revocations och auditposter förblir giltiga.

PostgreSQL-enumvärdet tas inte bort med destruktiv rollback. Vid incident
inaktiveras overviewroute och CLI, credentialen spärras och en korrigerande
migration görs. Full rollback sker från verifierad backup.

## Avvisade alternativ

- `VIEW_RACE_ADMIN` eller `MANAGE_RACE`: namnet antyder bredare behörighet än
  den enda tillåtna DTO:n.
- Återanvända en mutationscapability: blandar oberoende förtroendedomäner.
- Låta vilken giltig adminsession som helst läsa: capabilityn blir då inte en
  faktisk säkerhetsgräns.
- Auth-wrapper runt befintlig `raceOverview`: privata kolumner läses fortfarande.
- Efterhandsredigering av breda databasrader: skyddar inte läs-/serialization-
  gränsen.
- Auth utanför transaktionen: lämnar revocationsfönster.
- Individuell deltagar-, readout-, revisions- eller importdetalj i generell
  dashboard: onödig PII/rådatayta; mer specifik administrativ yta kräver eget
  beslut.
- Per-GET auditwrite: gör read-only-flödet skrivande och skapar obegränsad
  auditvolym.
- Serverrendera privat data efter cookieauth: ökar risken att data hamnar i
  RSC/cache och behövs inte för den operativa klientytan.
- Behålla simulatorn efter overviewlogin: läscapability ger då skenbar åtkomst
  till en station-/ingestyta den inte auktoriserar.
