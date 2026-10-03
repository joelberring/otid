# TASK202: klass från översikt till åtgärd

Status: genomfört och riktat verifierat 2026-09-27.

## Operatörsflöde

Tävlingsöversiktens kompakta klasstabell ska på padda/dator visa klassens
faktiska bana och version från det validerade underlaget, inte bara
”Tilldelad”. Mobilen prioriterar klass/start/antal i samma tabell; den
detaljerade klassvyn visar banan även där. Klassnamnet
ska öppna **Före tävlingen → Klasser** med samma klass vald i befintliga
kontroller för kapacitet och startupplägg. En gammal förhandsgranskning får
inte följa med till den nya klassen, och ingen ändring skrivs vid navigering.

I klassvyn ska ett positivt och tillförlitligt antal saknade fasta starttider
leda till TASK201:s redan befintliga personurval. Vid avvikelse mellan
klassens angivna antal och deltagarunderlaget visas fortsatt ”Kontrollera
antal” i stället för en falsk färdigmarkering eller åtgärdslänk.

Detta är navigation och presentation i befintlig `MANAGE_RACE`-arbetsyta.
Ingen ny serverfunktion, datamodell, behörighet, resultatregel eller
domängräns införs; ingen ADR krävs. Formulärens befintliga granskning,
versionskontroll och låsning gäller fortsatt. MeOS är beteendereferens,
ingen kod- eller UI-källa.

## Proportionerlig kontroll

Utöka det befintliga syntetiska browserfallet för klassval, exakt bana,
tomma/avvikande antal, urvalsväg och 390/1280 px. Kör riktad browser-
TypeScript/ESLint samt web lint/typecheck/build. Ingen databas eller bred
testsvit för denna klientnavigering.

## Utfall och verifiering

Understruket klassnamn är en tangentbords- och touchåtkomlig textknapp i
befintlig rad. Den väljer klass i både kapacitets- och startuppläggsformulär,
nollställer tidigare osparad startuppläggsgranskning och öppnar rätt
förberedelseflik. Klasslänken öppnar inte något nytt formulär automatiskt;
klassnamnet syns i båda rubrikerna. Tidvarningen i klassvyn öppnar
TASK201:s befintliga filter endast när deltagarantalet stämmer. En
syntetisk avvikelse visar i stället ”Kontrollera antal” utan knapp.

Samma riktade syntetiska browserfall: **1/1 passerade, exit 0** (390 och
1280 px, klassbyte, förvalda kontroller, exakt personurval och avvikande
antal). Browser-TypeScript/ESLint samt web lint/typecheck/build gav var för
sig **exit 0**. Mobil- och desktopbilder av översikt/klasskontext granskades;
ingen horisontell sidbredd uppstod. Första utökade browserkörningen gav
**exit 1** därför att ett äldre testantagande väntade sig att återinträde i
Före alltid visar Upplägg. Testet väljer nu uttryckligen Upplägg när den
tidigare klassfliken behållits; omkörningen passerade. Ingen databas,
verklig tävling eller stor testsvit användes.

Kvarvarande antaganden: senast hämtade validerade kurs-/klassuppgifter är
aktuella för operatörens beslut; osynkade köer visas inte här. Fysisk
touch, skärmläsare, stark textzoom och verklig arrangörsanvändning är
ännu inte accepterade. Längre bannamn får radbrytas på padda/dator.
