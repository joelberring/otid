# TASK236: tät och neutral publik resultatlista

Status: implementerad och syntetiskt verifierad 2026-09-27.

## Användarutfall

En oinloggad eller inloggad deltagare ska snabbt kunna läsa resultat på
mobil och dator utan att vanliga länkar, knappar och stora kort konkurrerar
med tävlingsinformationen. Listan ska fortfarande fungera utan inloggning.

## Avgränsat UI-beslut före implementation

`/results/[raceId]` får en sidlokal ljus/grå normalpalett och en enhetlig,
kompakt textskala. Ordinarie navigation, rubrik, filter, jämförelseval och
tabellavdelare ska vara lågmälda. Vid högst 640 px ersätts de nuvarande
inramade korten per resultat med täta, avdelade rader: klass/placering,
deltagare/klubb, status/tid/efter och befintliga detaljåtgärder. Tydliga
etiketter ska finnas där siffror annars blir tvetydiga. Inga data, funktioner
eller tryckmål tas bort; interaktiva mobilmål förblir minst 44 px.

Endast resultatlistans sida och dess CSS/markup får ändras. Ändra inte
globala färgvariabler, andra publika sidor, resultatrangordning eller
statussemantik. Bevara röda MP/DSQ, gul/brun avbrutet/ej start och en
diskret grön OK-signal med text; bevara blå fokus och jämförelserutternas
tre distinkta färger. Varning om blandade banversioner, fel vid uppdatering,
följ/favorit och print-media ska fortfarande fungera. Ingen ADR behövs då
domän, API, behörighet och teknikval är oförändrade.

## Riktad acceptans

Använd ett syntetiskt resultatunderlag för att granska 320/390/1280 px:
ingen horisontell sidspill, status och tid läsbara, MP/DSQ och saknad data
inte enbart färg, mobilen utan separata stora resultatkort, ordinarie
knappar neutrala och minst 44 px. Prova print-layouten oförändrad. Riktad
webblint/typecheck, komponentprov och build; ett syntetiskt browserfall
för visuell CSS räcker. Kör inte DB- eller full E2E-svit utan uttryckligt
isolerad testdatabas. Fysisk användbarhet återstår.

## Utfall

`/results/[raceId]` har nu sidlokal neutral krom, tätare rubrik, filter,
jämförelsefält och desktop-tabell. Vid högst 640 px visas resultat som
avdelade rader utan stora kort. Deltagarlänk, klubb, klass, placering,
status, tid, eftertid, sträcktider, favorit och ruttjämförelse finns kvar.
Status har fortsatt text och separat signalfärg; tangentbordsfokus,
rutternas jämförelsefärger och print-regler ändrades inte. Ingen domän- eller
API-regel ändrades; därför skapades ingen ADR.

Efter sista kodändringen: webb-ESLint **exit 0**, webb-TypeScript **exit 0**,
komponentprov **11/11, exit 0**, browserprovets TypeScript och ESLint
**exit 0**, syntetiskt Playwright/CSS-prov **1/1, exit 0** vid 320/390/1280
px inklusive print-media, checkin-förberedelse **exit 0** och Next
produktionsbuild **exit 0**. Skärmbilderna granskades vid alla tre bredderna.
Den första buildinvokationen använde fel binärsökväg (**exit 127**); den
korrekta lokala Next-binären byggde utan fel.

Browserprovet är avsiktligt en CSS-fixture med syntetiskt innehåll som
speglar resultatraderna, inte ett hydratiserat Next-flöde. Befintligt
komponentprov kontrollerar den verkliga React-strukturen och handlingarna.
Ingen isolerad PostgreSQL-adress var tillgänglig, så serverberoende
resultat-E2E kördes inte. Fysisk mobil, skärmläsare och verklig
deltagar-/speakeracceptans återstår; detta är inte en fullständig
produktacceptans.
