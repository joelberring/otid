# Betrodd kontoåterställning

Återställning gäller ett befintligt konto och kräver att en betrodd
serveroperatör först har kontrollerat personens identitet utanför O-Tid.
Varken kontoägare för ett event, ADMIN, funktionär eller inloggningsnamn ger
denna globala behörighet. Återställningen byter bara kontots lösenordsverifierare;
eventgrants, anmälningskopplingar och tävlingsdata ändras inte.

Kör CLI:n i betrodd servermiljö med databasens `DATABASE_URL` angiven i
miljön. I production krävs `NODE_ENV=production` och den explicita
bekräftelsen `production-account-password-recovery`. I development/test godtas
endast samma `DATABASE_URL` och `TEST_DATABASE_URL` till en loopback-PostgreSQL
med databasnamn som börjar `otid_task161_` eller `otid_test_`, samt
bekräftelsen `synthetic-test-database`.

## Utfärda kod

Förbered en privat katalog med ägarskap för operatören och läge 0700. Lägg
begäran i en privat JSON-fil och skicka den via stdin. Fälten måste vara exakt
`accountId`, `loginName`, `operatorLabel` och `reason`:

```bash
pnpm account:password-recovery issue --confirm production-account-password-recovery --private-output /private/path/recovery.json < /private/path/recovery-request.json
```

CLI:n skapar en slumpmässig 32-byte kod, binder intent till ett request-ID och
24 timmars utgångstid, och skriver manifestet till en ny privat 0600-fil innan
den kontaktar databasen. Den skriver bara icke-hemlig issue-status till stdout.
Kopiera koden ur den privata filen och överlämna loginName och kod till
mottagaren genom en separat privat kanal. Lägg aldrig koden i terminalargument,
URL, logg eller ärendehistorik. Behåll filen privat tills återställningen är
bekräftad.

## Retry och status

Om utfärdandets svar är osäkert, återförsök med samma manifestfil. Ändra inte
request-ID, kod, konto, loginName, operatör, anledning eller utgångstid:

```bash
pnpm account:password-recovery retry --confirm production-account-password-recovery < /private/path/recovery.json
```

Koden kan inte läsas tillbaka från servern. För status, skicka endast
`{"recoveryId":"..."}` på stdin:

```bash
pnpm account:password-recovery status --confirm production-account-password-recovery < /private/path/recovery-id.json
```

Status visar endast ID, kontoreferens, loginName, tider och `PENDING`,
`REDEEMED`, `REVOKED` eller `EXPIRED`.

## Spärra kod

Skicka ett strikt JSON-objekt på privat stdin med `formatVersion`, `requestId`,
`recoveryId`, `operatorLabel` och `reason`. Spara samma objekt om svaret är
osäkert och använd det igen för idempotent retry av spärren:

```bash
pnpm account:password-recovery revoke --confirm production-account-password-recovery < /private/path/revoke-request.json
```

En spärr kan inte häva en redan genomförd återställning. Om en kod har gått
förlorad, kontrollera status och spärra en pending kod innan en ny utfärdas.
Vid misstänkt kontokapning ska den separata betrodda kontospärren användas
omedelbart; kodutfärdandet spärrar inte äldre sessioner.

Mottagaren löser in koden i O-Tids recoveryvy och loggar sedan in normalt med
det nya lösenordet. Äldre sessioner blir ogiltiga först efter en lyckad
inlösen. Stationernas offlineavläsning och kö fortsätter fungera oberoende av
den här onlinetjänsten.

Rollback: stäng CLI:ns issue/revoke-kommandon och recovery-POST, men behåll
journaler och lösenordsversioner. Databasen återställs endast från en
verifierad fullständig backup. Efter en återställning kan en förlorad kod inte
återskapas; spärra den och utfärda en ny.
