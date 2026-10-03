# TASK159: betrodd kontoinbjudan

Den här vägen skapar bara ett nytt konto. Den ger ingen tävlingsbehörighet,
kopplar ingen anmälan och återställer aldrig ett befintligt konto. Kontrollera
mottagaren utanför systemet innan koden överlämnas. Använd inte en verklig
Eventor-nyckel eller tävlingsfil i detta flöde.

## Miljö och privat fil

Migrera databasen till och med `0082_task_159_account_invitation.sql` innan
kommandot används. I produktion ska `NODE_ENV=production`, `DATABASE_URL` och
bekräftelsen `production-account-invitation` väljas i en betrodd servermiljö.
I utveckling/test krävs samma `DATABASE_URL` och `TEST_DATABASE_URL` till en
**isolerad loopbackdatabas** vars namn börjar `otid_task159_` eller
`otid_test_`, samt `synthetic-test-database`. Kör aldrig mot demo eller en
verklig tävling som prov.

Stdin är privat JSON, aldrig argument. `--private-output` är endast en
absolut sökväg till en **ny** fil i en befintlig katalog ägd av operatören
med rättigheter 0700. CLI skapar filen exklusivt med 0600, skriver och
synkroniserar koden och det exakta återförsöksunderlaget **före**
databasmutationen. Den skriver inte koden i stdout eller feltext.

Utfärda med stdin `{ "loginName": "...", "displayName": "...",
"operatorLabel": "..." }`:

```bash
pnpm account:invitation issue --private-output /private/otid/invitation.json --confirm production-account-invitation < /private/otid/issue-input.json
```

CLI skapar en 32-byte engångskod med högst 24 timmars giltighet, under
databasens absoluta gräns på 48 timmar. Hela privata filen behövs för
exakt återförsök. Dela bara `loginName` och `code` ur filen via en separat,
privat kontaktväg till rätt mottagare; dela aldrig själva återförsöksfilen.
Mottagaren använder `/activate`, sparar sitt eget genererade lösenord och
loggar sedan in som vanligt. Koden får inte förekomma i URL, e-postloggar,
browserlagring eller supportärenden.

## Okänt commitläge, spärr och incident

Vid timeout eller processavbrott efter att filen skrivits: behåll filen
orörd. Kör `retry` med samma fil på privat stdin och samma databas. Samma
request-id och avsikt returnerar samma `invitationId`; ändrad avsikt ger
konflikt. Skapa inte en ny inbjudan av misstag innan läget är känt.

```bash
pnpm account:invitation retry --confirm production-account-invitation < /private/otid/invitation.json
```

Betrodd status använder stdin `{ "invitationId": "<uuid>" }` och visar bara
icke-hemlig status (`PENDING`, `REDEEMED`, `REVOKED`, `EXPIRED`). En ännu
oförbrukad inbjudan kan spärras med stdin
`{ "formatVersion": 1, "requestId": "<ny uuid>", "invitationId": "<uuid>",
"operatorLabel": "...", "reason": "..." }`. Återförsök med exakt samma
request-id, operatör och anledning är idempotent:

```bash
pnpm account:invitation status --confirm production-account-invitation < /private/otid/status-input.json
pnpm account:invitation revoke --confirm production-account-invitation < /private/otid/revoke-input.json
```

Om koden försvunnit, läckt eller levererats fel: kontrollera status, spärra
om den inte redan är förbrukad och utfärda därefter en ny inbjudan. En
förbrukad kod kan inte spärras i efterhand; spärr av själva kontot och
incidenthantering använder befintlig kontoprocedur. Förlorat lösenord
kräver fortfarande betrodd rotation; ingen självtjänstrecovery finns.

Stäng ny CLI-utfärdning och `/api/account/activation` vid incident. Radera
inte journaler. Se [ADR-0152](adr/ADR-0152-trusted-account-invitation-activation.md)
för återställningsgräns och samtyckes-/behörighetsgränser.
