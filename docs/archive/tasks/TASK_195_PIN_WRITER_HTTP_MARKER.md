# TASK195: pinna webbens skrivstoppsmarkör till installationsprofilen

Status: avgränsat kodsteg klart 2026-09-27; Linux-installation och fullt
tekniskt skrivstopp återstår.

## Utfall och gräns

I `systemd-v1` ska webbens HTTP-insläpp använda exakt samma beständiga
`/var/lib/o-tid/controller/closed` som systemd-writers startgrind och TASK194:s
markörskrivare. Webbprocessen ska bara öppna om den kör på Linux, hela
katalogkedjan är verkliga root-ägda kataloger utan grupp-/världsskrivrätt,
markören säkert saknas och föräldrakatalogen är stabil under kontrollen.
Alias, relativ eller annan absolut sökväg får inte öppna. Befintlig markör
(även en trasig symlänk) och alla kontrollfel nekar alla HTTP-vägar.

Helt omanagerad lokal utveckling är oförändrad när **båda** miljövariablerna
saknas. Ingen `NODE_ENV`- eller testprofil får kunna öppna en felkonfigurerad
produktionsgrind. Befintligt accepterade anrop dräneras inte av denna kontroll.
Ingen controller, installation, credentialgräns, databasregel eller
backupkvittens införs.

## Proportionerlig kontroll

Riktade enhetsprov simulerar Linux och filmetadata utan att ändra en riktig
`/var/lib`-katalog: korrekt frånvaro, befintlig markör, trasig symlänk,
fel väg/plattform, osäkra föräldrar och katalogbyte under läsning. Ett
lokalt Mac-HTTP-prov visar fail-closed för `systemd-v1` utanför Linux på
GET, POST och statisk resurs. Det tidigare Mac-provet med temporär markör
kan inte längre sanningsenligt testa öppet/stängt för den pinnade profilen;
en riktig Next-övergång öppen → stängd kräver Linux-installation.
Kör riktad web-/E2E-lint, typecheck, test och build, inte bred DB-/browser-
suite. Detta är fortsatt endast admission, inte TASK180:s tekniska stoppbevis.

## Genomfört och bevisnivå

Webbgrinden avvisar nu annan markörväg, macOS, osäker root-kedja,
markörnärvaro och osäker läsning. En injicerad plattform/filinspektion
används enbart i den rena enhetstesten; Next-proxy anropar alltid med verklig
runtime. Det befintliga Mac-browserprovet kontrollerar 503 och `no-store`
före GET-route, POST-route och statisk resurs. Det tidigare öppet/stängt-
provet med temporär Mac-katalog är borttaget eftersom det inte kunde
representera den nya fasta Linux-installationsvägen.

Riktad enhetstest: **5/5, exit 0**. Web- och E2E-TypeScript: **exit 0**.
Full web-ESLint samt separata riktade web-/E2E-ESLint: **exit 0**.
Syntetisk Playwright HTTP:
**1/1, exit 0** med lokal loopbackåtkomst. Webbuild: **exit 0**, 22/22
statiska sidor och Next Proxy registrerad. Ett första web-TypeScriptförsök
föll på en felaktig TypeScript-typ för den injicerade stat-strukturen
(**exit 2**); typen rättades och omkörningen passerade. Browserns första
start nekades 127.0.0.1-bindning i sandlådan (`EPERM`, **exit 1**), medan
samma kommando med tillåten loopback passerade.

Antagandet som återstår är att en riktig Linux-installation faktiskt
provisionerar och bevarar den root-ägda katalogkedjan och kör Next bakom
denna miljö. Något genomgående öppet → stängt HTTP-prov på Linux, dränering,
writer-sessionnoll eller backupbevis finns ännu inte. Nästa minsta steg i
TASK180 är ett isolerat Linux/systemd-prov som visar att just den fasta
markören stänger både ny HTTP-ingång och ny writerstart och att frånvaro
öppnar igen endast genom avsiktlig återställning. Det får inte kvittera
tekniskt stopp: process-/credential-/DB-gräns och dränering återstår.
