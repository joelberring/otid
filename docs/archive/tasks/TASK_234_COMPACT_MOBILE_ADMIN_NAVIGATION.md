# TASK234: frigör arbetsyta i mobil adminnavigering

Status: klar 2026-09-27.

## Omprövat UI-beslut före kodändring

[TASK218](TASK_218_MOBILE_PREPARATION_NAVIGATION.md) valde uttryckligen två
synliga rader i stället för en rullista, för att alla sju arbetsvägar skulle
fungera som orienteringskarta. Det är ett verkligt motstående UI-beslut.
Efter användarens senare önskemål om mindre påträngande layout och att det
aktiva arbetet ska få mer plats väljer TASK234 en mer kompakt mobilkontroll.
Alla sju namn finns kvar i det inbyggda valfältet, aktuell plats och
fältetikett är alltid synliga, medan två-radskartan inte längre är synlig
samtidigt. Detta ersätter endast TASK218:s mobilpresentation under 721 px;
dess semantik, desktopnavigering och tryckbarhet behålls. Om praktisk
användning visar att överblicken försämras får detta omprövas med en ny
avgränsad UI-uppgift, inte med dolda genvägar.

## Användarutfall

På mobil ska aktivt arbete i tävlingsadministrationen börja märkbart
högre upp utan att tävlingens status eller åtkomsten till före-, under-
och efterläge försvinner. Dator och större padda behåller sitt
informationstäta tabbläge.

## Avgränsning

Under 721 px ersätts de två höga knappgallerna för arbetslägen och
förberedelse-/underavsnitt med två tydligt märkta, inbyggda valfält.
Alla fem arbetslägen, sju förberedelseavsnitt och fyra underavsnitt
ska finnas med oförändrad betydelse. Det aktuella valet ska synas,
fälten vara minst 44 px höga och spärras av befintlig `workflowLocked`.
Knappnavigeringen ska behållas över 720 px och den inaktiva versionen
ska inte finnas i tangentbords- eller tillgänglighetsträdet.

Återgången från TASK232:s klasskontext måste fokusera den **synliga**
mobila Banor-väljaren i stället för en dold desktopknapp. Bevara alla
sex statusvärden och underlagets tid/version synliga; dölj ingen
kritisk status eller skapa ny knapp-/färgkod. Inga nya navigationsvägar,
API:er, domänregler, behörigheter eller teknikval; ingen ADR krävs.

## Riktad acceptans

Utöka det befintliga syntetiska browserfallet. Vid 390 px ska Banor-
arbetets övre kant flyttas minst 70 px upp från tidigare cirka 510 px,
med alla statusvärden kvar. Vid 320 px ska långa val och sju avsnitt
fungera utan horisontellt sidspill. Prova ett byte av arbetsläge,
ett avsnittsbyte, TASK232-återgångens fokus och att låst läge spärrar
valen. Vid 768/1280 px ska knappnavigeringen finnas kvar och de mobila
väljarnas layout vara dold. Ett återanvänt syntetiskt browserfall,
riktad lint/typecheck och web-build räcker. Ingen verklig tävling.

## Utfall

De fem arbetslägena och de sju respektive fyra underavsnitten visas som
två märkta native-valfält på mobil. De befintliga knapparna ligger kvar på
dator/padda. `workflowLocked` spärrar också valfälten; TASK232:s återgång
fokuserar den synliga väljaren på mobil och Banor-knappen på desktop. Sex
statusmått, underlagsversion och tid är kvar ovanför navigationen.

Det syntetiska browserfallet passerade **1/1, exit 0** efter layoutjustering
vid 320/390/768/1280 px. Vid 390 px ligger Banor-panelens övre kant högst
440 px från sidans topp (tidigare ungefär 510 px); slutbilden visar den
omkring 407 px. Ingen horisontell sidspill vid provade bredder. Kontrollen
innehåller låst valfält under en avsiktligt kvarhållen läsning, alla
underval, fokuserad återgång och desktopknappar. Första körningen var röd
på gränsen 440 px (uppmätt 445,203125 px); etikett/val lades på en rad
vid normal mobilbredd och slutprovet passerade. Detta är syntetisk UI- och
tillgänglighetskontroll, inte en fältstudie med funktionärer.
