# TASK216: avgränsad klassledarbild i administratörens speakerläge

Status: implementerad och syntetiskt verifierad 2026-09-27.

## Användarutfall

I den kompakta speakerfliken kan administratören på begäran se vilka som
leder publicerade klasser och deras sluttider. Vyn skiljer denna tidsmärkta
publika klassbild från de 25 senaste privata resultatunderlagen. Ett fel,
gammalt underlag eller avsaknad av rankbar ledare syns i text, inte bara färg.

## Ägare och avgränsning

Endast administratörens inbäddade `race-workspace-speaker` med svensk text,
scopad CSS och en liten ren härledning från befintligt publikt format 7.
Ingen ändring av `speaker-board`-kontraktet, domänrankningen, serverroute,
databas, separat speakerinloggning eller femsekunderspollning. Båda svaren
hålls åtskilda. Flera delade ettor ska visas; `MIXED_COURSE_VERSIONS`,
orankade statuser och annat format får inte ge ledarindikering.

## Acceptans

- Ingen extra automatisk begäran om hela resultatlistan. Ett tryck hämtar
  publikt format 7 för exakt aktuellt lopp med timeout, abort och race-byte-
  skydd; nästa tryck får uppdatera.
- Endast verifierade rankade ettor har tydlig text ”Ledare” och diskret
  signalfärg. Hela panelen är märkt som separat publikt underlag med
  mottagningstid/cachevarning. Feedrader får ingen påstådd placering.
- Kompakt desktop/tabell och läsbar mobil utan horisontell sidscroll.
- Riktad härledningstest, webblint/typecheck/build och ett syntetiskt
  browserprov. Ingen riktig tävling, PostgreSQL eller fysisk enhet i detta
  snitt; redovisa dem som kvarvarande antaganden.

## Ingår inte

Live-passage, radio, ljud, automatisk ledarpollning, resultat-ID-matchning
mot privata rader, ny speakerbehörighet eller en fullständig klasslista.

## Verifierat utfall

Panelen ligger före den upp till 25 rader långa feeden, använder en liten
grön textbunden ledarsignal endast för rankade ettor och visar separat
mottagningstid/cachevarning. Mobil har kompakta rader, desktop tät tabell.
Den offentliga resultatlistan hämtas inte automatiskt; den privata
femsekunderspollningen är oförändrad. Inga server- eller kontraktsfiler,
databasscheman eller resultatregler ändrades.

Riktad webblint **exit 0**, web-typecheck **exit 0**, helper-Vitest
**1/1 passerat, exit 0**, e2e-TypeScript **exit 0**, e2e-ESLint **exit 0**,
syntetiskt Playwright **1/1 passerat, exit 0** och web-build **exit 0**.
Playwright bekräftade manuell hämtning, delad ledning, frånvaro av falsk
ledning för en trea/MP, signaltext/-färg, prioriterad mobilordning och inget
horisontellt sidspill vid 390/1280 px. Skärmbilder granskades. Första
Playwrightstarten nekades lokal port av sandbox (`EPERM`, exit 1); den
godkända omkörningen och slutkörningen passerade.

Antaganden/kvar: befintlig publik format-7-projektion och klassrankning
måste vara korrekt och tillgänglig; ingen ny PostgreSQL- eller lastacceptans
har gjorts. Webbläsarens mottagningstid är inte serverns beräkningstid och
kan omfatta publik cache. Uppdatering är manuell, inte live. Fysisk mobil,
stor tävling och verklig speakerdag är inte provade.
