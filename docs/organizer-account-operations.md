# Arrangörskonton: betrodd drift

Initial provisionering och lösenordsrotation körs endast från en betrodd
servermiljö. Inloggningsnamn/visningsnamn respektive konto-ID läses som JSON
från stdin. Lösenord genereras av applikationen och lämnar processen endast i
en ny, uttryckligen vald utdatafil. Filen skapas med läge `0600`; dess
föräldrakatalog måste redan finnas, ägas av aktuell operatör och ha läge
`0700`. Utdatafilen måste ligga utanför repository och får inte redan finnas.
Lösenord anges aldrig i argument, URL eller logg.

Förbered en privat JSON-fil för provisionering med endast kontouppgifter:

```json
{"loginName":"arrangor","displayName":"Arrangör"}
```

Kör i produktion med målanslutningen i serverns privata `DATABASE_URL`:

```bash
pnpm organizer:account provision --confirm production-organizer-account --private-output /private/path/first-organizer.json < /private/path/provision.json
```

Rotera därefter med konto-ID i stdin och en ny utdatafil:

```bash
pnpm organizer:account rotate --confirm production-organizer-account --private-output /private/path/rotated-organizer.json < /private/path/account-id.json
```

`account-id.json` har formen `{"accountId":"<uuid>"}`. Rotationen appender
en ny verifierarversion och gör tidigare kontosessioner obrukbara. Dela det
genererade lösenordet genom organisationens betrodda hemlighetshantering.

Testläge kräver `NODE_ENV=test`, identiska `DATABASE_URL` och
`TEST_DATABASE_URL`, explicit `--confirm synthetic-test-database`, en
PostgreSQL-loopbackvärd (`localhost`, `127.0.0.1` eller `::1`) och ett
databasnamn som börjar med `otid_task150_` eller `otid_test_`. Kör endast mot
en separat, migrerad databas med syntetiska konton. Använd aldrig en riktig
tävlings-, demo- eller privat användardatabas som testmål.

Om databaskommitten lyckas men skrivningen till utdatafilen misslyckas kan
kontot eller lösenordsrotationen redan vara genomförd. Behandla då den tomma
eller ofullständiga filen som oanvändbar och återanvänd den inte. Vid misslyckad
första provisionering: slå upp konto-ID via det exakta inloggningsnamnet med
betrodd, läsande driftåtkomst; läs aldrig verifieraren. Kör sedan rotation med
det konto-ID:t och en ny privat utdatafil. Vid misslyckad rotation är konto-ID
redan känt: kör rotation igen till en ny privat fil. En ny rotation spärrar
även sessioner från den osäkra omgången. Kör inte provisioneringen igen för
samma namn.

## Eventbunden medadministration (TASK151)

Provisionera den andra personens konto betrott enligt ovan innan ägaren delar
åtkomst; `/organizer` skickar ingen e-post och skapar inget konto. Ägaren
öppnar ”Mina tävlingar”, väljer ”Visa medadministratörer” på rätt event,
kontrollerar det exakta inloggningsnamnet och väljer ”Ge eventåtkomst”.
Tilldelningen gäller endast det eventets befintliga lopp via `/manage`.

Samma panel visar aktiv och återkallad tilldelning. ”Återkalla åtkomst” stoppar
den personens konto→race-delegering vid nästa skyddade request, även om
`/manage` redan är öppnad. Den tar inte bort historik eller påverkar
stationers separata offlinecredentials. Ny åtkomst efter återkallelse är en
ny tilldelning med ny grant-id. Vid osäkert nätverkssvar ska ägaren använda
panelens ”Retry samma försök” innan ett nytt försök görs. Ingen fysisk
fältacceptans eller produktionsdrift har utförts för detta flöde.
