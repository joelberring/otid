# TASK237: neutral och tät publik deltagardetalj

Status: implementerad och syntetiskt verifierad 2026-09-27.

## Användarutfall

En besökare som öppnar en person från resultatlistan ska känna igen samma
lugna, informationstäta uttryck. Namn, klass, klubb, placering, status,
resultat och sträcktider ska vara lätta att skanna på dator och mobil utan
fyra stora faktakort eller dekorativ grön panel. Publik visning ska
fortfarande fungera utan inloggning.

## Avgränsat UI-beslut före implementation

Ändra endast `/results/[raceId]/participants/[publicResultId]` och dess
sidomärkta CSS samt vid behov små markup-klasser i de redan använda
detalj-/ruttsammanfattningskomponenterna. Sidans huvud, navigering, fakta,
sträcktider och villkorlig publicerad rutt får den neutrala normalpaletten
från TASK236. Fakta visas som en kompakt uppdelad rad/grid i stället för
inramade kort. Status och orsak, saknade/extra kontroller, ruttlänk och
delningstext ska vara synliga enligt samma villkor som nu. Röd MP/DSQ,
gul/brun övrig avvikelse, diskret grön OK, blå fokus och eventuella
ruttfärger har fortsatt textstöd och semantisk betydelse.

Ingen förändring av kontrakt, datahämtning, SSE/poll, ranking, route-release,
behörighet, print-semantik eller andra publika/privata sidor. Ingen ADR
behövs: domängräns och teknikval ändras inte.

## Riktad acceptans

Granska ett syntetiskt OK- och MP-/DSQ-underlag vid 320/390/1280 px:
ingen horisontell spill, inga stora faktakort, status och saknad kontroll
begripliga utan färg, interaktiva länkar/split-disclosure minst 44 px.
Ruttpanelens länk och delning finns kvar när route-release finns; inget
ruttanspråk görs annars. Print behåller alla fakta men ingen navigation.
Riktat komponentprov, webb-lint/typecheck, ett syntetiskt browserprov och
build räcker; ingen DB-svit utan uttryckligen isolerad PostgreSQL.

## Ingår inte

Ruttens fulla kartvy, GPS, ny deltagarprofil, förändrad resultatstatus,
ny personlig identitet eller fältacceptans.

## Utfall

Detaljsidan använder nu sidlokalt neutral krom och ett kompakt rubrikblock.
De fyra resultatfakta ligger i en delad grid utan separata kort; på mobil
visas två kolumner med tunna avdelare. Sträcktiderna är en lågmäld
disclosure och en eventuellt publicerad rutt visas som en neutral
sammanfattning med kvarvarande visa-/delaåtgärder. MP/DSQ och övriga
statussignaler har samma text/semantik som förut. Ingen komponentlogik,
datahämtning, kontrakts- eller domänregel ändrades. Därför skapades ingen ADR.

Det befintliga print-urvalet dolde tidigare även `header` inuti
deltagardetaljen, inklusive namn/klass/klubb. Det är snävat till global
app-header och sidnavigation; deltagarhuvudet visas nu i utskrift.

Efter sista kodändringen: webblint **exit 0**, webb-TypeScript **exit 0**,
komponentprov **12/12, exit 0**, browserprovets TypeScript och ESLint
**exit 0**, syntetiska CSS-browserprov för lista+detalj **2/2, exit 0**
vid 320/390/1280 px inklusive print, checkin-förberedelse **exit 0** och
Next-produktionsbuild **exit 0**. Skärmbilderna granskades vid alla tre
bredderna. Ett första nyinskrivet komponenttest hade fel förväntade
etikettord/HTML-avgränsning (**exit 1** två gånger); det rättades mot
faktiskt renderad svensk text och passerade. En agents första
`pnpm`-kontroll försökte återskapa beroenden och avbröts efter DNS-fel
(**exit 130**); låsta beroenden återställdes från cache (**exit 0**,
noll nedladdningar). En offlineinstallation hade dessförinnan visat
saknad tarboll (**exit 1**). Ingen lockfil eller teknikstack ändrades.

Browserproven är avsiktligt CSS-fixtures med syntetiska resultat och
verifierar inte hydratiserad Next, serveranslutning eller verklig data.
Den faktiska React-detaljen täcks av komponentprovet. Isolerad
PostgreSQL-adress saknades; serverberoende E2E kördes inte. Fysisk mobil,
skärmläsare och verklig deltagaracceptans återstår.
