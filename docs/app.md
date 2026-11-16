# O-Tid som app (iOS och Android)

Beslutet står i [ADR-0227](adr/ADR-0227-o-tid-som-app.md). Appen i `apps/mobile` är ett Capacitor-skal (8.6.2) som
öppnar O-Tids webb i en webbvy och har en egen inbyggd modul, `OTidTracking`, för GPS med låst skärm.

> **Läge 2026-11-16: obyggt och oprovat.** Kotlin- och Swift-koden är skriven men har aldrig kompilerats: miljön där den
> skrevs saknade Android SDK, Googles Maven-arkiv och Xcode. Inget är provat på en telefon. Stödet är `untested` tills
> provlistan nedan är genomgången på riktiga telefoner.

## Vad som finns

```text
apps/mobile/capacitor.config.ts   appId se.berring.otid, serveradressen (OTID_APP_SERVER_URL)
apps/mobile/www/index.html        reservsida när servern inte nås
apps/mobile/scripts/sync.mjs      `pnpm sync`: reservsidans adress + `cap sync`
apps/mobile/android/              Android-projektet (Capacitors mall + app/src/main/java/se/berring/otid/tracking)
apps/mobile/ios/                  Xcode-projektet (Capacitors mall + App/App/OTidTracking)
```

- **Android:** förgrundstjänst av typen `location` med fast notis, GPS (`LocationManager`, cirka 1 s), tillstånden
  `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` (krävs för att Android 12+ ska visa valet), `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` och `VIBRATE`. Inte `ACCESS_BACKGROUND_LOCATION`. Ingen
  automatisk säkerhetskopia (`allowBackup="false"` och `data_extraction_rules.xml`), journalen i `noBackupFilesDir`.
- **iOS:** `CLLocationManager` med «När appen används», bakgrundsläget `location`, `allowsBackgroundLocationUpdates`,
  blå indikator, ingen automatisk paus, aktivitetstyp fitness. Inte «Alltid». Journalen i Application Support med
  `isExcludedFromBackup` och skyddsklassen «fram till första upplåsningen» (skrivbar med låst skärm).
- **Journal:** en JSON-rad per punkt och lopp, synkad till disk (fsync) innan punkten skickas som händelsen `fix`.
  Överlever omstart av appen och telefonen.
- **Maxtid** i modulen: timer, kontroll vid varje punkt och (Android) ett larm som väcker telefonen.

## Så anropar webben bryggan

Capacitor lägger själv in `window.Capacitor.Plugins.OTidTracking` i sidan som laddas från `server.url`; webben behöver
inte `@capacitor/core`. Kontrollerat i Capacitor 8.6.2:s källkod:

- Android: `JSExport.getPluginJS` skapar `Capacitor.Plugins[namn]` med en funktion per `@PluginMethod` (som anropar
  `Capacitor.nativePromise`) och `addListener` (som anropar `Capacitor.addListener`). `Bridge.loadWebView` lägger in
  skriptet med `addDocumentStartJavaScript` för serverns ursprung, och `MessageHandler` öppnar `androidBridge` för
  samma ursprung (`Bridge.setAllowedOriginRules` tar med `server.url`).
- iOS: `JSExport.exportJS` gör samma sak som `WKUserScript` vid dokumentstart i huvudramen, för alla sidor i webbvyn;
  `registerPluginInstance` (anropas i `OTidBridgeViewController.capacitorDidLoad`) lägger in det.
- `native-bridge.js` (båda): `Capacitor.addListener(plugin, händelse, callback)` returnerar `{ remove }` direkt (inte ett
  löfte) och callbacken får `(data, fel)`. `await` på svaret fungerar ändå.

```js
const t = window.Capacitor?.Plugins?.OTidTracking;   // saknas i vanlig webbläsare
const { formatVersion } = await t.status();
t.addListener("fix", (fix) => { /* { seq, latitude, longitude, accuracyM, t, receivedAt } */ });
t.addListener("stopped", ({ sessionId, stoppedBy }) => {});
const { lastSeq } = await t.start({ sessionId, stopAtMs, title: "O-Tid spårar", text: "Bingo pågår" });
```

Detaljer som webben behöver veta:

- `start` avvisas om appen inte syns, om exakt plats saknas, om platstjänsten är avstängd (Android), om maxtiden redan
  passerat eller om ett annat lopp spåras. Samma `sessionId` igen fortsätter journalen.
- `title` och `text` visas i Android-notisen. iOS har ingen notis (den blå indikatorn), och `notifications` i
  `requestPermission` är där bara telefonens läge; spärra inget på det i iOS.
- Ungefärlig plats räknas som att appen inte spårar: `start` avvisas, och byter användaren under loppet stoppas
  spårningen med `stoppedBy: "system"`. Stängs platstjänsten av (Android) eller dras tillståndet in: också `"system"`.
- `read` utan `limit` ger högst 2000 punkter; större `limit` kortas till 2000.
- `post` tar en relativ (`/api/...`) eller full adress under serveradressen. Svar med felkod (t.ex. 409) ges som
  `{ status, body }`; bara nätfel och tidsgränsen (15 s) avvisas. Servern ser `Origin` = appens serveradress.
- `purge` avvisas medan loppet spåras.
- `signal({ kind: "ok" })` följer telefonens ljudläge: i tyst läge blir det bara vibration.

## Första gången på Macen

Kräver aktuell Xcode (se Capacitors krav för version 8 på capacitorjs.com), Android Studio, Node.js 22 och pnpm.

```bash
pnpm install
pnpm --filter @o-tid/mobile sync          # skriver adressen och kopierar www in i båda projekten
```

`sync` måste köras efter varje `pnpm install` och varje ändring av serveradressen. Den skapar filer som inte checkas in
(`capacitor.config.json`, `public/`, `capacitor-cordova-*-plugins`).

**iOS (Xcode):**

1. `pnpm --filter @o-tid/mobile open:ios` (öppnar `ios/App/App.xcodeproj`). Xcode hämtar Capacitor som Swift-paket från
   GitHub första gången.
2. Välj målet *App* → *Signing & Capabilities* → ditt team (personligt utvecklarkonto). *Background Modes → Location
   updates* ska synas redan (den står i `Info.plist`).
3. Bygg (⌘B). Rätta kompileringsfel; koden har aldrig byggts. Kör sedan på en ansluten iPhone (⌘R). På telefonen:
   Inställningar → Integritet → Utvecklarläge första gången.
4. Webbvyn felsöks med Safari → Utvecklare → telefonen.

**Android (Android Studio):**

1. `pnpm --filter @o-tid/mobile open:android`. Låt Gradle synka (hämtar Android Gradle Plugin 8.13 och Kotlin 2.2.21;
   föreslår Studio nyare versioner går det bra att ta dem).
2. Bygg (*Build → Make Project*) och rätta kompileringsfel; koden har aldrig byggts.
3. Kör på en telefon med USB-felsökning påslagen. Webbvyn felsöks i Chrome via `chrome://inspect`.

## Serveradress för test

Förvalet är `https://otid.berring.se`. En annan adress (bara schema, värd och port) sätts när `sync` körs och byggs in i
appen:

```bash
OTID_APP_SERVER_URL=https://test.example.se pnpm --filter @o-tid/mobile sync
```

Mot den lokala utvecklingsservern på Macen: telefonen och Macen på samma nät, servern lyssnar på alla gränssnitt och
`O_TID_PUBLIC_ORIGIN` i `.env` är samma adress som appen använder (annars stoppar serverns Origin-kontroll `post`):

```bash
pnpm --filter @o-tid/web dev --hostname 0.0.0.0      # dev.mjs skickar extra flaggor vidare till next dev
OTID_APP_SERVER_URL=http://192.168.1.20:3000 pnpm --filter @o-tid/mobile sync
```

Med `http://` tillåts okrypterat automatiskt (Android `cleartext`, iOS `NSAllowsLocalNetworking`). En `http`-sida på
nätet är ingen säker kontext, så webbläsarens egen GPS och service worker fungerar inte där; bryggan gör det. Kör
`sync` utan variabeln före en version till testarna.

## Till testare

**TestFlight (iOS):**

1. Skapa appen i App Store Connect med paket-id `se.berring.otid`.
2. Höj *Build* i Xcode, välj *Any iOS Device*, *Product → Archive*, sedan *Distribute App → App Store Connect*.
3. När bygget är behandlat: lägg till interna testare under TestFlight (direkt), eller externa (kräver Apples
   granskning av betaversionen). Fyll i integritetsuppgifterna (exakt plats, kopplad till användning i appen).

**Google Play (Android):**

1. Skapa appen i Play Console. *Build → Generate Signed App Bundle* i Android Studio (skapa och spara
   uppladdningsnyckeln utanför repot).
2. Ladda upp till *Intern testning* för egna prov.
3. *Stängt test*: minst 12 testare i 14 dagar innan appen får gå till produktion (personligt konto, ADR-0227 beslut 7).
4. Play kräver en deklaration för förgrundstjänst av typen plats (med en kort film som visar spårningen och notisen)
   och formuläret om datasäkerhet. Bakgrundsplats behöver ingen deklaration eftersom appen inte ber om den.

## Provlista A1

Gör listan på en iPhone och minst två Android-märken (t.ex. Samsung och Pixel), med en vuxen testare. Notera telefon,
systemversion och appversion.

- [ ] **En timme med låst skärm:** starta ett lopp, lås telefonen, gå eller spring en timme. Journalen ska ha punkter
      utan luckor över cirka 10 s (`status().lastSeq` ungefär lika med antalet sekunder). Notisen (Android) eller den
      blå indikatorn (iOS) syns hela tiden.
- [ ] **Pling efter 15 minuter låst:** lås telefonen, vänta 15 minuter, gå till en kontroll. Vibration och ljud kommer
      med låst skärm (ljud bara om telefonen inte är i tyst läge).
- [ ] **10 minuter i flygplansläge:** under loppet, slå på flygplansläge (med plats påslagen) i 10 minuter. Punkterna
      fortsätter i journalen; efter flygplansläget kvitterar servern loppets läge via `post`.
- [ ] **Omstart av appen under lopp:** stäng appen från applistan och öppna igen. Android: tjänsten och notisen ska
      leva vidare och `status().tracking` vara sant. iOS: spårningen stoppas när appen stängs; `status()` ska visa
      `stoppedBy: "system"`, journalen finnas kvar och `start` med samma `sessionId` fortsätta på nästa `seq`.
- [ ] **Automatiskt stopp vid maxtid:** sätt `stopAtMs` några minuter fram, lås telefonen. Spårningen ska stanna av sig
      själv, notisen försvinna och `status().stoppedBy` vara `"deadline"`, även i flygplansläge.
- [ ] **Batteri:** notera batteriprocent före och efter timmen med låst skärm. Mål att diskutera efter provet; ingen
      gräns är beslutad.
- [ ] Avslag: neka plats, välj ungefärlig plats, neka notiser (Android 13+). Webben ska visa att appen inte spårar.

## Kända osäkerheter

- Koden är okompilerad; räkna med småfel i Kotlin och Swift första gången.
- Android: om webbvyns JavaScript strypts med släckt skärm kommer `fix`-händelserna sent och plinget dröjer, fast
  journalen är hel. Det är det provlistans punkt två visar. Vissa märken (Samsung, Xiaomi) stänger förgrundstjänster
  med egna batterispärrar; då blir det `stoppedBy: "system"`.
- iOS: ljudet är ett systemljud (System Sound Services). Om det inte hörs med låst skärm kan bakgrundsläget `audio`
  behövas, vilket kräver ett nytt beslut.
- Android: reservsidan visas också när servern svarar med ett HTTP-fel på själva sidan (Capacitor gör så).
- Webbvyns egen lagring (där loppets läge ligger enligt ADR-0225) kan på iOS följa med i iCloud-säkerhetskopian; det är
  inte undersökt. På Android är all säkerhetskopia avstängd.
- Capacitor markerar `server.url` som tänkt för utveckling. Apple kan granska en app som mest visar en webbsida hårdare
  (riktlinje 4.2); den inbyggda spårningen är appens eget innehåll.
