# TASK268: kompakt neutral separat startlistepublicering

Status: genomförd och syntetiskt verifierad 2026-09-29.

## Användarutfall

Arrangören ska överblicka senaste publiceringsbeslut, aktuellt underlag och
vilka fält som blir offentliga utan stora verktygsblock eller en lång sida.
Granskning, bekräftelse och osäkert återförsök är nära varandra; alla
deltagare finns kvar i den befintliga sök-/filterbara förhandslistan.

## Gräns före implementation

ADR-0043/0044:s explicita publicering/avpublicering och frysta webb-/XML-
kopior lämnas orörda. PUBLISH binder revision, snapshot och sourceHash;
WITHDRAW binder bara senaste beslutsrevision och måste fortsatt fungera
även när aktuellt underlag inte kan publiceras. Avpublicering kan inte
radera tidigare nedladdade kopior. Det är planerad start, inte faktisk
start eller resultatslutstatus. Behörighet, Origin/CSRF, request-validering,
minnesburet fryst intent och explicit same-id-retry ändras inte.
Inga nya beroenden, API-/kontraktsändringar, migrationer eller domänbeslut.
Ingen ny ADR behövs för detta presenterande snitt.

Filägare: en befintlig Sol-agent äger komponent, sida, avgränsad ny
TASK268-CSS och endast privata publiceringsnycklar i i18n-filen.
Huvudagenten äger granskning, ett browserfall i befintlig syntetisk
harness, slutverifiering och dokumentation. Delad StartListContent,
publik rendering och serverflöden ändras inte.

## Acceptans

- Neutral sidkrom, låg verktygsrad, små rubriker och kort svenska fält-
  och integritetsförklaringar. Senaste beslut/status och aktuell
  tävlingsversion syns tillsammans; ändrat/ogiltigt underlag är textmärkt.
- Befintlig förhandslista visar namn, klubb, klass och planerad start;
  bricknummer finns inte. Lokal begränsad scroll med tangentbord/förklaring
  håller handlingarna åtkomliga även för en större deltagarlista.
- Granskning visar fryst PUBLISH-revision/snapshot/hash och alla
  offentliggjorda fält före bekräftelse. WITHDRAW visar exakt beslutsrevision,
  utan att antyda bindning till dagens felaktiga/ändrade underlag.
- Okänt svar visar samma action/versioner/request-id och explicit retry.
  Fokus flyttas utan animation. Refresh/nytt beslut är fortsatt spärrat
  under ett försök. Ingen automatisk ny request eller Web Storage.
- Mobil 390 px utan sidspill och minst 52 px handlingar; desktop 1366 px.
- Ett syntetiskt browserfall med 60 deltagare provar publicering/retry
  och att ogiltigt aktuellt underlag fortfarande medger granskad
  avpublicering. Riktade befintliga tester, web lint/typecheck/build och
  E2E-TypeScript/ESLint; ingen databas, riktig credential eller publicering.

## Ingår inte

Ny publiceringspolicy, delpublicering, ändrad XML/export, publikt UI,
gemensam /manage-väg, servermutation, offlinepublicering, fysisk mobil,
stafett, GPS eller SPORTident/USB.

## Genomfört och verifierat

Senaste beslut/status och aktuell tävlingsversion visas i en låg rad
nära publiceringsåtgärderna. Logout, omläsning och publik länk delar
verktygsrad på desktop; mobil använder två korta knappar och en separat
länk. Normalytor är gråvita, med små textstödda markeringar vid ändrat,
ogiltigt underlag eller osäkert skrivutfall.

Granskningen visar fryst action och beslutsrevision; PUBLISH visar även
snapshot och hash, medan WITHDRAW inte framställer dagens underlag som
sin källa. Request-id syns vid okänt svar. Offentliga fält och att sparade
kopior inte kan raderas förklaras nära bekräftelsen. Fokus flyttas utan
animation. Den befintliga sök-/filterbara StartListContent återanvänds
inom en lokal tangentbordsåtkomlig scroll, med alla deltagare kvar och
utan printklippning. Delad/publik komponent och befintliga publicerings-
funktioner, auth, CSRF och same-id-retry är oförändrade.

Verifiering efter sista applikationskodändringen:

| Kommando | Exakt resultat |
| --- | --- |
| `CI=true pnpm --filter @o-tid/web lint` | exit 0 |
| `CI=true pnpm --filter @o-tid/web typecheck` | exit 0 |
| `CI=true pnpm --filter @o-tid/web exec vitest run src/lib/start-list-publication-admin-route-handlers.test.ts src/lib/start-list-time.test.ts` | exit 0, 2 testfiler, 4/4 tester |
| `CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.result-finalization-public-link.json` | exit 0 |
| `CI=true pnpm exec eslint tests/e2e/task-268-start-list-publication-visual.spec.ts tests/e2e/playwright.result-finalization-public-link.config.ts --parser-options '{"projectService":false,"project":"tests/e2e/tsconfig.result-finalization-public-link.json"}'` | exit 0 |
| `CI=true pnpm exec playwright test --config tests/e2e/playwright.result-finalization-public-link.config.ts --grep TASK268` | slutkörning exit 0, 1/1 Chromiumfall vid 390/1366 px, 3,5 s |
| `CI=true pnpm --filter @o-tid/web build` | exit 0, Next-build och offline-appskal byggda |

Det enda browserfallet har 60 kontraktsvaliderade syntetiska deltagare,
blandad FIXED/PUNCH, en saknad planerad tid och äldre aktiv publicering.
Alla API-anrop avlyssnas. Det provar filter/rensning, lokal scroll till
sista deltagaren, ingen POST före bekräftelse, exakt fryst PUBLISH-body,
byteidentisk retry-nyckel/body och simulerad godkänd kvittens. Därefter
växlas aktuellt content/hash till null; PUBLISH saknas men WITHDRAW
granskas och skickar enbart revisionen, inte dagens hash/snapshot.
Ingen Web Storage används. Fyra bilder granskades: datoröversikt,
mobilbekräftelse, mobilretry och mobilavpublicering.

Första browserkörningen gav exit 1: sista raden låg under skärmens kant
eftersom provet bara rullade inuti listan utan att först visa listrutan.
Provet rättades till att först navigera till listrutan och sedan rulla
lokalt; E2E-TypeScript/ESLint och browser kördes om och passerade.
Ingen applikationskod ändrades efter de gröna web-/enhetskontrollerna.
Äldre PostgreSQL-beroende TASK006S/T-browserprov kördes inte; endast
två statuslokatorer preciserades mot publiceringskvittensen så de inte
blandas ihop med förhandslistans separata filterstatus.

## Kvarvarande antaganden

- Syntetiska API-svar och kvittenser bevisar klientpresentation/retry,
  inte verklig publicering, XML-generering eller databastransaktion.
- 60 deltagare är ett layoutprov, inte maxlastacceptans för 10 000.
- Fysisk mobil, skärmläsare och verklig print-/tävlingsdrift återstår.
  Ingen riktig credential eller tävlingsdata användes.

Nästa minsta vertikala uppgift: förtäta den läsande avläsningshistorikens
översikt och deltagardetalj, med tydlig ordning för stämplingar och
resultatrevisioner men utan ändrad historik-/resultatpolicy.
