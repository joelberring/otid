# TASK218: sju synliga förberedelseval på två mobilrader

Status: Genomförd och syntetiskt UI-verifierad, 2026-09-27.

## Användarutfall

Arrangören ska direkt se alla sju delar som behövs före tävlingen –
Upplägg, Banor, Klasser, Deltagare, Lottning & starttider, Startlista och
Funktionärer – utan att en fyra rader hög knappmatta skjuter själva
arbetsinnehållet långt ned på mobil. Alla delar ska vara ett tryck bort.

## Beslut och gräns

På högst 720 px läggs de fyra första grundområdena på rad ett och de tre
följande start-/driftområdena på rad två. Mobiltexten för Lottning &
starttider kortas till ”Lottning & tider”; knappens tillgängliga namn och
desktoptext förblir fullständiga. De övriga mobilnamnen behålls. Varje
knapp är minst 44 px hög, synligt vald, tangentbordsfokuserbar och låst
under befintlig olöst granskning. Inga val göms bakom en dropdown eller
horisontell chipscroll; all sju ska gå att överblicka direkt. Vid mycket
smal bredd får text radbrytas inne i knappen, aldrig ge sidspill.

Endast presentationen av befintliga `preparationArea` ändras. Padda/dator,
Under-flikar, datahämtning, mutationer, behörighet, domän och teknikval
ändras inte; ingen ADR krävs. Syntetisk UI-acceptans är inte bevis på
verklig operatörsanvändning.

## Riktad acceptans

Återanvänd TASK167:s enda syntetiska browserfall: vid 390 px finns exakt
sju knappar i beslutad ordning på två rader (4+3), med minst 44 px höjd,
fullständiga tillgängliga namn och inget horisontellt sidspill. Varje val
öppnar rätt befintligt arbetsområde; valt läge och spärr under olöst
granskning ska vara oförändrade. Första Före-innehållet ska börja minst
cirka 70 px tidigare än tidigare syntetisk 390 px-bild (~y620). Kontrollera
även 320 px mot sidspill och bibehåll 900/1280 px desktop-/paddlayout.
Riktad webblint/typecheck/build och samma browserfall efter sista ändring,
inga nya suite/databastester.

## Utfall och verifiering

De sju knapparna visas 4+3 vid 390 px med fullständiga tillgängliga namn;
Lottning & tider är enbart synlig mobilförkortning. Det enda återanvända
browserfallet kontrollerade två rader, minst 44 px, samtliga sju områden,
320 px utan sidspill och att första innehållsrubriken börjar före y=550.
Slutlig syntetisk Playwright **1/1, exit 0**. E2E-TypeScript och ESLint
**exit 0**; webblint/typecheck/build **exit 0**. 390/900/1280 px-bilder
granskades. Ingen fysisk mobil eller riktig tävling provades.
