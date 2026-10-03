# TASK279: sök och öppna ett senare event efter ny arrangörssession

Status: genomförd och isolerat verifierad 2026-09-29.

## Mål och gräns

Verifiera TASK278:s lokala sökning genom riktig HTTP och PostgreSQL:
en OWNER skapar ett senare event, loggar in i en ny browserkontext,
söker dess event- eller loppnamn och öppnar just det loppet. En ADMIN
för ett äldre event får inte se eller söka fram det senare eventet.

Återanvänd TASK150:s isolerade konto-/eventharness och ett enda
browserscenario. Ändra inte produktkod, rollregler, API, schema eller
domängräns. ADR-0144/0145/0153 gäller oförändrat.

## Säker testmiljö

- Använd endast den tidigare av oss skapade, nu stoppade syntetiska
  PostgreSQL 17/PostGIS-instansen i
  `/private/tmp/otid-task277-pg17.SqxumYWS`, efter att version, port,
  databaslista och exakta namn åter har verifierats. Skapa där en ny
  syntetisk källbas `otid_task150_synthetic_task279` med `CREATEDB`.
  Ingen `.env.local`, demo- eller verklig tävlingsdatabas.
- TASK150 skapar en unik underdatabas och privat fixturkatalog; dess
  exakta teardown ska verifieras efter körning. Stoppa den egna instansen
  och bevara eller namnge eventuella rester.

## Acceptans

- OWNER:s nya session hämtar två event, kan söka fram det senare via
  dess loppnamn utan extra HTTP-anrop och öppnar rätt race.
- Rensning återställer båda eventen. ADMIN:s kontosession för första
  eventet får ingen träff för det andra och kan inte gå in i dess race.
- Ett riktat E2E-TypeScript/ESLint och ett enda befintligt riktigt
  Chromiumfall räcker. Ingen bred svit eller ny browserkonfiguration.

## Ingår inte

Fysisk mobil, privat kodöverlämning, samtidiga användare, serversökning,
Eventor, SPORTident, GPS eller en ny inloggningsmodell.

## Genomfört och verifierat

TASK150:s befintliga riktiga Next/PostgreSQL-browserharness fick ett
enda nytt TASK279-fall. OWNER skapar första eventet, stänger sessionen,
loggar in igen och skapar ett senare event. I tredje sessionen hittar
ägaren det senare eventet via ett unikt loppnamn, rensar filtret och
ser båda, filtrerar igen och öppnar exakt det senare loppets `/manage`.
Filtreringen skickar inga nya `/api/**`-begäranden. Ett annat syntetiskt
konto ser inte det senare eventet och nekas direkt race-enter med 404.
Fyra äldre lokatorer i samma spec uppdaterades till knappens aktuella
svenska text ”Öppna arbetsytan”; ingen produktkod ändrades.

Körmiljön var den redan separat skapade privata klustern
`/private/tmp/otid-task277-pg17.SqxumYWS`, verifierad som PostgreSQL
17.11/PostGIS 3.6.4 med `CREATEDB`. En ny källbas med exakt namn
`otid_task150_synthetic_task279` skapades tom och migrerades med 85
migrationer. Harnessen skapade/raderade en körningsunik måldatabas.
Efter provet återstod bara de två namngivna syntetiska källbaserna
(`otid_task150_synthetic_task279`, `otid_task160_test`) och PostgreSQL:s
standardbaser; TASK279-källbasen hade 0 event. Den egna klustern
stoppades med `pg_ctl stop -m fast`; den privata katalogen med enbart
syntetiskt underlag bevaras i stoppat tillstånd.

| Kontroll | Exakt resultat |
| --- | --- |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.organizer.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-150-organizer.spec.ts tests/e2e/task-150-organizer-server.ts tests/e2e/playwright.organizer.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.organizer.json"}'` | exit 0 |
| `CI=true TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55460/otid_task150_synthetic_task279 pnpm exec playwright test --config tests/e2e/playwright.organizer.config.ts --grep TASK279` | exit 0, 1/1 Chromiumfall (13,2 s) |

## Kvarvarande antaganden

- Browserfallet kördes med syntetiska konton på loopback. Det bevisar
  session/DB-samverkan för sökningen men inte en internetnåbar installation,
  fysisk mobil eller faktisk arrangörsanvändning.
- Två event räcker för återöppning och scope; TASK278:s separata
  syntetiska fall provar liststorlek med sex event/tolv lopp. Inget av
  dessa bevisar serverpagination eller hantering av tusentals event.

Nästa minsta vertikala uppgift: ett kort funktionärsprov på en faktisk
mobil av samma inloggning→hitta event→öppna arbetsyta, med mätbar
förståelse och utan extra parallellt admin-UI.
