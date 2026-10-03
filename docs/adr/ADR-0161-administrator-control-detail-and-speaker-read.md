# ADR-0161: kontrolluppgifter och speaker i administratörens arbetsyta

Status: accepterad för TASK185, 2026-09-24. Skriven före implementation.

## Behov och beslut

Tävlingsadministratören behöver se vald persons kontrollföljd och lagrade
kontrolltider samt kunna använda en speakerflik utan en andra inloggning.
ADR-0074:s befintliga `MANAGE_RACE`-resultatläsning är för smal. Detta ADR
kompletterar dess projektion och ADR-0058:s speakergräns; inte resultatmotorn.

1. Befintligt effective-result-svar får ett valfritt `controlDetails` på
   ACTIVE_RESULT. Gamla svar utan fältet förblir läsbara; UI visar då att
   detaljer inte finns i det hämtade underlaget. Ny server returnerar null
   för utfall utan tekniska kontrolluppgifter, särskilt DNS/DNF/NT.
2. När detaljer finns binds de till samma serverresolverade effektiva
   resultatrevision och dess historiska banversion. De innehåller bannamn,
   banversionens id, start/mål om giltiga, ordnade kontroller med
   sequence/code/occurrence och lagrad elapsedMs/legMs eller null, samt
   lagrade missingControls/extraPunches. Ingen ny utvärdering görs.
   Ingen mellantid betyder inte automatiskt felstämpling. Aktuell klassbana
   får inte blandas in i ett äldre resultat eller neutraliserad följd.
   `occurrence` och lagrade splitnycklar räknas över hela den historiska
   fysiska kontrollföljden, även en neutraliserad förekomst. Den förekomsten
   visas utan tid; senare förekomster får inte numreras om i adminvyn.
3. Ny läsande `/administrator/speaker-board` använder administratörens
   befintliga cookie och **exakt MANAGE_RACE**. Application återanvänder
   speakerprojektionen genom en separat namngiven administratörsfunktion.
   Den gamla speakervägen kräver fortsatt exakt VIEW_SPEAKER_BOARD; ingen
   generell capability-override, credential eller rollförändring införs.
4. Klienter visar lästid och fel, avbryter läsning vid deltagar-/vybyte och
   sparar inga privata resultat i beständig browsercache. Speakerpolling
   sker endast i den aktiva synliga speakerfliken och pausas vid dold sida.

## Konsekvenser

Ingen migration, resultatskrivning, historiköverskrivning, raw-byteåtkomst,
publik rättighet eller ny dependency. Kontrollrättning använder fortsatt
befintliga explicita versionsbundna handlingar. `MANAGE_RACE` får läsa
just dessa sammanfattade privata facts, inte den separata fulla raw/
revisionshistoriken. Start-/mål-/speakerfunktionärer får inga adminrättigheter.

Riktad kontrakts-/routekontroll krävs för saknade detaljer, repeterad kod,
scope och delegationen till rätt administratörsläsare. Riktig databas-
acceptans redovisas separat; syntetiskt UI-prov får inte beskrivas som det.
