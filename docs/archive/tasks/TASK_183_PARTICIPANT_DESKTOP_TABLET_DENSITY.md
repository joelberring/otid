# TASK183: tätare deltagaröversikt på padda och dator

Status: genomförd genom TASK185 och TASK187, 2026-09-25. Personfakta,
grupperade sekundära åtgärder, klassfilter och bredtabell finns. TASK187
förtätar toppyta/filter/verktygsrad och verifierar minst fem helt synliga
deltagarrader och valda personfakta vid 1280×800 med sex syntetiska personer.
Följ [UI-riktningen](docs/ui-workspace-design-2026-09-24.md).

## Användarutfall

En tävlingsadministratör på padda eller dator kan se fler deltagare och deras
viktigaste redan kända fakta utan att öppna varje rad eller rulla genom hela
sidan. Mobilen behåller en lugn lista-/detaljväxling med stora tryckytor;
den behöver inte visa samma antal fält samtidigt.

## Avgränsning

- Använd endast fält som redan finns i den validerade `/manage`-projektionen:
  namn/klubb, klass, bricka, fri/minutstart, resultats färskhet och redan
  befintliga varningsmarkörer. Hitta inte på start-/skog-/betalstatus.
- Förtäta rad och vald deltagares sammanfattning vid cirka 900 och 1280 px.
  Lägg personens fakta och aktuella resultat före åtgärdsväljaren; gruppera
  sekundära resultatbeslut så att tretton knappar inte måste läsas först.
  Behåll sortering/sökning, tillgängliga rubriker, tangentbordsfokus och
  läsbara varningar; låt inte en extra kolumn göra mobilvyn smalare.
- Återanvänd samma data och handlingar. Inga nya API:er, migreringar,
  behörigheter, resultaträttningar eller kopior av MeOS gränssnitt.

## Minsta acceptans

Med syntetiskt deltagarunderlag syns status, sökning, minst fem rader och
vald deltagares viktigaste fakta inom ett 1280×800-fönster utan helsides-
scroll för grundöverblicken. Vid 900 px syns lista och detalj samtidigt utan
horisontell sidscroll; vid 390 px kan listan och detaljen läsas var för sig
med minst 44 px primära tryckytor. Testa ett valt äldre resultat och en
saknad bricka, så att tätare layout inte döljer varningarna. Ett fokuserat
browserprov, riktad lint/typecheck och webbuild räcker.

## Ingår inte

Ny tabellredigering, stafett/gaffling, nya datakällor, nytt kontoflöde,
fysisk mobilacceptans eller en generell UX-ombyggnad.

## Slutkontroll

Samma utökade task-167-payment-filter-browserfall: **1/1 passerade, 36,0 s,
exit 0**, 390/900/1280 px. Varning för äldre resultat och saknad aktiv bricka
finns kvar. Inget horisontellt sidöverflöde, sida-vid-sida på 900 px, minst
44 px mobilnavigation. Ingen PostgreSQL eller fysisk mobil användes.
Se [TASK187](TASK_187_COMPACT_COMPETITION_WORKSPACE.md) för kommandon,
lint/typecheck/build, mätningar och avgränsning.
