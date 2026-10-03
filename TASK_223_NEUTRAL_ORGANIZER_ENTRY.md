# TASK223: neutral arrangörsstart utan dekorativa signalfärger

Status: genomfört och syntetiskt UI-verifierat, 2026-09-27.

## Användarutfall

Resan från `/organizer` till tävlingsarbetsytan ska ha samma lugna,
informationstäta visuella grund: ljus neutral duk, grafittext, tunna
avdelare och en jämnare textskala. Vanliga knappar och tävlingsrader
ska inte se ut som varningar eller framgångssignaler. Den befintliga
översikten över tävlingar, administratörer och skapande ska fortsatt
vara direkt synlig och användbar.

## Gräns

Ändra endast arrangörssidans egna CSS-modul. Behåll innehåll, ordning,
API, behörighet, inloggning och all mutationslogik. Återanvänd den
befintliga neutrala adminsammansättningen som färgriktning; kopiera
inte Codex layout eller varumärke. Ingen global tokenändring, eftersom
samma globala gröna variabler även används semantiskt av publik-,
stations- och kartvyer. Ingen ADR behövs: teknik och domängränser
ändras inte.

Varm gul markering ska finnas kvar vid osäker, möjlig upprepning av
en begäran. Verklig bekräftelse får en smal grön statusmarkering,
medan blå tangentbordsfokus förblir tydligt. Tillstånd ska alltid
beskrivas med text och inte enbart färg. 44/48 px tryckmål och
mobilens enkolumnslayout behålls.

## Riktad kontroll

Granska CSS vid mobil/dator, särskilt lång tävlingstext och
osäker/bekräftad begäran. Kör riktad webblint, typecheck och build.
Återanvänd TASK014:s databasfria browserharness med helt avlyssnade
syntetiska API-svar. Inga demo- eller tävlingsdata används. Ingen
fältacceptans påstås.

## Utfall

`/organizer` har nu samma neutrala scoped grund som `/manage`: ljus
sidduk och header, mindre enhetlig typografi, grafitknappar och
dividerade tävlingsrader utan beige kort. Administratörs- och
inbjudningsdelarnas vanliga ytor är neutrala. Osäkert mutationssvar
har kvar text och gul kant/bakgrund; bekräftelse har text och en smal
grön statuskant. Ingen React-, kontrakts- eller serverkod ändrades.

Riktad webblint, web-typecheck och web-build gav **exit 0**. E2E-
TypeScript och riktad ESLint gav **exit 0**. Den byggda utloggade
sidan granskades vid standardbredd och 390 px; eftersom dess verkliga
sessionsanrop kräver `DATABASE_URL` följde ett separat syntetiskt
browserprov. Det provet passerade **2/2, exit 0** vid 390/1280 px med
inloggad tävlingslista, långt namn, tvåkolumns-/enkolumnslayout,
48 px formulärfält, minst 44 px knappar, 0 px sidspill, osäkert
503-svar och bekräftad retry med samma idempotensnyckel. Bilderna
granskades visuellt. Alla `/api/**`-anrop avlyssnades i browsern;
ingen databas, riktig credential, servermutation eller fältacceptans
ingick. Den lokala provservern stoppades.
