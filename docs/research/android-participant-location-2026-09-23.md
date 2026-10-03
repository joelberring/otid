# Android: förstudie för privat deltagar-GPS

- Granskat: 2026-09-23
- Beslut: ADR-0151
- Underlag: officiell Android-dokumentation och läsande granskning av O-Tid;
  ingen fysisk enhet eller GPS-inspelning har provats.

## Androids dokumenterade gränser

- En synlig, användarstartad `location` foreground service kan fortsätta få
  foreground-position när skärmen släcks eller appen lämnar förgrunden. Den
  visar en beständig systemnotis. Det är en plattformsmöjlighet, **inte** ett
  bevis på att O-Tids kommande klient gör det på en viss telefon.
- Android 14+ kräver rätt foreground-service-typ, `FOREGROUND_SERVICE_LOCATION`
  och beviljad platsbehörighet när tjänsten skapas. Att försöka starta en sådan
  tjänst från bakgrunden med endast while-in-use-behörighet kan avvisas. Första
  snittet ska därför startas från en synlig aktivitet på användarens begäran;
  det ska inte lova automatisk återstart efter processdöd eller telefonstart.
- En pågående foreground service räknas som foreground location även när
  skärmen är släckt. `ACCESS_BACKGROUND_LOCATION` väljs inte för detta första
  användarstartade flöde. Ett senare behov av att **skapa**/återstarta
  platstjänst utan synlig aktivitet kräver nytt beslut och separat
  behörighets-/policygranskning.
- Android Auto Backup inkluderar som standard stora delar av appens privata
  filer. En privat osynkad spårkö får inte följa med till en oavsiktlig
  molnbackup; klientens backupregler måste granskas i implementationen.
- Android 13+ låter en användare neka notisbehörighet. Då visas en
  foreground-service-notis inte i vanliga notislisten, även om tjänsten syns
  i systemets Task Manager. C1a kräver därför notisbehörighet för ett tydligt
  användarsynligt inspelningsläge och redovisar avslag separat.
- Androids `LocationManager.GPS_PROVIDER` är ett plattforms-API för GNSS med
  uppdateringscallback och utan nytt Play Services-beroende. Det kan ge
  frånvarande eller dåliga fixar; först en faktiskt mottagen och lokalt
  kvitterad punkt får öka punktantalet.

Primärkällor: [platsbehörighet och foreground location](https://developer.android.com/develop/sensors-and-location/location/permissions),
[foreground service-typer](https://developer.android.com/develop/background-work/services/fgs/service-types),
[restriktioner för bakgrundsstart](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start),
[Android Auto Backup](https://developer.android.com/identity/data/backup),
[notisbehörighetens effekt på foreground services](https://developer.android.com/about/versions/13/behavior-changes-13),
[LocationManager](https://developer.android.com/reference/android/location/LocationManager).

## Befintligt projekt, kontrollerat lokalt

- `apps/station` är Capacitor 8.5.0 med egen Kotlin-/SQLite-kod för
  SPORTident-station. Dess Androidmanifest kräver USB-host och har inga
  platsbehörigheter eller location service. Stationsdatabasen är avsedd för
  råa avläsningsdata, inte deltagarspår.
- ADR-0009:s låsta Androidverktygskedja och Capacitor-version kan återanvändas
  utan att föra över stationens USB-, pairing- eller operatörsbehörighet.
- ADR-0123:s privata GPX-mottagning tar en färdig GPX 1.1-fil via en
  tidsbegränsad, administratörsutfärdad entry-grant. Den har immutable original,
  innehållshash och idempotent reservations-/kvittensflöde. Den är **inte** en
  kontobunden GPS-skrivväg. ADR-0146:s deltagarkoppling ger i dag läsning,
  medan ADR-0148/0149/0150 ger privat läsning och separat delningsstatus.
- ADR-0144:s konto använder en host-only, `SameSite=Strict` browsercookie.
  En separat lokalt paketerad app får inte anta att den kan skicka cookien
  från sin egen origin. B1:s privata resultatsvar ger race-id och publicerat
  resultat, men ingen opak väljare för en exakt anmälningskoppling utan
  publicerat resultat. Mobil inloggning och exakt offlineval av anmälan är
  därför ett eget integrationsbeslut, inte redan färdig funktion.
- `pnpm android:test` provar inte verklig GNSS, skärmlås, batterisparläge,
  processdöd eller serverkvittens från fysisk telefon.

## Öppet fältbevis

Välj och dokumentera en faktisk Androidtelefon med modell, Androidversion,
appversion och plats-/batteriinställningar före acceptans. Prova synlig start,
låst skärm, frånslagen anslutning, återanslutning, processavbrott och omstart.
Jämför sparade sekvenser med förväntat facit och rapportera varje lucka som
lucka; interpolera aldrig positioner. Ingen iOS-, browser- eller generell
Androidgaranti kan härledas ur plattformsdokumentationen.
