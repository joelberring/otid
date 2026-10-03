# ADR-0131: publik jämförelse av exakt två historiskt lika rutter

- Status: Accepterad, implementerad i TASK121
- Datum: 2026-09-21

## Kontext

TASK117–120 kan visa en enskild samtyckt och explicit släppt rutt med korrekt
historisk bana. Att lägga två godtyckliga rutter ovanpå varandra kan dock
förväxla karta, kalibrering eller bana och skulle då vara missvisande även om
båda var och en är publicerade på ett korrekt sätt.

## Beslut

TASK121 får införa en skrivfri publik jämförelse av exakt två olika
`publicResultId` inom samma lopp. Varje sida ska först uppfylla hela TASK120:s
grind: aktiv publik resultatrevision, aktivt samtycke, aktiv route-release,
aktiv kartrelease, exakt route-/karthash, georeferens, komplett historisk
kontrollgeometri och in-bounds pixelpunkter.

Utöver detta krävs för jämförelse att båda sidor har samma exakta
`mapManifestId`, `georeferenceId` och historiska `courseVersionId`. Minsta
avvikelse – även samma resultat-id två gånger – ger `not-found`. Systemet får
aldrig välja aktuell klassbana, senaste karta/georeferens eller en delvis
matchande rutt.

Det publika svaret lämnar bara två pixelbanor med redan härledd metadata och
delade kontrollmarkörer. Det får inte innehålla interna identiteter, hashar,
WGS84, objektlageruppgifter eller teknik för tidslinjering. En lokal väljare i
den befintliga resultatlistan får enbart navigera till jämförelsevyn; den
skapar ingen publication, consent eller lagrad favorit.

## Konsekvenser

Detta ger den första verkliga jämförelsen efter tävling utan att påstå
tidssynk, gemensam start, passagetider, tempo, höjd eller GPS-verifiering.
Fler än två rutter, uppspelning, analys, FIT/TCX, OMAP och mobilinspelning
kräver separata beslut.
