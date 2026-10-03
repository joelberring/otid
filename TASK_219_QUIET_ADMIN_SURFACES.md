# TASK219: lugnare administrativ navigering och reserverade signalfärger

Status: Genomförd och syntetiskt UI-verifierad, 2026-09-27.

## Användarutfall

Tävlingens arbetsyta ska upplevas neutral och informationstät i samma anda
som användarens Codex-referens: ljus/grå bas, lågmälda linjer, en konsekvent
system-/Inter-liknande textskala och tydlig hierarki utan att varje knapp
eller rad ser ut som en varning. På mobil ska arbetslägena fortfarande vara
enkla att träffa med minst 44 px höjd. Färg reserveras för verkliga signaler.

## Beslut och gräns

Det befintliga neutrala `/manage`-scopet från TASK215 behålls. Platta till
framför allt mobilens huvud- och undernavigering: avstå från sju separata
kortliknande ramar, visa valt läge med både neutral ton, linje och textvikt.
Lätta enbart de mest framträdande rubrik-/siffervikterna och kortens radier;
bevara den kompakta dator-/paddlayouten, all information och alla tryckmål.
Ta bort kvarvarande dekorativt grönstick i startlistans zebra/hover och
översiktens klasslänk. Behåll blå fokusring och tydlig textmarkering.

Rött används fortsatt för explicit kritisk resultatavvikelse (t.ex. MP/DSQ),
gult för saknad/inaktuell uppgift, och grönt endast för faktisk ledarsignal i
speakerlägets publicerade klassledare. Etiketter, gränslinjer och text ska
fortsätta förklara signalen utan att färg är enda informationsbärare.

Ändra bara CSS i befintlig administrationsyta och direkt underordnade
komponenter. Ingen ändring i `globals.css`, data, mutationer, domän,
behörighet, navigeringsstruktur eller ny teknisk lösning. Därför ingen ADR.
Detta är ett visuellt snitt, inte en omdesign av alla publika/stationsvyer.

## Riktad acceptans

Visuell granskning av den syntetiska `/manage`-vyn vid 390, 900 och 1280 px:
nav synlig/vald, inget sidspill, första innehåll på plats och neutral bas.
Kontrollera speakerläge på mobil så att MP/DSQ, inaktuell feed och riktig
ledartid fortsatt har skilda textstödda signaler. Använd befintliga
syntetiska browserfall, riktad webblint/typecheck/build. Ingen databas,
riktiga tävlingsuppgifter eller bred testsuite behövs.

## Utfall och verifiering

Mobilens huvud- och undernavigering är platta neutrala segment med tunn
avdelare och mörk vald linje. Tävlingsidentitet och mått har något lugnare
typografi utan borttagen information. Speakerfeeden använder dividerade
rader i stället för separata mobilkort. Klasslänk och startlistans zebra/
hover har neutral färg. Blå fokus, gul saknad information, röd MP/DSQ och
grön verifierad ledare behölls. Endast i den separat publicerade
klassledarlistan bär också själva ledarsluttiden samma gröna signal; den
privata 25-radersfeeden får ingen härledd ledarfärg.

Webblint/typecheck/build **exit 0**, E2E-TypeScript/ESLint **exit 0**, och
det återanvända syntetiska browserfallet **1/1, exit 0** efter sista CSS-
ändringen. Mobilbilden för speaker och förberedelser samt 900/1280 px-bilder
granskades. Provets API-svar är syntetiska; ingen fysisk mobil, verklig
tävling eller användbarhetsmätning ingår.
