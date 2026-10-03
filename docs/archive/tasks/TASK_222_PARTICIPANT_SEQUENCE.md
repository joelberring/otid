# TASK222: föregående och nästa deltagare i aktuellt urval

Status: Genomförd och syntetiskt UI-verifierad, 2026-09-27.

## Användarutfall

Mål- och tävlingspersonal ska kunna gå igenom flera deltagare i ett
sökt/filtrerat urval utan att växla tillbaka till tabellen mellan varje
person. I personens arbetsvy visas position i just aktuellt urval och
kompakta knappar för föregående/nästa. Det fungerar över tabellens
sidgränser och på mobil, padda och dator.

## Gräns och sanningsvillkor

Återanvänd den befintliga `filtered`-ordningen, personvalet `select`,
sidstorlek, `workflowLocked` och mobilens LIST/WORK-läge. Navigeringen får
inte rensa eller ändra sökord, klass, resultat-, betalnings-, hyrbricks-,
äldre-resultat- eller saknad-starttid-filter, eller byta sortering.
Den får inte hoppa till en person utanför aktuellt urval. När vald person
inte längre ingår i urvalet visas det uttryckligt; föregående/nästa är
spärrade tills användaren väljer en synlig person eller använder befintlig
knapp för att visa vald och rensa filter. Vid första/sista personen är
respektive knapp spärrad. Byte över sidgräns håller tabellens sida i synk
med vald person utan att tvinga mobilens arbetsvy tillbaka till listan.

Låt befintlig `select` fortsätta avgöra vilken detaljläsning som behövs.
Inga globala piltangentsgenvägar som kan störa formulär, inga mutationer,
nya API:er, nya rättigheter, domänregler eller migrationer. Svensk text i
befintlig i18n-fil. Neutral, tät rad nära personfakta; minst 44 px
tryckmål och ingen stor ny kortyta. Ingen ADR behövs eftersom teknikval
och domängränser är oförändrade.

## Riktad acceptans

Utöka det befintliga syntetiska `/manage`-browserfallet med ett
flerpersonsfilter och liten sidstorlek: position, föregående/nästa,
sidgräns, bevarat filter, mobil WORK och avsaknad av sidspill. Kontrollera
utanför-filter-läget och spärr vid pågående granskning. Riktad webblint,
typecheck och build. Inga nya PostgreSQL-/hardware-/stora testsviter.

## Utfall och verifiering

En tunn navigeringsrad över personfakta visar position i just det
filtrerade urvalet. Föregående/Nästa använder samma ordning som tabellen,
byter tabellsida vid gränsen och lämnar mobilens arbetsvy kvar. Första/
sista person samt vald person utanför urvalet spärrar relevant knapp;
utanför-läget förklaras i text. Befintliga filter och sortering ändras
inte. Pågående granskning spärrar båda knapparna. Ingen ny kortyta,
backend, rättighet, mutation eller global tangentgenväg har tillkommit.

Riktade slutkontroller: webblint **exit 0**, web-typecheck **exit 0**,
web-build **exit 0**, E2E-TypeScript/ESLint **exit 0**, syntetiskt
Playwright **2/2, exit 0**. Browserfallet omfattar klassfilter med 30
personer, sidgräns 25→26, bevarat filter och WORK-läge vid 390 px,
första/sista, utanför-urval, låst granskning, minst 44 px och inget
sidspill. Mobil- och 1280 px-bilder granskades. Första browserkörningen
gav 1/2 på en äldre strukturell assertion som inte namngav den nya
navigeringsraden; assertionen uppdaterades och slutkörningen passerade.
Ingen fysisk mobil, verklig databas eller fältacceptans ingick.
