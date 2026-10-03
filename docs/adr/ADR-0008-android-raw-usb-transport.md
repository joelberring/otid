# ADR-0008: Androids råa USB-serietransport

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

TASK 002 kräver en liten Kotlinmodul som listar USB-enheter, begär behörighet,
öppnar och konfigurerar serieport, flyttar råbytes och rapporterar
attach/detach/error. Den får aldrig tolka SPORTident-protokoll.

Det befintliga TypeScriptkontraktet är JSON-säkert i stort men lämnar
integrationsrisker: Kotlin `Long` ryms inte alltid i JavaScripts säkra heltal,
native-genererat anslutnings-ID kan ge race mellan Promise och eventkanal,
flerportsenheter saknar portindex, konfigurationen kan vara ofullständig och
native-events runtimevalideras inte.

## Beslut

Den framtida Kotlinmodulen ska ligga i `apps/station/android` och använda exakt
`com.github.mik3y:usb-serial-for-android:3.11.0` som enda USB-seriedriver.
Biblioteket får endast finnas i native-I/O-lagret. `packages/device-transport`
förblir ren TypeScript och äger wire-kontrakt, runtimevalidering och den
konkreta `AndroidUsbTransport`-adaptern.

Wire-kontraktet ändras innan nativekod ansluts:

- `nativeSequence` är en positiv decimalsträng, precis som monoton nanosekundtid,
- klienten skapar ett unikt `connectionId` och skickar det i `open`,
- varje descriptor anger tillgängliga `portIndexes` och `open` väljer ett,
- `open` bär fullständigt materialiserade serieparametrar utan native-defaults;
  detta snitt stöder 7/8 databitar, 1/2 stoppbitar, none/even/odd parity och
  endast `flowControl: "none"`,
- varje write bär en explicit, positiv `writeTimeoutMs`; Kotlin får inte använda
  en obegränsat blockerande write,
- okänd, ogiltig eller stale wiredata ger explicit transportfel,
- detach- och state-events för en vald anslutning måste bära dess aktiva
  `connectionId`; device-level detach berikas av native innan eventet skickas,
- listener registreras före permission/open och främmande connection-events
  filtreras.

Spiken tillåter en aktiv anslutning. `plugin.open()` resolve är den
auktoritativa commitpunkten och får ske först när porten är fysiskt öppnad och
konfigurerad; state-events är observationer. Bytes som native redan tagit emot
före commit måste buffras och levereras efter commit, inte tappas. Skrivningar
serialiseras och kvitteras först när native har skrivit hela byteföljden.
Read-buffer kopieras omedelbart.
Attach, detach, state och bytes går genom en serialiserad nativekö som tilldelar
total eventordning och `SystemClock.elapsedRealtimeNanos()`. Overflow ska ge ett
explicit fel och stängning; byteförlust får inte döljas.

Native permission, device/port-val, attach/detach och resursägande är
adapteransvar. Den anslutningsbundna `AndroidUsbTransport` får inte ensam bära
appens framtida attach/reconnect-flöde; en separat discovery/lifecycle-yta i
stationsappen ska äga enhetslistning och attach när native modulen byggs. Inga
VID/PID-filter hårdkodas före fysisk inventering. Inga råbytes, serienummer
eller tolkade kortdata loggas.

## Bibliotek och supply chain

`usb-serial-for-android` 3.11.0 är MIT-licensierat. Taggens commit är
`8e694372dee4531d140766df7af3189d3d9531c5`. Vid granskningen hade JitPack-AAR
SHA-256 `f74032134a4ded3276ccc02bec0d278015bc3c93ef04473b98fbda2771d7e439`.

När Gradlemodulen skapas ska JitPack begränsas till gruppen `com.github.mik3y`.
Dependency verification och SCA ska omfatta AAR, POM/Gradle-metadata och hela
den transitiva grafen, inte bara AAR-checksumman. MIT-text/copyright ska följa
med tredjepartsnotiser. Release-taggen ensam betraktas inte som en immutable
supply-chain-garanti.

## Toolchaingrind

Native implementation räknas inte som verifierad innan den byggts med pinnade
versioner av Capacitor, Android Gradle Plugin, Gradle, JDK och Android SDK.
Minimikontroller är `test`, Android lint och `assembleDebug`; plugin-wire och
livscykel kräver dessutom instrumenterat test. Fysisk permission/open/read/
write/detach/reconnect kräver inventerad Androidenhet, kabel och station.

Den nuvarande utvecklingsvärden saknar JDK, Gradle, Android SDK, `adb`, emulator
och Kotlin compiler. TypeScriptadaptern kan därför implementeras och verifieras
nu, medan nativekoden förblir nästa separata del av TASK 002.

## Konsekvenser

- Wire-race och heltalsöverskridande löses före Kotlinintegration.
- TypeScriptadapter och validering kan fuzz-/enhetstestas utan Android.
- Native dependency hålls borta från webb-, transport- och protokollpaket.
- Varken ett fake plugin eller en lyckad Androidbuild höjer en hårdvarurad över
  `untested`; endast test med faktisk utrustning kan göra det.
