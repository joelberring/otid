# TASK205: tätare deltagarrad med samlad metadata

Status: genomfört och riktat verifierat 2026-09-27.

## Utgångsläge

I administratörens delade deltagartabell lägger personknappen namnet och
klubben på varsin rad. Resultat-, hyrbricks- och betalningsetiketter börjar
först därefter. Vid 900/1280 px ger det onödig radhöjd även när en större
del av namnkolumnen är ledig.

## Operatörsutfall och gräns

Namnet är fortsatt den tydliga valbara huvudraden. Klubb och oförkortade
statusetiketter får en gemensam, radbrytande metadatarad under namnet.
Personknappen behåller namn och klubb i sitt tillgängliga namn. Långa namn,
klubbar och flera samtidiga statusar får brytas; ingen information kapas
eller döljs. Mobilens tryckyta och tabellens övriga kolumner berörs inte.

Det är endast privat presentation i `/manage`: ingen ändring av API,
resultatlogik, databas, behörighet eller teknikval. Ingen ADR behövs. MeOS
är en beteendereferens för informationstäthet, inte en UI-förlaga att kopiera.

## Proportionerlig kontroll

Utöka det befintliga syntetiska browserfallet med en rad som bär flera
statusar. Verifiera full synlig text, namn+klubb som tillgängligt knappnamn,
minskad radhöjd vid 900/1280 px samt inget horisontellt spill vid 390 px.
Kör bara browser-TS/ESLint, det riktade browserfallet och web
lint/typecheck/build. Ingen PostgreSQL eller bred testsuite.

## Utfall och verifiering

Namnet ligger kvar i fullbreddsknappen med namn och klubb som dess
tillgängliga namn. Den synliga klubben ligger på samma radbrytande
metadatarad som oförkortade resultat-, hyrbricks- och betalningsetiketter.
Synlig klubb är dold enbart för skärmläsare för att undvika dubbelläsning;
knappens tillgängliga namn innehåller den fortfarande. Metadataradens
vertikala utfyllnad har tagits bort lokalt, medan knappens 32/44px-tryckyta
och övriga tabellkolumner inte ändrats.

Det befintliga syntetiska browserfallet passerade slutligen **1/1, exit 0**.
Det kontrollerar namn+klubb som knappnamn, hela äldre-resultat-/betalnings-
och hyrbrickstexten, en 900px-rad **under 78 px**, en 1280px-rad **under
66 px** samt avsaknad av horisontellt sidspill på mobil. Skärmbilder vid
390, 900 och 1280 px granskades; på bred dator ryms klubb och två statusar
på en gemensam rad under namnet. Browser-TypeScript/ESLint samt slutlig web
lint/typecheck/build gav var för sig **exit 0**. Första utökade browserprovet
gav **exit 1** eftersom enbart omflyttningen fortfarande gav 80,59 px vid
900 px; lokal vertikal badge-utfyllnad togs bort och omprovet passerade.
Ingen PostgreSQL eller riktig tävlingsdata användes.

Kvarvarande antaganden: ovanligt långa klubb-/statusnamn får öka radhöjden;
fysisk padda/mobil, stark textzoom, skärmläsare och stora startfält är inte
fältaccepterade.
