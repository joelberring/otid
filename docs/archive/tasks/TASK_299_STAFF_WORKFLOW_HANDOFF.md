# TASK299 – funktionärens nästa steg från Före-flödet

## Genomgång och konkret hinder

Före-kedjans befintliga ytor täcker Upplägg, Banor, Klasser, Deltagare,
lottning/starttider, startlista och funktionärsåtkomst. Genomgången är
källbaserad, inte funktionärsacceptans. Sol-auditen fann en konkret
överlämningslucka: RaceOperatorAccess utfärdar kod men visar inte vart
start-/målpersonal ska gå med den. Den separata appen finns redan på
`/checkin/index.html#<raceId>` och har explicit rollval/lokal förberedelse.

Root fann också att manuell bana+klass alltid skapas tillsammans (ADR-0103,
manual-course-class.ts); en fristående klass på befintlig bana saknar manuell
skrivväg. Det är ett senare funktionellt snitt som behöver egen ADR, inte
ett skäl att duplicera banor eller gissa koppling från namn.

## Beslut före kod

Lägg en kompakt, neutral överlämningsrad i befintliga RaceOperatorAccess:
start-/målappens racebundna länk och instruktion att välja rätt arbetsroll,
ange koden separat och förbereda enheten online före offlinebruk.
Tävlingsadministratörer hänvisas till samma racebundna manage-adress.
Visa båda destinationslänkarna som läsande hjälp, utan ny stor ruta.

Ingen ny API, capability, offlinepolicy, teknik eller domängräns; ADR behövs
inte för att visa befintliga destinationer. Credential får aldrig hamna i
URL, clipboard via automatisk kopiering, logg eller ny beständig lagring.

## Acceptans

- Länkar innehåller enbart race-ID, aldrig kod. Öppnas separat med noreferrer.
- Svensk text skiljer start-/målapp från administratörens arbetsyta.
- Befintlig kodvisning, okänt svar, spärrning och navigeringslås är oförändrade.
- Neutral inlinehjälp,44 px länkmål och radbrytning på mobil.
- Återanvänd endast befintligt TASK288-browserfall för STAFF-länk/text/URL
  vid390/1280 px utan utfärdande eller riktig credential/databas.
- Utfärdningskedjan är fortsatt befintlig TASK102-acceptans, inte nybevisad här.

## Verifiering

- `CI=true pnpm --filter @o-tid/web lint`: exit0.
- `CI=true pnpm --filter @o-tid/web typecheck`: exit0.
- `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.task167-payment-filter.json`: exit0.
- Riktad ESLint för `tests/e2e/task-227-class-finder.spec.ts` med samma
  E2E-projekt: exit0.
- `CI=true pnpm exec playwright test --config tests/e2e/playwright.task167-payment-filter.config.ts --grep TASK299`:
  exit0, återanvänt enda fall1/1 på40,6 s. Text/URL/target/noreferrer och44 px
  länkar vid390/1280 px, inga skrivbegäranden.
- `CI=true pnpm --filter @o-tid/web build`: exit0, Next16.3.3,
  22/22 statiska sidor genererade.

## Kvarvarande antaganden och nästa steg

Destinationslänkarna är verifierade, men provet öppnar inte appen, utfärdar
ingen kod och förbereder ingen verklig offlineenhet. Det är inte faktisk
funktionärsöverlämning, fysisk mobil/TLS eller ny auktoriseringsacceptans.
Koder lämnas fortfarande privat och användaren väljer rätt arbetsroll.
Offlineförberedelsens befintliga provenivå ändras inte av en länk.

Nästa minsta funktionella snitt: ADR/TASK för att skapa en manuell klass
på en exakt befintlig banversion i samma lopp. Behåll banan/historiken och
befintlig MANAGE_RACE-session; ingen namngissning eller kopiering av kontrollföljd.
