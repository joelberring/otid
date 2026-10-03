# TASK200: tätare men begripliga deltagarfilter

Status: genomfört och riktat verifierat 2026-09-27.

## Användarutfall och gräns

I `/manage` vid 900 px tar tre kombinerbara deltagarfilter tre egna rader
ovanför tabellen. På dator/padda kan deras synliga ordalydelse kortas till
”Endast äldre resultat”, ”Ej återlämnade hyrbrickor” och ”Betalning att
kontrollera”, var och en med det faktiska antalet. Högst två rader ska
behövas vid 900 px och en när 1280 px ger plats. Mobil behåller de
fullständiga formuleringarna och sina stora tryckytor. Oförändrade fulla
tillgängliga namn börjar eller innehåller den synliga etiketten i samma
ordning; filtrens kombinationslogik, nolltal och tomträff är orörda.

Endast svensk presentationssträng, synliga/semantiska etiketter och lokal
CSS i `/manage` ändras. Inga data, API:er, behörigheter, resultatregler,
teknikval eller domängränser ändras; ingen ADR behövs. MeOS är endast
beteendereferens för överblick.

## Kontroll

Det återanvända syntetiska browserfallet passerade **1/1** vid
390/900/1280 px. Det kontrollerade full mobiltext och minst 44 px mobil
etiketthöjd, kort synlig dator-/paddtext men oförändrat tillgängligt namn,
två filterrader vid 900 px och en vid 1280 px, positivt antal och nolltal,
befintlig kryss-/tomträffsfunktion samt inget horisontellt sidspill.
900px- och mobilbilder granskades. Browserharnessens TypeScript/ESLint och
web lint/typecheck/build gav slutligen **exit 0**. Ingen stor suite/databas
användes.

Ett första utökat browserprov mätte 1280px-geometrin omedelbart efter ett
asynkront personval och föll på en tillfällig radbrytning. Mätningen väntar
nu på stabil layout och passerar. En första web-typecheck gav exit 2 eftersom
antal kan vara `undefined` innan underlaget laddats; de korta
översättningarna hanterar nu detta liksom de fulla, och slutlig typecheck
gav exit 0.

Antagande: fulltextetiketter på mobil och fullständiga tillgängliga namn är
begripliga också med andra skärmläsare och fysisk touch; dessa har inte
handhavandetestats. Vid stark textzoom får filtren brytas i fler rader.
