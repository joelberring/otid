# Android USB-seriebibliotek

- Granskat: 2026-08-30
- Val: `mik3y/usb-serial-for-android` 3.11.0

## Primärkällor

- [Officiellt repository och README](https://github.com/mik3y/usb-serial-for-android)
- [Release 3.11.0](https://github.com/mik3y/usb-serial-for-android/releases/tag/3.11.0)
- [Versionerad buildfil](https://raw.githubusercontent.com/mik3y/usb-serial-for-android/3.11.0/usbSerialForAndroid/build.gradle)
- [Versionerat port-API](https://raw.githubusercontent.com/mik3y/usb-serial-for-android/3.11.0/usbSerialForAndroid/src/main/java/com/hoho/android/usbserial/driver/UsbSerialPort.java)
- [MIT-licens](https://raw.githubusercontent.com/mik3y/usb-serial-for-android/3.11.0/LICENSE.txt)
- [Android USB Host](https://developer.android.com/develop/connectivity/usb/host)

Biblioteket ger rå `read`, `write`, `setParameters`, portöppning och drivers för
bland annat FTDI, PL2303, CP210x, CH34x och CDC/ACM. Appen ansvarar själv för
USB-enumereringens val, användarbehörighet och attach/detach-livscykel. Det är
den ansvarsfördelning O-Tids transportgräns kräver.

Version 3.11.0 publicerades 2026-07-18, använder minSdk 17, compile/target SDK 35
och Java 8 i bibliotekets egen build. O-Tids slutliga app-minSdk och targetSdk
ska beslutas tillsammans med Capacitor-/Androidtoolchain, inte ärvas tyst.

## Versions- och licenslås

```text
group/artifact: com.github.mik3y:usb-serial-for-android
version:        3.11.0
tag commit:     8e694372dee4531d140766df7af3189d3d9531c5
JitPack AAR SHA-256:
                f74032134a4ded3276ccc02bec0d278015bc3c93ef04473b98fbda2771d7e439
license:        MIT
```

JitPack ska content-filtreras till `com.github.mik3y`. Gradle dependency
verification och SCA ska kontrollera AAR, POM/Gradle-metadata samt alla
transitiva artefakter; AAR-hashen ensam är inte ett komplett supply-chain-lås.
MIT-texten och copyright för Google Inc. och Mike Wakerly ska bevaras i
distributionens tredjepartsnotiser.

## Adapterregler

- Använd direkt `port.write` på dedikerad kö så Promise betyder fullbordad write.
- Använd wire-anropets explicita, ändliga `writeTimeoutMs` i Kotlin;
  detach/error får inte blockeras obegränsat av en write.
- Kopiera varje mottagen `ByteArray` före base64-kodning.
- `ACTION_USB_DEVICE_DETACHED` stoppar reader och stänger resurser exakt en gång.
- Kräv `android.hardware.usb.host`; I/O sker aldrig på UI-tråden.
- Hårdkoda inte VID/PID innan den faktiska stationen inventerats.
- Begränsa detta snitt till `flowControl: "none"`; upstreams skilda RTS/CTS-,
  DTR/DSR- och XON/XOFF-lägen får inte döljas bakom ett tvetydigt `hardware`.
- Biblioteket transporterar bytes; all SPORTident-framing ligger kvar bakom
  ADR-0007:s källgrind.

Det äldre alternativet `felHR85/UsbSerial` valdes bort: senaste release 6.1.0
är från 2019 och dess publicerade Androidkonfiguration är väsentligt äldre.
