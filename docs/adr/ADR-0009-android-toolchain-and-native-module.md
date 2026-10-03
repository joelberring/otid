# ADR-0009: Androidverktygskedja och native-modul

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

ADR-0008 fastställer wire-kontraktet för TASK 002:s råa Androidtransport men
lämnar den reproducerbara nativeverktygskedjan och modulindelningen öppna.
Capacitor 8.5.0:s officiella Androidmall använder Gradle 8.14.3, Android Gradle
Plugin 8.13.0, compile/target SDK 36, minSdk 24 och Java 21. Kotlin 2.3 kräver
dessutom en R8-version med uttryckligt stöd för dess metadataformat.

Nativekoden är en säkerhets- och dataintegritetsgräns: den äger USB-behörighet,
serieport och råbytes, men får inte tolka SPORTident-protokoll eller påverka
resultatdomänen. Ett Androidprojekt som bara råkar byggas med utvecklarens
globala verktyg är inte tillräckligt reproducerbart.

## Beslut

Stationsappen skapas som workspaceprojektet `apps/station`. Androidprojektet
ligger i `apps/station/android` och består av:

- `:app`, ett minimalt Capacitor-skal som explicit registrerar pluginen, och
- `:otid-usb-serial`, en separat Android library-modul som ensam får bero på
  `usb-serial-for-android` och Androids USB-API.

Följande versioner låses exakt:

| Komponent | Version |
|---|---|
| Node.js i CI | 24 |
| pnpm | 11.19.0 |
| Capacitor CLI/Core/Android | 8.5.0 |
| Eclipse Temurin JDK | 21.0.12+8 |
| Gradle wrapper | 8.14.3 |
| Android Gradle Plugin | 8.13.2 |
| Kotlin/Kotlin Gradle Plugin | 2.3.21 |
| Android compile/target SDK | 36 |
| Android min SDK | 24 |
| `usb-serial-for-android` | 3.11.0 |

Capacitors mallbaslinje ändras avsiktligt från AGP 8.13.0 till patchversion
8.13.2. Skälet är att 8.13.2 innehåller R8 8.13.19, som Androids officiella
kompatibilitetstabell anger för Kotlin 2.3-metadata. Det ändrar inte
domängränserna eller appens SDK-nivåer.

Java- och Kotlin-bytecode använder JVM target 21. Ingen implicit
`buildToolsVersion` anges; AGP väljer sin dokumenterade standard. CI installerar
SDK-paketet `platforms;android-36` uttryckligen.

Repositoryn använder `google()` och `mavenCentral()`. JitPack exponeras i
dependency resolution endast för gruppen `com.github.mik3y`. Gradles plugin-
repositories används endast för buildplugins. Versionsintervall och dynamiska
versioner är förbjudna.

Gradle wrapperns distribution låses med SHA-256. Gradle dependency locking och
strict dependency verification ska omfatta binärer och metadata för hela
nativegrafen. Npm-paketen låses av det befintliga pnpm-locket och installeras
med `--frozen-lockfile` i CI. Kända kontroller och källor registreras i
`docs/research/android-native-toolchain.md`.

## Nativegräns

Capacitor-pluginen är en tunn JSON/wire-adapter. En testbar controller äger en
aktiv anslutning och delegerar fysisk I/O till ett backend-interface. Den
konkreta backendimplementeringen är enda lagret som känner till mik3y-API:t.

- Lifecycle- och kontrolloperationer serialiseras.
- Blocking reads och writes körs utanför UI-tråden.
- Accepterade writes är FIFO och har den explicita tidsgränsen från wire-anropet.
- Attach, detach, state, error och bytes går genom en begränsad serialiserad
  eventkö med en global, monoton native-sekvens.
- Read-buffer kopieras innan den lämnar backend.
- Overflow, timeout, detach och I/O-fel är explicita; byteförlust döljs inte.
- Stale callbacks från en tidigare anslutningsgeneration ignoreras.
- Begärd close dränerar accepterade writes; detach och fel avbryter dem.
- Enhetsserienummer och råbytes loggas aldrig.
- Inga VID/PID-filter, protokollkommandon eller automatisk återanslutning byggs
  i detta snitt.

JVM-tester med fake backend är den primära deterministiska verifikationen av
controller, eventkö och livscykel. Android lint och `assembleDebug` är obligatoriska
bygggrindar. Instrumenterade tester verifierar Android/Capacitor-bindningen när
en emulator eller fysisk enhet finns. Endast fysisk test med inventerad station,
kabel och Androidenhet kan höja hårdvarumatrisens status.

## Konsekvenser

- Nativeberoenden stannar i Androidadaptern och läcker inte in i domän,
  protokoll eller webb.
- Toolchainavvikelsen från Capacitors mall är liten, dokumenterad och
  reproducerbar.
- JVM-tester kan bevisa ordning, cleanup och wiremappning utan att låtsas vara
  USB-verifikation.
- Androidbygget bevisar inte SPORTident-stöd och öppnar inte ADR-0007:s
  protokollgrind.
- JDK och Android SDK är utvecklingsverktyg, inte nya runtime- eller
  domänberoenden.
