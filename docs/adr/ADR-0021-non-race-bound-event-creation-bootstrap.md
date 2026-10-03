# ADR-0021: Separat icke-racebundet bootstrapflöde för eventskapande

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

`POST /api/events` skapar i nuläget ett event och dess första lopp utan
autentisering, Origin-/CSRF-kontroll, idempotency key, bodygräns eller audit.
Browsern kan därför skapa tävlingar genom cross-site-anrop, retry eller
dubbelklick, och rå valideringstext kan läcka. Det går inte att binda denna
mutation till en befintlig racecredential eftersom loppet ännu inte finns.

Det racebundna säkerhetssubstratet i TASK 005F–005J har `race_id NOT NULL` och
en FK till ett existerande lopp. Att göra den kolumnen nullable skulle ändra
innebörden och försvaga gränsen för samtliga beprövade capabilities. Att skapa
ett artificiellt systemrace skulle bryta event-/racedomänen. En generell
användar-, organisations- och rollplattform är ännu inte definierad och är för
bred för denna enda bootstrapmutation.

Skapandet måste även tåla okänd commit. Ett rent unikt namn-/datumvillkor kan
inte skilja transportretry från två avsiktliga, likadant namngivna tävlingar.
Idempotens måste därför bindas till klientens request-id, aktören och hela
normaliserade intentet.

## Beslut

### Ett separat globalt och smalt säkerhetssubstrat

Vi inför en enda global capability, `CREATE_EVENT`, i separata tabeller för
accesscredential, accessrevocation, session och sessionrevocation. Prefixet är
`otid_org_event_create_v1`. Accesscredentialen är individuellt märkt och gäller
högst åtta timmar; browsersessionen gäller högst en timme och aldrig längre än
credentialen.

”Global” betyder endast att credentialen inte kan bindas till ett ännu
icke-existerande race. Den ger ingen läs- eller mutationsrätt till befintliga
event eller race. Tabellen har ingen generell capabilitykolumn: dess enda
semantik är eventskapande. Befintliga `pairing_admin_*`-tabeller och deras
`race_id NOT NULL` lämnas oförändrade.

Credential- och revocationrader är append-only. Credentialraden bevarar
issuancefakta och revocationraden bevarar tid och orsak. Vi skapar inte en
fristående generell säkerhetsaudit enbart för att kringgå att `audit_event` är
racebundet. När event och lopp skapats skrivs däremot en vanlig racebunden
auditpost med actor kind `EVENT_CREATION_ACCESS_CREDENTIAL`.

### Låst auth och requestbunden idempotens

Create-usecasen kör en enda transaktion med låsordningen:

```text
event-creation session FOR UPDATE
  -> accesscredential FOR UPDATE
  -> revocation- och expirycheck
  -> transaktionsbundet advisory lock för request-id
  -> befintlig requestjournal eller ny atomisk create
```

Logout och credentialrevocation använder samma session→credential-ordning. Om
de får låset först avvisas den väntande mutationen. Om create får låset först
committar event, första lopp, requestjournal och audit tillsammans innan
revocation kan slutföras. Inga halvskapade event accepteras.

`Idempotency-Key` har formen `event-create:<canonical-uuid>`. Requestjournalens
unika request-id binder credential-id, exakt normaliserat eventnamn, racenamn,
datum och tidszon samt de skapade interna event-/race-id:na och skapandetid.
Exakt samma aktör och intent ger samma svar med `replayed:true`. Annan aktör
eller ändrat intent ger konflikt. Olika request-id:n dedupliceras inte utifrån
visningsnamn eller datum. Event- och race-PK:n är alltid servergenererade.

### Strikt HTTP- och browsergräns

`GET/POST/DELETE /api/admin/event-creation-session` hanterar den separata
sessionen. Befintlig `POST /api/events` ersätts i stället för att kompletteras,
så att ingen öppen bypass kvarstår. Mutationsrouten kontrollerar i ordning
canonical Origin, session/CSRF, canonical idempotency key och därefter en
streambegränsad body på högst 4096 bytes med strikt UTF-8 `application/json`.
Application återautentiserar under databaslås.

Produktionscookies heter `__Host-otid-event-creation-session` och
`__Host-otid-event-creation-csrf`; loopback använder
`otid_event_creation_session` och `otid_event_creation_csrf`. De är host-only,
`SameSite=Strict`, `Path=/` och `Secure` i produktion; sessioncookien är
`HttpOnly` medan CSRF-cookien måste vara läsbar av klienten.

`/admin/events/new` serverrenderar endast ett privat shell. Credential,
normaliserat intent och svar hålls i React-minne. Vid okänd commit behålls samma
request-id och exakt samma body för en explicit retry. Ingen timer, polling,
automatisk retry eller Web Storage används. En framgångsrik create ger inte
automatiskt någon racebunden capability.

Publika `/` behåller sin minimala lista och länkar till creation-shellet men
renderar inget createformulär och sätter inga admincookies. Att event-/racenamn,
datum och race-id redan är publik rubrikmetadata accepteras i detta snitt; en
framtida publiceringsstatus är ett separat domänbeslut.

## Konsekvenser

- Den sista kända öppna tävlingsmutationen stängs utan att luckra upp den
  racebundna säkerhetsmodellen.
- Okänd commit och samtidiga retries kan inte skapa dubbletter för samma
  avsikt, samtidigt som två uttryckliga avsikter förblir möjliga.
- Skapandet får ett beständigt aktörs-, intent-, event- och racespår utan att
  lagra hemligheter.
- Ett nytt separat credential-/sessionsubstrat innebär mer kod och schema, men
  dess scope är en enda bootstrapoperation och kan senare migreras till en
  beslutad organisationsmodell.
- Ingen ny dependency, resultatregel eller extern kod behövs.

## Migration och återställning

Migration 0009 skapar de fem separata append-only-tabellerna och lägger
additivt till audit actor kind `EVENT_CREATION_ACCESS_CREDENTIAL`. Befintliga
events, races, racecredentials, sessioner, revocations och auditposter ändras
inte.

Rollback i drift är expand-only: stoppa create-route och CLI, revokera aktiva
credentials och inför en korrigerande migration. PostgreSQL-enumvärdet och
tabeller med bevisdata tas inte bort destruktivt. Full återställning sker från
verifierad backup.

## Avvisade alternativ

- Göra `pairing_admin_access_credential.race_id` nullable: försvagar alla
  befintliga racebundna capabilitygränser.
- Skapa ett artificiellt ”systemrace”: bryter event-/racedomänen och FK-semantik.
- Återanvända en godtycklig racecredential: ger ett race rätt att skapa
  orelaterade event och blandar förtroendedomäner.
- Införa användare, organisationer, medlemskap och roller nu: bredare än detta
  snitt och saknar beslutad livscykel.
- Miljövariabel eller delad statisk adminhemlighet: saknar individuell expiry,
  revocation och beständigt aktörsspår.
- Unikt villkor på namn/datum: kan varken uttrycka transportretry korrekt eller
  tillåta avsiktligt lika tävlingar.
- En in-memory idempotencycache: är inte crash-safe och kan inte bevisa commit.
- Skapa event före requestjournal i separata transaktioner: lämnar halvcommit
  och dubblettrisk.
- En ny parallell skyddad route medan `/api/events` förblir öppen: lämnar den
  ursprungliga sårbarheten kvar.
- Automatisk provisionering av overview-/mutationscredentials efter create:
  blandar bootstrapcapabilityn med senare racebundna förtroendedomäner.
