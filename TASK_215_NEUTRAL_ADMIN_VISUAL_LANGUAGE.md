# TASK215: neutral visuell skala i tävlingsadministrationen

Status: genomfört i `/manage`, syntetiskt verifierat 2026-09-27.

## Avsikt och gräns

Användarens referensbild visar en lugn, ljus arbetsyta med liten enhetlig
typografi, tunna skiljelinjer och få signalfärger. O-Tids `/manage` har redan
förtätad datorlayout men ger nästan alla vardagliga knappar, markeringar och
etiketter stark grön eller gul vikt. Detta snitt ändrar endast CSS i
administrationens arbetsyta och dess inbäddade översikt/personarbete/speaker.
Ingen publik sida, stationsvy, API, resultatregel eller behörighet ändras.
Det är en egen visuell riktning, inte en kopia av Codex eller MeOS.

Neutral duk, vita arbetsytor, grafitgrå text och diskreta linjer bär den
vanliga strukturen. Aktiv navigering visas med bakgrund och kant/understreck,
inte signalgrönt. Vardagliga badges är neutrala. Rött reserveras för explicit
MP/DSQ och fel; varmt gult för känd saknad eller inaktuell information,
inte för fri start eller bara en vald person. Fokusindikering är separat
och tydlig. Alla kritiska tillstånd behåller svensk text/roll, aldrig enbart
färg. Mobilens stora tryckytor minskas inte.

Speakerprojektionen innehåller ingen placering, ledare, tid bakom eller
radiopassage. Därför färgkodas ingen löptid som ”ledartid” här. Ett senare
separat vertikalt snitt måste först leverera och definiera sådana data.
Ingen ADR behövs: teknikval och domängränser ändras inte.

## Riktad kontroll

Granska 390/900/1280 px för översikt, deltagare och inbäddad speaker med
syntetiska data. Kontrollera neutral vardagskrom, synliga MP-/saknad-/stale-
signaler, aktiv flik, fokus, 44 px mobila tryckytor och inget horisontellt
sidspill. Kör riktad webblint/typecheck/build och ett befintligt syntetiskt
browserflöde. Ingen riktig tävling, databas eller fysisk enhet behövs.

## Utfall

Den inloggade administrationen har nu neutral duk, vita ytor, grafitgrå
vardagskontroller och tunnare ramar. Valt läge, person och mobilens fyra
arbetsvägar markeras utan signalgrönt; de fyra mobilvägarna är dessutom
kompakta dividerade rader i stället för fyra stora kort med inre måttkort.
Vardagsbadges är grå. Endast känd avvikelse som MP/DSQ, saknad fast
minutstarttid, ej återlämnad hyrbricka, obetald anmälan och äldre underlag
får röd respektive varm gul text/bakgrund. Speakerlistans text och ramar är
nedtonade, men felstatusen är fortfarande uttalad i text och röd. Ingen
ledarfärg visas utan ledarunderlag.

Riktad webblint, web-typecheck och web-build gav **exit 0**. Browser-
TypeScript och riktad ESLint gav **exit 0**. Det befintliga syntetiska
TASK167-flödet passerade **1/1** efter sista ändringen och granskade
skärmbilder vid 390/900/1280 px samt MP- och saknad-tid-signaler. Ett första
browserförsök nekades av sandboxens loopbackport med `EPERM` (exit 1);
godkänd omkörning passerade. Fysisk mobil/padda, verklig stor tävling,
textzoom och faktisk speakeranvändning är inte verifierade.
