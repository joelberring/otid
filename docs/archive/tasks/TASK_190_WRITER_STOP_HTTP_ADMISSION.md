# TASK190: installationsstyrt HTTP-insläpp inför tekniskt skrivstopp

Status: avgränsat kodsteg klart 2026-09-25. ADR-0160 kompletterad före kod.

## Syfte och avgränsning

Gör ett verkligt delsteg i TASK180:s Linux/systemd-profil: varje HTTP-anrop
ska passera samma fail-closed insläpp innan Next-route eller renderingsarbete.
Profilen `systemd-v1` är opt-in och kräver en absolut markörsökväg i en redan
befintlig betrodd katalog. När markören finns eller katalogens tillstånd inte
kan avgöras returneras 503 utan routekörning. En giltigt frånvarande markör
släpper igenom anrop som vanligt. Alla metoder och vägar omfattas; första
driftprofilen lovar inte fortsatt serverläsning under stopp.

Detta skapar **inte** markören, stoppar ingen process och utfärdar inget
backupbevis. Controller, systemd-enheter, CLI-/migrationsgrind, separata
credentials och riktig Linux-acceptans är fortfarande TASK180:s öppna krav.
Ingen domänregel, migration eller datamodell ändras.

## Kontroll

Riktade enhetstester för omanagerad, öppen, stängd och osäker konfiguration.
Ett lokalt syntetiskt HTTP-prov ska visa att markören nekar också en vanlig
Next-route innan handlern nås, och att en öppen profil fungerar. Riktad web-
lint/typecheck och build. Ingen riktig databas, objektlagring, tävling eller
produktionscredential används. Mac-provet är **inte** systemd-acceptans.

## Levererat och resultat

- `apps/web/src/proxy.ts` kör grinden utan matcher för alla HTTP-vägar.
  `systemd-v1` med en saknad, otillgänglig eller grupp-/världsskrivbar
  markörkatalog, eller en befintlig markör, svarar 503 och `no-store`.
  Bara frånvarande markör i en stabil, redan befintlig katalog öppnar.
- Ingen konfiguration behåller den tidigare omanagerade utvecklingsmiljön;
  ensamt satt markörsökväg, okänd profil och ofullständig sökväg stänger.
  Den svenska pausinformationen ligger i en separat språkmodul.
- Riktad web-TypeScript och E2E-TypeScript: **exit 0** vardera.
  Separat web- och E2E-ESLint: **exit 0** vardera. Ett enhetstestfils
  **4/4** tester passerade, **exit 0**. Lokalt syntetiskt HTTP-prov:
  **1/1** passerade, **exit 0**, med GET/POST före route och återöppning.
  `CI=true pnpm --filter @o-tid/web build`: **exit 0**; Next registrerar
  `Proxy (Middleware)`.
- Den första browserkörningen i begränsad sandbox fick `listen EPERM` på
  127.0.0.1:3190 (**exit 1**); samma prov med tillåten lokal loopback
  passerade. Ett gemensamt ESLint-kommando med E2E-projektparser på webbfiler
  gav förväntat parserfel (**exit 1**); de korrekta separata kommandona ovan
  passerade.

## Kvarstående antaganden och nästa minsta snitt

`systemd-v1` förutsätter att installeraren skapar en beständig betrodd
markörkatalog och verifierar ägare/åtkomst; det finns ännu ingen installerare
eller controller. Markörkontrollen kan släppa in ett anrop precis före stoppet;
det anropet måste dräneras. Direktstartade CLI:er, migrationer, workers och
redan pågående objektlagringssteg täcks inte. Ingen Linux/systemd-acceptans,
session-/processnollkontroll eller tekniskt stoppbevis har gjorts här.

Nästa minsta snitt: gör en enda installationsägd systemd-profil som hindrar
ny webb-/CLI-writerstart under varaktig markör, och bevisa just detta på Linux
innan dränering och backupbevis kopplas på.

TASK192 har därefter lagt en **icke aktiverad** startkontroll och exempel för
webb/migration. Alla betrodda CLI-starter och Linux-beviset ovan återstår.

TASK195 har därefter skärpt denna äldre, valfria absoluta markeringsväg till
exakt Linux-/root-ägd `/var/lib/o-tid/controller/closed`. TASK190:s tidigare
Mac-prov med en temporär öppen markörväg beskriver den historiska leveransen,
inte den nuvarande produktionsgrinden eller det nuvarande browserprovet.
