# TASK249: neutral och tät separat namn-/klubbrättning

Status: klart 2026-09-27.

## Användarutfall

Den nåbara separata sidan `/admin/[raceId]/entry-identity` ska följa
samma nedtonade administrativa språk som tävlingsarbetsytan, klass-,
starttids- och brickvyerna. På desktop ska sökning, uttryckligt
deltagarval, tre rättningsfält och privat rättningshistorik ge god
överblick utan stora gröna rutor eller en lång stapel av formulärdelar.
Mobilen ska ha en tydlig läs- och arbetsordning utan sidspill.

## Arkitektur och beslut före implementation

ADR-0067 och ADR-0075 gäller oförändrade: separat
`CHANGE_ENTRY_IDENTITY`-session, `MANAGE_RACE` i den gemensamma vyn,
versionsbunden ändring av endast förnamn, efternamn och klubbtext,
privat append-only historik och exakt samma-id-retry vid okänt svar.
Publicerade kopior och resultat ändras inte automatiskt. TASK249 är
endast sidlokal presentation av den äldre separata rättningssidan.
Ingen ny behörighet, serverväg, mutation, migration, dependency,
teknik eller domängräns införs; därmed behövs ingen ny ADR.

## Riktad acceptans

- Neutral sidkrom, enhetlig typografi och tunna avdelare i normalfallet.
  Permanent regeltext ska vara läsbar men inte dominera arbetsytan.
- Sökning och deltagarval delar rad på bred skärm; tre textfält ligger
  kompakt och historiken skiljs från formuläret utan stora kort.
- Osäkert svar/retry märks textuellt med gul signal. Faktiskt fel och
  ofullständig historik märks textuellt med röd signal. Färg är aldrig
  enda beskedet och normal status är neutral.
- Mobilens synliga formulärkontroller behåller minst 52 px, desktop
  rimlig täthet, och sidan har inget horisontellt spill vid 390/1366 px.
- Riktat syntetiskt Next-/Chromiumprov med API-svar i browsern kontrollerar
  översikt, val, historik och signaler utan databas eller verklig credential.
  Kör berörd webblint/typecheck/build och E2E-TypeScript/ESLint. Ingen bred
  ny testsuite.

## Ingår inte

Ingen ändring i auth-, CAS-, journal-, import-, resultat- eller
publiceringsregler; ingen personfusion, globalt klubbregister, Eventorskrivning,
offlinekö, bulkredigering, GPS eller fysisk SPORTident.

## Utfall och verifiering

Den separata sidan har nu neutral grafitgrå sidkrom. Sökning och
uttryckligt deltagarval delar desktoprad, de tre rättningsfälten
ligger tillsammans och rättningshistoriken har tunna avdelare samt
före/efter bredvid varandra på stor skärm. Mobilen använder en kolumn
och minst 52 px kontroller. Osäkert svar visas en gång i textmärkt
gul granskningspanel; faktiska fel och ofullständig historik har
textmärkt röd signal. Ingen auth-, ändrings- eller retrylogik ändrades.

`CI=true pnpm --filter @o-tid/web lint`, `typecheck` och `build`:
exit 0. E2E-TypeScript och E2E-ESLint: exit 0. Riktat syntetiskt
Chromiumprov `--grep TASK249`: 2/2 passerade vid 390/1366 px med
granskade normal- och retrybilder samt utan horisontellt spill.
Första browserkörningen gav 0/2 därför att testets till år 2099
satta syntetiska sessionstid överskred browserns timerintervall;
en giltig tiominuterssession användes i den gröna omkörningen.

Kvarvarande antaganden: den verkliga administrativa sessionen och
PostgreSQL-journalen fungerar enligt tidigare genomgående prov.
Fysisk touch/handskar och längre privata historiklistor är inte
visuellt fältprövade här.
