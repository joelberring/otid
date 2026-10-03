# TASK197: kontrolltider utan dubbel ram i deltagarens arbetsvy

Status: genomfört och riktat verifierat 2026-09-27.

## Användarutfall och gräns

På dator och padda ligger vald deltagares kontroll-/sträcktidssektion i
redan inramade arbetsytan. Den ska ha samma rena yta som personfakta i
TASK189: ingen andra kortkant eller extra sidutfyllnad, men en tunn
avdelare mellan vanlig ändring och tekniska resultatfakta. Rubrik,
historisk varning, resultatfält, kontrolltabell och undantag ska vara kvar.
Mobilens separata arbetsvy behåller sin inramade sektion och 44 px-mål.

Endast lokalt avgränsad CSS och en klass på befintlig semantisk sektion
ändras. Inga resultatregler, data, API, behörigheter, teknikval eller
domängränser ändras; ingen ADR behövs. MeOS är beteendereferens, inte
layoutmall eller kodkälla.

## Kontroll

Det återanvända syntetiska browserfallet passerade **1/1** vid 390/900/1280
px. Det kontrollerade mobilramen, att sidram och sidutfyllnad försvinner från
721 px, avdelaren, bevarade kontrollrader, arbetsytans scroll och inget
horisontellt sidspill. Riktad web lint och typecheck, browserharnessens
TypeScript och ESLint samt webbuild gav var för sig **exit 0**. Första
browserstarten gav sandbox-`EPERM` för lokal port 3167; samma prov passerade
med tillåten loopback. Desktop- och mobilskärmbilder granskades. Ingen databas
eller stor testsuite användes.

Antagande: den befintliga 721 px-gränsen och arbetsytans inre scroll är
fortsatt rätt för padda; detta prov är inte handhavandetest på fysisk enhet.
