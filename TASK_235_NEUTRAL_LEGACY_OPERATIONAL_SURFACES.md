# TASK235: neutrala äldre tävlingsytor

Status: klar 2026-09-27.

## Användarutfall

Det administrativa utseendet ska vara lugnt, med en textstorlek och
avdelarrytm närmare den redan neutrala `/manage`-ytan. Färg ska användas
sparsamt för verkliga avvikelser och verifierade ledarsignaler, inte för
vanliga arbetslänkar eller varannan tabellrad.

## Avgränsning och beslut före kodändring

TASK215/219/220/223 har redan gjort `/manage`, arrangörsstartsidan och
separat speakerläge neutrala. TASK235 ändrar därför endast kvarvarande
gröna normalmarkeringar i den äldre läsande tävlingsöversikten och
startlistans skärmvisning. Använd sidlokal CSS i befintlig
`apps/web/src/app/globals.css`: neutrala ytor, grå arbetslänkar och
kompakta tabellavdelare. Bevara utskriftens tydlighet och minst 44 px
tryckmål på mobil.

Ändra **inte** globala färgvariabler, kart-/ruttfärger, resultatstatusar,
varningar för saknad information, MP/DSQ eller speakerlägets verifierade
ledartider. Ingen domän-, API-, behörighets- eller teknikändring; ingen ADR.

## Riktad acceptans

Kontrollera 390 och 1280 px att äldre översikt och startlista inte har
stora gröna normala handlingsytor/tabellband, att skärm och utskrift inte
får sidspill, och att varningstext/färg finns kvar. Återanvänd befintliga
syntetiska UI-prov och web lint/typecheck/build; inga riktiga tävlingar.

## Utfall

Sidlokal CSS ger nu den äldre tävlingsöversikten och startlistan samma
ljusa/grafitgrå normalpalett som `/manage`. Gröna vardagslänkar,
primärlänkar och grönstrimmiga tabellrader är neutrala; de definierade
gula/röda avvikelsesignalernas regler, kart-/ruttfärger och speakerledare
har inte ändrats. Skärmspecifika regler lämnar utskriftens vita läge kvar.

Syntetisk browserkontroll passerade **2/2, exit 0** för läsande
tävlingsöversikt (390/1366 px), **1/1, exit 0** för publik startlista
(390/700/768/1366 px) och **2/2, exit 0** för privat startlista inklusive
utskriftsmedia (390/1366 px). Skärmbilderna granskades; inget horisontellt
sidspill. Översiktsprovets gamla antagande om 29 länkar uppdaterades till
31, med explicita kontroller av de redan befintliga `Mina tävlingar` och
`Arbetsyta`-vägarna; första körningen misslyckades endast på detta
föråldrade antal. Riktig tävling, fysisk utskriftsenhet och faktisk speakerdrift
ingick inte i detta visuella snitt.
