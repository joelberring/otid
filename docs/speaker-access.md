# Privat speakerbehörighet – TASK008

Serverläsningen kräver en separat VIEW_SPEAKER_BOARD. Detta är inte generell
arrangörsbehörighet och ger inte rätt att skriva resultat. Skyddade HTTP-routes
finns tillsammans med en första mobilvy. Kommandot öppnar ingen webbvy.
Öppna `/admin/{raceId}/speaker` och klistra in speakerns accessCredential i
behörighetsfältet. Översikten länkar också dit, men ger ingen speakerbehörighet.

Betrodd serveroperatör kör med DATABASE_URL i separat miljö och migrationer
0036/0037 installerade. Följ 0037:s underhållsstopp före migration. Ingen
Eventornyckel, stationscredential eller annan adminroll används.

```bash
umask 077
pnpm --silent speaker:access:issue --race-id <uuid> --label <operatör> --expires-at <UTC-ISO> > /private/path/new-speaker-credential.json
pnpm --silent speaker:access:revoke --credential-id <uuid> --reason <orsak>
```

Använd en ny privat fil i ägd katalog utanför repository, inte en befintlig
credentialfil. `--silent` behövs för att pnpm:s starttext inte ska blandas
med JSON-svaret. CLI:n skriver aldrig en bearer till interaktiv terminal och
tar ingen hemlighet i argv. Utfärdande till privat omdirigerad stdout måste
lyckas innan token kopieras till operatör. Högst åtta timmar, session högst
en timme. Ingen token ska läggas i URL, repository eller vanlig logg.

Felmeddelanden utelämnar databasdetaljer och argument. Ett skrivfel efter
servercommit kan lämna en skapad credential utan läsbar token: kontrollera
utfärdandejournalen, spärra den och utfärda ny avsiktligt. CLI är inte en
idempotent utfärdandejournal och får inte retryas blint. Spärrning är beständig;
tidigare credential/audit raderas inte. Ändra aldrig riktiga tävlingsbehörigheter
för att prova ett testfall.

## Webbgräns under implementation

`/api/admin/races/{raceId}/speaker-board-session` har POST för login,
GET för sessionsmetadata och DELETE för logout. Login kräver exakt konfigurerad
Origin och JSON med formatVersion/accessCredential; logout kräver samma Origin,
session, CSRF-cookie/header och tom body. Credential ska aldrig anges i URL.
`/api/admin/races/{raceId}/speaker-board` är skrivfri GET via den skyddade
application-läsaren. Alla svar är private/no-store, inklusive generiska fel.

Produktion kräver HTTPS och separata `__Host-otid-speaker-board-*` cookies;
utveckling tillåter endast explicit HTTP-loopback. Session är HttpOnly,
CSRF-cookie läsbar för klienten, båda SameSite=Strict. Andra operatörsrollers
cookies används eller rensas inte. Första genomgående browser/HTTP/PostgreSQL-
provet passerar för login, resultatpolling, offline/återanslutning, logout/sent
svar, spärrad credential och DNS-återtagande vid oförändrad tävlingsversion.
Sessionsutgång och emulerad fliksynlighet/återställning har separata browserprov.
Verklig tillbaka-navigation med ny autentisering har också passerat över
lokal HTTPS med standalone-server. Chromium anger no-store som hinder för
bfcache. ADR-0060 kräver inte att privata sidor cachelagras; äkta bfcache och
fysisk mobil är fortfarande overifierade. Använd inte proven som ett
produktionsberedskapsbesked.
