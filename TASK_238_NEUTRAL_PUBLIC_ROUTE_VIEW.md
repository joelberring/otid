# TASK238: neutral och tät publik ruttvy

Status: implementerad och syntetiskt verifierad 2026-09-27.

## Användarutfall

En deltagare eller besökare som går från det publika resultatet till en
publicerad rutt ska se samma lugna och informationsordnade sida som i
TASK236–237. Personen, tävlingen, ruttens begränsningar och kartan ska
kunna läsas utan stor mörk sidkrom och fyra inramade metadatakort.

## Avgränsat UI-beslut före implementation

Ändra endast den publika deltagarruttens sida och sidomärkt CSS. Använd
en neutral ljus/grå normalpalett och en konsekvent kompakt textskala.
Avstånd, punkter, segment och GPX-tid blir en delad faktarad/grid med
tunna avdelare i stället för fyra kort. Den villkorliga GPX-uppspelningen
får en lågmäld avdelning, med tydlig play/paus, återstart, aktuell tid och
tidsaxel. Notisen att rutten inte är GPS-verifierad ska förbli synlig med
text och en liten varningssignal. Karta, ruttlinjens röda färg,
kontrollringar/koder, uppspelningsmarkör och tangentbordsfokus behåller
sin särskilda läsbarhet. Tillbakalänk och kopiera/dela-länk ska ha minst
44 px interaktivt mål.

Ingen förändring av ruttens hämtning, release- eller samtyckesgräns,
GPX-tolkning, projektion, uppspelningslogik, kontrollgeometri, API,
domän eller andra kart-/resultatvyer. Inga globala färgvariabler eller
typsnitt ändras. Ingen ADR behövs eftersom teknikval och domängräns är
oförändrade.

## Riktad acceptans

Syntetiskt ruttunderlag vid 320/390/1280 px: ingen sidspill, metadata
kompakt och läsbar, kartans bredd följer ytan, varningen syns med text,
uppspelningskontrollerna är minst 44 px och rutt/kontrollfärgerna finns
kvar. Utan tidsdata visas inte uppspelning. Riktad webblint/typecheck,
relevant komponentprov, ett litet syntetiskt browserprov och build.
Ingen DB-/full E2E-svit utan uttryckligen isolerad PostgreSQL.

## Ingår inte

Ny GPS-inspelning, liveposition, ny kartprojektion, ruttjämförelse,
tid mot tävlingskontroller, fysisk mobil- eller tävlingsacceptans.

## Utfall

Den publika ruttvyn har sidlokal neutral krom och tätare hierarki.
Fyra metadatafakta visas i en delad grid i stället för kort. Den
obekräftade GPS-statusen har kvar sin exakta text och en smal ambermarkering;
villkorlig GPX-uppspelning är en avdelad yta utan stor ram. Befintliga
dela-/uppspelningshandlingar har minst 44 px tryckmål. Ruttlinje,
kontrollringar, kontrollkoder och markör har inte ändrat datakälla eller
semantik. På smal skärm förstoras endast kontrollmarkörernas visuella
storlek så koderna inte blir oläsliga när hela SVG:n skalas ned.

Efter sista kodändringen: webblint **exit 0**, webb-TypeScript **exit 0**,
befintligt kontextkomponentprov **2/2, exit 0**, browserprovets
TypeScript och ESLint **exit 0**, tre små syntetiska CSS-browserfall
för resultatlista/detalj/rutt **3/3, exit 0** vid 320/390/1280 px,
checkin-förberedelse **exit 0** och Next-produktionsbuild **exit 0**.
Skärmbilderna granskades vid alla tre bredderna. Den första bilden visade
för liten kontrollkod vid 320 px; en sidlokal mobiljustering gjordes och
browserprovet kompletterades med ett minsta visuellt mått innan omkörning.

Browserprovet är en CSS-fixture med syntetisk karta, inte hydratiserad
Next eller serverns exakta publiceringsgrind. De befintliga kodvillkoren
för att utelämna uppspelning utan GPX-tid är oförändrade, men testades
inte genomgående här. Ingen isolerad PostgreSQL användes. Faktisk
kartprecision, zoom/läsbarhet i detalj, skärmläsare och fysisk mobil
återstår; en hel karta nedskalad till 320 px ersätter inte zoom.
