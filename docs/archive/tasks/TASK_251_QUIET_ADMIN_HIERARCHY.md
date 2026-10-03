# TASK251: lugn visuell hierarki i tävlingsarbetsytan

Status: klart 2026-09-27.

## Användarutfall

Den gemensamma tävlingsarbetsytan `/admin/[raceId]/manage` ska kännas
neutral och informationstät även när användaren växlar arbetsflik eller
granskar en normal åtgärd. Färg ska reserveras för verkliga tillstånd:
gul för osäkerhet/saknad information, röd för fel eller kritiskt resultat,
och en diskret grön accent för verifierad klassledare i speakerläget.
Text eller annan form bär alltid samma betydelse som färgen.

## Avgränsning och beslut före implementation

Det befintliga administrativa gråsystemet, den kompakta desktoplayouten
och mobilens stora tryckytor behålls. Detta är en presentationsändring i
arbetsytans CSS-moduler. En normal granskning är inte ett fel och ska därför
inte använda varningsbakgrund. Underflikar ska uppträda som diskreta flikar,
inte en full rad markerade knappar. Ingen ny teknik, dependency,
domängräns, status, behörighet, mutation eller databasändring införs;
ingen ADR krävs. Publika sidor och stationens UI omfattas inte.

## Riktad acceptans

- Normal granskning är neutral, medan existerande osäker retry och faktisk
  fel-/saknad-signal fortfarande framträder med text och sparsam färg.
- Aktiv arbetsflik och underflik känns igen med text, vikt och tunn linje;
  inaktiv navigation är tyst. Fokusmarkering för tangentbord finns kvar.
- Desktop behåller kompakt innehåll och mobilens 44 px-mål bevaras.
- Speakerledare har fortsatt separat, textmärkt accent; inga feedrader
  färgkodats som om de vore verifierade ledare.
- Riktad visuell browserkontroll av arbetsyta vid desktop och mobil samt
  webblint/typecheck/build. Ingen ny bred testsuite.

## Ingår inte

Ingen ny speaker-/resultatlogik, full ommålning av alla sidor, automatisk
ledarfeed, ny responsiv arkitektur, GPS, stafett eller hårdvara.

## Utfall och verifiering

`/manage` använder nu neutralt vit/grå granskning även för vanliga
bekräftelsesteg. Desktopens underflikar har genomskinlig bakgrund och en tunn
linje för vald flik; samma markering finns kvar under pekarhover. Mobilens
väljare och manöverstorlekar är oförändrade. Befintliga gula signaler för
saknad/osäker information, röda felmarkeringar och speakerns textmärkta
gröna klassledare är oförändrade. Ingen request, datamodell eller statusregel
ändrades.

`CI=true pnpm --filter @o-tid/web lint`, `typecheck`, `build`, E2E-TypeScript
och E2E-ESLint: exit 0. Det riktade syntetiska Chromiumfallet `--grep
TASK251`: 1/1 passerade; det granskar 390/1280 px, neutral granskning,
aktiv underflik, fokusbar navigation och utan horisontellt sidspill.
Skärmbilder för mobil och desktop granskades. Första browserförsöket nådde
inte appen eftersom sandlådan nekade lokal port 3167 (`EPERM`). Två följande
försök visade att den tidigare hoverregeln fortfarande färgade vald flik;
CSS-regeln korrigerades och omkörningen passerade. Ingen databas, riktig
credential, fysisk mobil eller station testades.

Kvarvarande antaganden: övriga administrativa sidor och deltagar-/stationsvyer
behåller sina egna befintliga visuella system; det här begränsade snittet
bevisar inte en fullständig appgemensam designrevision eller fältläsbarhet i
regn/sol.
