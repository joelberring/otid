# TASK239: användbar zoom på publicerad deltagarrutt

Status: implementerad och syntetiskt browser-verifierad 2026-09-27.

## Användarutfall

En besökare på mobil ska kunna granska en redan publicerad deltagarrutts
kontroller och kartdetaljer utan att hela kartan måste förbli nedskalad
till 320–390 px. Samma rutt, kontrollordning och eventuell
uppspelningsmarkör måste ligga kvar på exakt samma pixelkoordinater.

## Avgränsat UI-beslut före implementation

Lägg en fokuserbar, namngiven visningsyta runt hela befintliga SVG:n.
Startläget visar hela kartan i tillgänglig bredd. Synliga svenska
knappar zoomar in/ut inom 1×–4× och återställer helkartan; aktuell
förstoring visas som text. Förstora SVG:ns **layoutmått**, inte bara en
visuell CSS-transform, så att visningsytans verkliga scrollmått växer.
Telefonens vanliga svepning och tangentbordets piltangenter ska kunna
panorera den förstorade kartan utan att fånga sidans vanliga scrollning
i helkartsläget. Bevara kartans synliga centrum när zoomnivån ändras.
Vid utskrift ska kartan passa sidan oavsett skärmzoom.

Kontrollerna ska vara minst 44 px och ha text/åtkomliga namn, fokus ska
synas, och zoomstatus får inte bäras av färg ensam. Håll verktygsraden
kompakt och neutral enligt TASK236–238. Återanvänd inte den äldre
publika kartvisarens obundna pointer-transform eller `touch-action:none`.
Ingen ny dependency behövs.

Ruttens `<image>`, röda `<path>`, kontrollringar/koder och
uppspelningsmarkör stannar i samma SVG och `viewBox`; ändra inte
pixelprojektion, GPX-tid, playback, publicerings-/samtyckesgrind,
datakontrakt, API eller privata kartor. Ingen ADR behövs eftersom detta
är en sidlokal visningsinteraktion utan domän-/teknikbyte.

## Riktad acceptans

Med syntetiskt publicerat ruttunderlag: vid 320/390/1280 px är 1× helt
synlig utan horisontell sidspill; zoom till 2×/4× ger verkligt större
scrollbar karta och fortsatt samstämmiga route/control/marker-lager.
Zoom ut/återställ visar helkartan igen. Centrum bibehålls inom rimlig
scrollklampning. Mobil svepning och tangentbord fungerar; knapparnas
spärrlägen och text är begripliga. 404/otillgänglig rutt visar inte
zoomverktyg eller karta. Utskrift klipper inte en inzoomad karta.
Riktad lint/typecheck, ett litet interaktionsprov och build räcker;
ingen DB-/full E2E-svit utan isolerad PostgreSQL.

## Ingår inte

Ny karta, pinch-gest, offlinekartcache, GPS-live, tidsuppspelning mot
kontrollpassager, ny ruttanalys eller fältverifiering på fysisk telefon.

## Utfall

Den befintliga kart-SVG:n ligger nu i en namngiven, fokuserbar visningsyta.
Tre kompakta knappar ger 1×–4× i halva steg, synlig procent, återställning
och spärrlägen. SVG:ns faktiska layoutbredd växer, så vanlig overflow ger
panorering med svep/mus och piltangenter; vid helkarta fångas inte pilarna.
Zoom bevarar synligt centrum inom scrollgränserna. Samma bild, rutt,
kontroller och uppspelningsmarkör delar fortsatt samma viewBox. Print
återställer presentationsbredden utan att ändra skärmens zoomtillstånd.
Otillgänglig rutt får inga zoomverktyg. Ingen datamodell, publiceringsgrind,
dependency, domänregel eller ADR ändrades.

Efter sista produktkodändringen: webblint **exit 0**, webb-TypeScript
**exit 0**, kontextkomponentprov **2/2, exit 0**, browserhärvans
TypeScript och ESLint inklusive komponentfixtur **exit 0**, syntetiskt
Playwright med riktig monterad ruttkomponent **3/3, exit 0** vid
320/390/1280 px; hela återanvända visuella sviten **6/6, exit 0**.
Checkin-förberedelse och Next-produktionsbuild gav **exit 0**. Ett första
direktanrop till Next-build utan paketets normala `npm_lifecycle_event=build`
gav **exit 1** när `DATABASE_URL` saknades vid route-import; omkörning med
byggmarkören gav exit 0 utan databasanslutning. Browserfixturen fick en
syntetisk loopback-origin efter att `about:blank` gav fel för relativ fetch;
slutkörningen passerade. Skärmbilder vid tre bredder granskades.

Beviset använder syntetiskt HTTP-svar och karta, inte Next-server,
PostgreSQL eller faktisk publicerings-/samtyckesgrind. Native touch-svep,
skärmläsare, fysisk mobil och kartprecision är inte fältverifierade.
