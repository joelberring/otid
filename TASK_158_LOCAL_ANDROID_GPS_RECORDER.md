# TASK158: lokal privat GPS-inspelare på Android (C1a)

Status 2026-09-23: lokal Android-/webbkod finns, men nativebygge,
instrumenterade prov och fysisk acceptans är **inte verifierade**. Beslut:
ADR-0151. Slutför C1a:s verifiering före C1b:s konto- och anmälningsbeslut.

## Avgränsat utfall

En separat installerbar Androiddeltagarapp kan i ett tydligt märkt
**utvecklarflöde** starta och stoppa en lokal privat GPS-inspelning, visa om
insamling faktiskt pågår, och återöppna bevarade mätpunkter efter app-/
processavbrott. Den kan ännu inte koppla spåret till ett konto, synka det
eller hävda att skärmlås fungerar på en verklig telefon.

## Bygg endast detta

1. Lägg en separat `apps/participant` med egen appidentitet. Återanvänd den
   pinnade Capacitor-/Kotlinverktygskedjan, men inga USB-behörigheter,
   stationscredentials eller stationsdatabas. Lägg ingen ny plats-SDK om
   Androids egna API:er räcker.
2. Starta en `location` foreground service endast från synlig, uttrycklig
   användarhandling efter beviljad precisionsbehörighet och aktiverad plats.
   Visa beständig notis. Stopp ska stoppa platsinsamling och frysa spåret.
3. Skriv varje faktiskt mottagen punkt atomiskt med lokal inspelnings-id,
   monoton sekvens, mättid, koordinat och tillgänglig noggrannhet i app-privat
   beständig journal. Bevara luckor och avbrott; interpolera inte. Håll
   osynkade spår utanför automatisk backup och avinstallationsförlust tydlig.
4. Visa få, informationsrika svenska tillstånd: väntar på behörighet/plats,
   spelar in, avbruten, stoppad/osynkad och lagringsfel. En skärm får aldrig
   visa ”spelar in” om tjänsten inte kan bekräfta det.

## Minsta verifiering

- Riktade nativeenhetstester för monoton beständig sekvens, stopp/frysning,
  återöppning efter processavbrott och fel vid full/trasig lagring. En enda
  konkret UI-kontroll av tydliga statusar; bygg APK och kör Android lint.
- Dokumentera om en fysisk Androidtelefon faktiskt finns tillgänglig.
  Emulator/JVM-test eller grön APK får inte räknas som GNSS-/skärmlåsbevis.
- Redovisa exakta kommandon, exitkoder och kvarvarande antaganden. Ingen
  isolerad PostgreSQL eller bred browser-/testsvit behövs i detta lokala snitt.

### Läget efter första implementationen

- `apps/participant` har separat appidentitet, svensk statusvy, native
  `location`-foreground service och app-privat SQLite-journal. Det finns ingen
  konto-, uppladdnings-, livepositions- eller USB-koppling i detta snitt.
- TypeScript-typecheck, riktad ESLint och 5 UI-/kontraktstester passerar.
  Webbasseten byggs och kan kopieras till Androidprojektet; manifest och
  backup-XML är syntaktiskt giltiga.
- Standardkommandot `./gradlew :app:testDebugUnitTest :app:lintDebug
  :app:assembleDebug` avbryts före projektkonfiguration med `Unable to locate
  a Java Runtime` (exit 1). En separat, hashverifierad Temurin 21.0.12+8 i
  privat temporär katalog kan starta Gradle 8.14.3 (`--version`, exit 0).
  Android SDK 36/adb saknas fortfarande; någon fysisk telefon kunde därför
  inte inventeras eller provas.
  Kotlinkompilering, Android lint, APK, instrumenterade journalprov,
  GNSS-/skärmlås- och batteriprov är därmed **öppna**, inte gröna.
- En lokal JDK 17 och Gradle 8.14.3-cache finns sedan tidigare. Den temporära
  JDK 21 är inte systeminstallerad. SDK-hanteraren nådde paketlistan, men
  krävde ett nytt Android SDK-licensgodkännande; tom stdin accepterade inte
  avtalet och inga SDK-paket installerades. Detta beslut är uppskjutet.
- Gradles strict dependency verification och låsfiler för den nya appens
  exakta nativegraf återstår enligt ADR-0009. Befintliga stationslåsfiler får
  inte antas bevisa en separat appgraf utan egen resolution.
- Nästa minsta avslut på C1a är att efter behörigt SDK-licensbeslut installera
  Android SDK 36 i en isolerad miljö, låsa/verifiera appens nativegraf, köra
  nativekontrollerna med pinnad JDK 21 och därefter de
  riktade instrumenterade proven på en namngiven telefon. Först då får C1a
  markeras verifierad. Separat GPS-synk och kontokoppling hör fortsatt till
  C1b/C1c.

## Ingår inte

Kontoinloggning, anmälningsval, överföring/kvittens, GPX-publicering,
liveposition, resultatbedömning, SPORTident, iOS och PWA-GPS. C1b beslutar
mobilkonto och exakt anmälningsval; C1c beslutar privat kontosynk; C1d
bevisar faktisk enhet och nät-/skärmlåsförlopp.
