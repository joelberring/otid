# TASK248: neutral och tät separat brickhantering

Status: klart 2026-09-27.

## Användarutfall

Den nåbara separata sidan `/admin/[raceId]/cards` ska följa samma
lugna, informationstäta administrativa språk som `/manage` och den
nyligen förtätade starttidssidan. På bred skärm ska sökning,
deltagarval, nuvarande bricka och ny bricka vara lätta att jämföra
utan en lång stapel av stora kort. På mobil ska arbetsordningen vara
tydlig, utan sidspill och med befintliga 52 px tryckmål.

## Arkitektur- och licensgräns före implementation

ADR-0040 och domänreglerna behåller `CHANGE_ENTRY_CARD`, permanent
brickaägarskap, blockering vid flera aktiva kopplingar, fryst
versionsbundet intent och exakt same-id-retry. ADR-0072/TASK030 har
dessutom brickbyte i den gemensamma administratörsvyn. TASK248
ändrar endast den äldre separata sidans presentation. Ingen ny
behörighet, mutation, lagring, resultatregel, extern källa eller
AGPL-kod införs; ingen ADR eller migration behövs.

## Riktad acceptans

- Vardaglig header, sökning, länkad person, knappar och sparatbesked
  använder neutral skala, samma typografi och tunna avdelare.
- Granskning skiljs tydligt från normalt formulär. Okänt svar/retry
  får gul textstödd signal, faktiskt fel och flera aktiva kopplingar
  röd textstödd signal; färg är aldrig enda beskedet.
- Mobilens knappar/fält behåller minst 52 px och inga vyer spiller
  horisontellt vid 390/1366 px. Desktop får tätare layout.
- Befintligt syntetiskt TASK018-browserprov täcker sökning,
  uttryckligt val, blockering och exakt retry; komplettera det med
  visuella mått och skärmbilder. Kör berörd E2E-TypeScript/ESLint,
  webblint/typecheck/build. Ingen ny suite, databas eller riktig
  credential behövs för detta UI-snitt.

## Ingår inte

Fysisk SPORTident, brickåteranvändning mellan personer,
automatisk omräkning, importregeländring, publik/station/speaker,
GPS eller generell global ommålning.

## Utfall och verifiering

Den separata brickvyn använder nu neutral sidkrom och tunna avdelare.
Sökning och uttryckligt deltagarval delar desktoprad; nytt bricknummer
och granskning ligger intill varandra. Den permanenta regeltexten är
nedtonad, medan osäkert svar, fel och flera aktiva kopplingar har
textstödda signaler. Sidlokal CSS och presentationsklasser ändrar inte
kortmutationens frysta versionsbundna intent eller samma-id-retry.

`CI=true pnpm --filter @o-tid/web lint`, `typecheck` och `build`:
exit 0. E2E-TypeScript och E2E-ESLint: exit 0. Riktat syntetiskt
Chromiumprov `--grep TASK248`: 2/2 passerade vid 390/1366 px;
skärmbilder granskade, inget horisontellt spill. Ingen databas,
verklig credential eller fysisk enhet användes.

Kvarvarande antaganden: den riktiga administrativa sessionen och
PostgreSQL-baserat brickbyte beter sig som tidigare; mobilens
tryckmål är uppmätta i browser men inte fältprövade med handskar.
