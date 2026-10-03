# TASK232: bevara banvarningens sammanhang på vald klassrad

Status: implementerad och syntetiskt UI-verifierad 2026-09-27.

## Användarutfall

När funktionären öppnat en klass från banvarningen ska orsaken vara
begriplig i klassvyn och det ska finnas en enkel väg tillbaka till
`Banor`. Sammanhanget ska ta liten plats på både mobil och dator.

## Avgränsning

Använd enbart TASK231:s befintliga klientval av exakt klass-ID. Visa
en kort svensk rad intill klassöversikten, inte en ny stor panel:
vilken klassrad som öppnades, att dess tilldelade banversion **saknades
i det lästa banunderlaget när den öppnades**, och en tangentbordsstyrd
återgång till `Banor`. Texten är historisk omständighet, inte ett nytt
aktuellt serverbesked eller bevis att banan saknas i databasen.
Återgången ska endast navigera i UI, vara spärrad när arbetsflödet är
låst och ge begriplig fokuslandning. Nytt hämtat deltagarunderlag ska
rensa det tillfälliga sammanhanget så att det inte hänger kvar som en
gammal status. Direkt öppnad `Klasser` utan varningsval ska inte visa
sammanhanget. Behåll sökbar tabell, neutral färgskala, liten typografi
och minst 44 px mobilmål. Ingen API-, domän-, databas- eller
behörighetsändring; ingen ADR krävs.

## Riktad acceptans

Utöka samma syntetiska browserfall från TASK231. Efter val av vardera
dublett ska rätt klassrad och den tidsbundna orsaken visas, återgången
ska gå till `Banor` via både klick och tangentbord, och vanlig
`Klasser` utan val ska inte visa notisen. Efter `Uppdatera underlag`
ska notisen inte finnas kvar. Kontrollera 390/1280 px utan sidspill,
inga råa UUID:n och att ingen skrivbegäran sker. En riktad browserkörning
och berörd lint/typecheck/build räcker.

## Utfall

Den valda klassvyn visar en tunn kontextrad med klassradens nummer
och formuleringen att banversionen saknades i det lästa underlaget
**när klassen öppnades**. `Tillbaka till Banor` går till rätt flik
och fokuserar den. Vid nytt accepterat deltagarunderlag rensas
valet och notisen; direktingång till `Klasser` har ingen sådan notis.
Ingen granskning eller skrivåtgärd startas.

Webblint/typecheck/build, E2E-TypeScript/ESLint och checkin-
förberedelse gav **exit 0** med installerade lokala verktyg. Det
återanvända syntetiska Playwright-fallet passerade **1/1, exit 0**:
två likalydande klassrader, klick/Enter-återgång med fokus, rensning
vid uppdaterat underlag, frånvaro vid direktingång, inga skrivbegäranden
eller råa UUID:n och inget sidspill vid 390/1280 px. Bilderna
granskades; notisen blev en låg rad på dator och två korta rader plus
återlänk på mobil. Ingen verklig tävling, fysisk mobil, databasändring
eller funktionärsacceptans ingick. `pnpm`-wrappern försökte starta en
installation i denna miljö; kontrollerna kördes därför med de redan
installerade lokala binärerna.
