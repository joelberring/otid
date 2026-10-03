# TASK198: tät statusrad på padda

Status: genomfört och riktat verifierat 2026-09-27.

## Användarutfall och gräns

Vid 900 px ligger de sex befintliga statusmåtten redan på en sammanhängande
rad. Browserbaslinjen visade i stället att underlagets version, lästid och
uppdateringssätt begränsas till 27 rem och därför bryts i två textrader.
Ge texten hela bredden på en separat kort rad, så att den kan läsas utan
extra höjd eller trunkering. Behåll ändringen endast om browsermåttet visar
verklig höjdvinst och inga förlorade uppgifter. 1280 px behåller sin breda
rad; mobilens separata kortuppställning påverkas inte.

Endast `/manage`-sidans befintliga CSS-modul ändras. Ingen status härleds på
nytt, inga data, behörigheter, API:er, teknikval eller domängränser ändras;
ingen ADR behövs. MeOS-bilderna används som beteendereferens för överblick,
inte som layoutmall eller kodkälla.

## Kontroll

Baslinje i syntetisk browser 900×800: statusremsan **58,34 px**, alla sex
mätvärden har samma `top`, och lästidstexten börjar 26 px senare men bryts
i två rader inom 27 rem.

Efter ändringen är statusremsan **under 50 px** i samma 900×800-prov, alltså
minst 8,34 px lägre än baslinjen; lästidstexten är en textrad. Browserfallet
passerade **1/1** och kontrollerar sex synliga mått på en rad, synlig version
och lästid, fortsatt navigation, ingen horisontell sidscroll samt 390/1280 px.
Skärmbilden vid 900 px granskades. Web lint/typecheck/build och
browserharnessens TypeScript/ESLint gav var för sig **exit 0**. Ingen databas
eller stor testsuite användes.

Antagande: vid längre lokaliserad text eller kraftig textzoom kan lästiden
fortfarande brytas; inget får döljas eller trunkeras. Fysisk padda är inte
handhavandetestad.
