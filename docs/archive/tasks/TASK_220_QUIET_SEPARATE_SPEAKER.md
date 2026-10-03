# TASK220: neutral och tät separat speakerarbetsyta

Status: Genomförd och syntetiskt UI-verifierad, 2026-09-27.

## Användarutfall

En speaker med separat läsbehörighet ska kunna överblicka de senaste
publicerade resultatuppdateringarna utan stora kort, skrikig grön sidkrom
eller onödig scroll. På dator/padda ska namn, klass, resultat, tid,
registrering och revision vara snabbt jämförbara rad för rad. Mobil ska
behålla samma fakta i kompakt, lättavläst ordning och minst 44 px tryckmål.

## Design och gräns

Begränsa utseendet till `/admin/[raceId]/speaker`. Använd den neutrala
ljus/grå adminskalan från TASK215/219, med jämn typografi, tunna dividerare
och blå synlig fokusmarkering. Behåll titel, tillbakalänk, nätuppgift,
sessions-/feltext och den kollapsbara förklaringen. Listan blir ett
tabellikt, rubrikmärkt radmönster på större skärmar och kompakta dividerade
rader på mobil; ingen ordningsnumrering som kan misstolkas som placering.

Rött reserveras för effektiva MP/DSQ. Gult markerar gammalt underlag och
frånkopplat nät som skilda, textförklarade tillstånd. OK, DNS, DNF, OOC,
NT och inget aktivt resultat är neutrala; ingen ledare eller placering
härleds från de 25 senaste resultathuvudena. Det exakta läsögonblicket,
tidszonen, tävlingsversionen, vald/effektiv revision och urvalets
begränsning måste vara synliga/läsbara även efter förtätning.

Inga ändringar i auth, cookie, polling, pagehide/bfcache, API, domän,
offlineanspråk eller globala styles. Separat speakervy är endast privat
läsning; sista visade data i minnet med stale-varning är inte stationens
offlinekö. Ingen ADR behövs eftersom teknik och domängränser är oförändrade.

## Riktad acceptans

Återanvänd befintligt rapportenhetstest. Lägg ett enda syntetiskt
browserfall utan databas till befintlig lätt UI-konfiguration, med 390,
900 och 1280 px, 25 syntetiska rader och en MP-rad. Kontrollera högst
25-radersurvalets oförändrade text, neutral bas, röd MP med text, tydlig
stale/offline, inget sidspill, minst 44 px kontroller och faktiskt tät
desktoprad. Riktad webblint/typecheck/build; kör inte TASK008:s hela
PostgreSQL-/produktionssvit för detta CSS-/presentationssnitt.

## Utfall och verifiering

Den separata sidan har nu neutral scoped krom, 48 px kontroller och synlig
blå fokus. Dator/padda visar de sex faktakolumnerna i täta dividerade
rader; mobil visar samma fakta med etiketter i två kolumner utan sidspill.
På desktop är radens etiketter visuellt dolda men kvar för skärmläsare.
Tomt urval visar inte tomma kolumnrubriker, och en tom live-status tar inte
visuell plats. MP/DSQ är röda; nätbortfall och gammalt underlag har varsin
gul, textförklarad signal. Inga leader-/rankpåståenden lades till.

Slutliga riktade kontroller: rapportenhetstest **4/4, exit 0** (första
körningen 2/4 på grund av äldre exakt-HTML-assertioner; dessa anpassades
till oförändrat textinnehåll), webblint/typecheck/build **exit 0**,
E2E-TypeScript/ESLint **exit 0**, syntetiskt Playwright **2/2, exit 0**
inklusive befintligt `/manage`-fall. 390/900/1280 px och offlinebild
granskades. Ingen riktig databas, tävling, credential, fysisk mobil eller
TASK008:s produktions-/säkerhetsregression kördes.
