# TASK209: kompakt topp för tävlingsadministration på bred skärm

Status: genomfört och riktat syntetiskt verifierat 2026-09-27; inte ny
tävlingsfunktion.

## Operatörsutfall

På bred dator ska tävlingens identitet, uppdatera/logga ut och de sex
redan befintliga statusmåtten dela ett sammanhängande toppband. Arbetsflikarna
ska börja direkt under detta. På smalare dator/padda får banden fortsatt
ligga ovanför varandra när texten annars skulle bli för trång. Mobilens
ordning och minst 44 px tryckytor ska behållas. Ingen status, lästid,
underlagsversion eller åtgärd får döljas.

## Gräns

Endast markupgruppering och CSS för `/admin/[raceId]/manage`. Ingen ändring i
API, domän, autentisering, resultat eller andra vyer. MeOS-bilderna används
som beteendereferens för synlig information, inte som UI- eller kodmall.

## Proportionerlig kontroll

Ett riktat syntetiskt browserfall på 390, 900 och 1280 px mäter toppbandens
relation, frånvaro av horisontellt sidspill och synliga/åtkomliga kontroller.
Kör web lint, typecheck och build. Detta är inte fysisk användbarhets- eller
driftacceptans.

## Utfall

Vid 1280 px står tävlingsidentitet/åtgärder och alla sex statusmått på
samma horisontella band. Statusens källversion och lästid ligger direkt under
måtten utan att döljas. Vid 900 och 390 px ligger banden fortfarande i
läslig följd; mobilens tryckytor och innehåll är oförändrade. Den befintliga
översiktens tabell, uppföljning och arbetsflikar ligger kvar.

Det riktade browserfallet passerade **1/1, exit 0** och mätte bandens
relation vid 390/900/1280 px samt frånvaro av sidspill. Skärmbilder för
mobil, padda och dator granskades. Första browserstart nekades av
sandboxens loopbackspärr (`EPERM`, exit 1); samma avgränsade syntetiska prov
kördes om med lokal portbehörighet och passerade. Web lint, typecheck och
build samt browser-TS/ESLint gav var för sig **exit 0**. Inga riktiga
tävlingsdata eller databas användes.

Kvarvarande antaganden: mycket långa tävlingsnamn, ökad textstorlek och
fysisk padda/dator är inte användbarhetsprövade. Vid sådana trånga lägen
får bandet radbrytas; inga uppgifter döljs.
