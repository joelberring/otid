# Android nativeverktygskedja

- Granskat: 2026-08-30
- Beslut: ADR-0009
- Syfte: reproducerbar bygg- och supply-chain-bas för rå USB-transport

## Låst matris

| Del | Exakt version eller revision | Primär källa |
|---|---|---|
| Capacitor CLI/Core/Android | 8.5.0 | [Capacitor 8.5.0 release](https://github.com/ionic-team/capacitor/releases/tag/8.5.0) |
| Gradle wrapper | 8.14.3 `all` | [Capacitors wrappermall](https://raw.githubusercontent.com/ionic-team/capacitor/8.5.0/android-template/gradle/wrapper/gradle-wrapper.properties) |
| Android Gradle Plugin | 8.13.2 | [AGP 8.13 release notes](https://developer.android.com/build/releases/agp-8-13-0-release-notes) |
| Kotlin/KGP | 2.3.21 | [Kotlin 2.3.21 release](https://github.com/JetBrains/kotlin/releases/tag/v2.3.21) |
| JDK | Temurin 21.0.12+8 | [Temurin 21.0.12+8 release](https://github.com/adoptium/temurin21-binaries/releases/tag/jdk-21.0.12%2B8) |
| compile/target/min SDK | 36 / 36 / 24 | [Capacitors versionsmall](https://raw.githubusercontent.com/ionic-team/capacitor/8.5.0/android-template/variables.gradle) |
| Android SDK platform | `platforms;android-36`, revision 2 | [Android 16 SDK setup](https://developer.android.com/about/versions/16/setup-sdk) |
| Android command-line tools (macOS arm64) | 15859902 | [Android Studio downloads](https://developer.android.com/studio#command-line-tools-only) |
| Android Platform Tools | 37.0.1 | Installerad av AGP/SDK Manager |
| USB-seriebibliotek | 3.11.0 | [mik3y release](https://github.com/mik3y/usb-serial-for-android/releases/tag/3.11.0) |

Capacitor 8.5.0 kräver Node 22 eller senare; projektets Node 24 uppfyller det.
Mallen använder Java 21 och Gradle 8.14.3. Kotlin dokumenterar KGP 2.3.20–2.3.21
som kompatibelt med Gradle 7.6.3–9.3.0 och AGP 8.2.2–9.0.0. Androids tabell
kräver minst AGP 8.13.2/R8 8.13.19 för Kotlin 2.3, vilket motiverar den enda
avsiktliga patchavvikelsen från Capacitors mall-AGP 8.13.0.

Källor:

- [Capacitors template-buildfil](https://raw.githubusercontent.com/ionic-team/capacitor/8.5.0/android-template/build.gradle)
- [Capacitors app-buildfil](https://raw.githubusercontent.com/ionic-team/capacitor/8.5.0/android-template/app/build.gradle)
- [Kotlin Gradle-kompatibilitet](https://kotlinlang.org/docs/gradle-configure-project.html)
- [Androids Kotlin-/R8-kompatibilitet](https://developer.android.com/build/kotlin-support)
- [Gradles Java-kompatibilitet](https://docs.gradle.org/8.14.3/userguide/compatibility.html)

## Kontrollerade checksummor

```text
Gradle 8.14.3 all distribution:
  ed1a8d686605fd7c23bdf62c7fc7add1c5b23b2bbc3721e661934ef4a4911d7c
Gradle 8.14.3 wrapper JAR:
  7d3a4ac4de1c32b59bc6a4eb8ecb8e612ccd0cf1ae1e99f66902da64df296172

AGP 8.13.2 JAR:
  e494f7ce75ca6c1abff301d4a70b18fdd3d6af855875f4f85082bb7608f041de
AGP 8.13.2 POM:
  fc7edba93c5b91ce7267fa7bfdc1fa49422efc633ac279a363e02eb0fd29bcad
AGP 8.13.2 module metadata:
  0aac0bee1a4fc65cd69a6788548a7e21d246250c858017e11e3bf23163cb75a7

Kotlin Gradle Plugin 2.3.21 JAR:
  a549d403ea99a88891f70211d4f737e65b7ae997af23d7f4fece0ae97504e9f6
Kotlin Gradle Plugin 2.3.21 POM:
  6a6e2fe71c9832d0f66be768e20228ce02525149ea92f2742b66125e397a58c9
Kotlin Gradle Plugin 2.3.21 module metadata:
  e04d3a5623cf8dd01fe9c74b9183ee241850298ba8a1dcfd2746f9492df3a6b8

usb-serial-for-android 3.11.0 AAR från JitPack:
  f74032134a4ded3276ccc02bec0d278015bc3c93ef04473b98fbda2771d7e439
Tag commit:
  8e694372dee4531d140766df7af3189d3d9531c5

Temurin 21.0.12+8 macOS arm64 tar.gz:
  021d629349ebc12a409faa517b837ec80ceee8f58a5ac85c788ecad07ca6881c
Android command-line tools 15859902 macOS arm64 zip:
  835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e
```

Wrapperns `distributionSha256Sum` låser distributionen. Den committade
wrapper-JAR:en kontrolleras separat. Gradles strict dependency verification ska
innehålla binär, POM och module metadata för hela lösta grafen; tabellen ovan är
inte i sig en komplett verification-metadata-fil. JitPack-taggen betraktas inte
som immutable trots dokumenterad commit.

Capacitor-paketens registryintegritet bevaras av pnpm-locket. Publicerade SRI:

```text
@capacitor/cli@8.5.0
  sha512-rLdzMUM5QV4WITcqoWv04p32i14BXgUH2diqEH6MWQlWaJfiyNrvOyt/+d5vHAfOxOm1klBu637VDEobctlwBA==
@capacitor/core@8.5.0
  sha512-Ca4krtqH1hothjtBIwf2J2TW7IhYq1ujp8QeItTiJohNsqij8ja2DYYH3DU0l8RmxCWaBAFTGA2TgOgOMCSNsQ==
@capacitor/android@8.5.0
  sha512-Rb3prJeQiTp0pQhSSOReJuG9VgibOGMG4ECs+UhMwr6TCCHZ3NCZO811bDA0HxD0xrT/gCrJAsY5yfEATu84JQ==
```

Den officiella stabila SDK-kanalen rapporterade revision 2 för
`platforms;android-36` vid kontrollen 2026-08-30. Androids SDK-paket identifieras
med package-id och revision eftersom Google
inte publicerar en stabil universell checksumma för en installerad SDK-katalog.
CI ska skriva ut installerade paket och misslyckas om platform 36 saknas.

Capacitor 8.5.0:s vendlade Gradleprojekt deklarerar fortfarande AGP 8.13.0.
Rotbygget använder därför en dokumenterad buildscript-resolution rule som
tvingar 8.13.2 även för `:capacitor-android` och det genererade Cordova-skalet;
nativegrafen får inte samtidigt lösa båda patchversionerna.

## Repositories och licenser

- npm registry: exakta Capacitorversioner; MIT.
- `google()`: AGP och AndroidX; AGP/AOSP-delar Apache-2.0.
- `mavenCentral()`: Kotlin; Apache-2.0 med notices.
- JitPack, content-filtrerad till `com.github.mik3y`: USB-biblioteket; MIT.
- Gradle distribution: Apache-2.0.
- Eclipse Temurin: GPL-2.0 med Classpath Exception.
- Android SDK: [Android SDK License Agreement](https://developer.android.com/studio/terms).

Licenserna granskas för verktyg och adapterberoenden. Inget här tillåter kodreuse
från MeOS eller Oxygen och inget SPORTident-protokoll har härletts.

## Verifikationsgrind

Minsta lokala och CI-baserade nativekontroll är:

```bash
./gradlew --version
./gradlew --write-locks --write-verification-metadata sha256 tasks
./gradlew :otid-usb-serial:testDebugUnitTest
./gradlew :otid-usb-serial:lintDebug
./gradlew :app:assembleDebug
```

Dependency locks och verification metadata ska vara committade;
`--write-locks --write-verification-metadata sha256` är endast
underhållskommandot när ett avsiktligt beroendebeslut fattas. Normala
CI-körningar får inte skriva om dem. `connectedDebugAndroidTest` är en separat
grind när emulator eller fysisk Androidenhet finns.

En godkänd bygg eller JVM-test ändrar inte hårdvarumatrisens `untested`-status.
