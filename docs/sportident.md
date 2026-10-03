# SPORTident-gräns

TASK 001 använder endast syntetiska, normaliserade avläsningar i en simulator.
Ingen riktig USB-, serie-, SPORTident-frame-, CRC- eller kortavkodning ingår och
ingen hårdvarukombination får därför markeras högre än `untested`.

Den framtida kedjan hålls uttryckligen delad:

```text
ByteTransport -> protokollparser -> kortnormalisering -> resultatmotor
```

Simulatorn ersätter de tre första leden men går därefter genom samma HTTP-ingest,
persistens och resultatmotor som en framtida stationsklient. Rå simulatorpayload
märks med transporttypen `simulator`; den får aldrig presenteras som fångade
SPORTident-bytes.

MeOS och Oxygen används inte som kodkälla. All framtida protokollimplementation
kräver egen specifikation, egna anonymiserade captures och testfall för chunkning,
CRC-fel, dubblering och trunkering.

Med "anonymiserade captures" avses separata, härledda fixtures med egen hash och
proveniens. Den privata råcapturen muteras aldrig.

## TASK 002A

Transport- och capturegrunden får nu byggas enligt ADR-0006. Den nya kedjan
stannar fortfarande före protokollparsern:

```text
serieport/Web Serial/Android-kontrakt -> rå capture -> verifierad replay
```

`node-serial` är CLI-adaptern för desktop och ersätter inte `web-serial`.
Captures lagrar både mottagna och sända bytes, monotona tider, riktning,
ursprungliga chunkgränser, markörer och checksummor. Varken en öppningsbar port
eller syntetisk replay får beskrivas som SPORTident-stöd.

## Protokollgrind

ADR-0007 stoppar SPORTident-specifik framing, CRC, DLE, ACK/NAK, probe och
kortavkodning tills den officiella *PC Programmer's Guide*, tydliga
licensvillkor och oberoende testvektorer finns. Publika SPORTident-sidor
bekräftar protokolllägen och vissa baudvärden men definierar inte tillräckligt
för en korrekt parser. Grinden dokumenteras i
`docs/research/sportident-protocol-source-gate.md`.

## TASK 002B: native Androidtransport

`apps/station/android/otid-usb-serial` listar USB-seriedrivers, begär Androids
USB-behörighet, öppnar och konfigurerar vald port, skriver med ändlig timeout
och emitterar råa RX-chunkar samt attach/detach/state/error. Modulen tolkar inte
STX, ETX, DLE, CRC, ACK/NAK, stationskommandon eller kortinnehåll.

Nativeevent använder en global sammanhängande sekvens och
`SystemClock.elapsedRealtimeNanos()`. En full eventkö ger ett explicit terminalt
fel och stängning. Det finns inga VID/PID-filter eller automatisk återanslutning;
sådana val kräver den fysiska inventeringen.

Fake-backend-tester, Android lint och byggda APK:er lämnar samtliga rader i
hårdvarumatrisen på `untested`. Instrumenteringstestet för explicit
Capacitor-registrering är kompilerat men måste köras på emulator eller fysisk
Androidenhet. Permission/open/read/write/detach mot verklig station återstår.
