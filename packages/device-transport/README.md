# `@o-tid/device-transport`

Rå byte-transport för O-Tid. Paketet känner inte till SPORTident-ramar,
bricknummer, kontroller eller resultat och utför ingen fil-, nätverks- eller
native-I/O i capturevalidatorerna.

## Transportkontrakt

`ByteTransport` har följande `kind`:

- `android-usb`
- `web-serial`
- `node-serial`
- `tcp`
- `replay`

`onBytes` levererar en ny `Uint8Array` till varje lyssnare. En lyssnare kan
alltså inte mutera data för en annan. `onState` anropar lyssnaren omedelbart med
aktuell state och levererar sedan serialiserbara, diskriminerade events:
`opening`, `open`, `closing`, `closed`, `detached` och `error`. Initial state är
`closed/initial`. Funktionen som returneras av båda prenumerationerna kan
anropas flera gånger utan bieffekt. `open()` är idempotent när transporten redan
är `open`.

## Capture v1

Ett inläst `LoadedCaptureV1` består av manifestobjektet, exakta bytes för
`capture.wal.ndjson`, `traffic.bin` och `timeline.ndjson`. WAL och timeline har
samma sammanhängande sekvens från 1 och innehåller en strikt union:

```ts
type CaptureEvent =
  | {
      type: "bytes";
      sequence: number;
      direction: "rx" | "tx";
      monotonicTimeUs: number;
      // WAL: bytesBase64
      // timeline: offset, length, sha256
    }
  | {
      type: "marker";
      sequence: number;
      monotonicTimeUs: number;
      marker: "card-inserted" | "card-removed" | "cable-detached";
    };
```

Fritext finns avsiktligt inte i markörformatet. Manifestet anger transportens
kind och fullständiga serieparametrar, om capturen är syntetisk, slutstatus,
event-/byte-/markörantal
och SHA-256 för alla artefakter. `validateCaptureBundleV1` verifierar manifest,
artefakthashar, ordning, tidsordning, intervall, chunkhashar och att WAL,
timeline och `traffic.bin` beskriver exakt samma data.

`createCaptureManifestV1`, NDJSON-serialiserarna, base64-funktionerna och
`sha256Hex` är rena och kan användas av `apps/si-tools`. Skrivaren ansvarar
fortfarande för filrättigheter, fsync och atomiskt namnbyte enligt ADR-0006.

## Replay

`ReplayTransport` validerar hela bundlen i `open()` innan en byte kan skickas.
Standardläget skickar alla `rx`-chunkar omedelbart med ursprungliga
chunkgränser. Recorded-läget tar en injicerad `ReplayScheduler`; delay anges i
mikrosekunder relativt capturefilens första event. `close()` avbryter alla
schemalagda callbacks.

Skrivningar matchas som standard exakt mot inspelade `tx`-chunkar i ordning.
`writeMode: "ignore"` finns för rena uppspelningskonsumenter.

## Web Serial

`WebSerialTransport` tar en redan vald `WebSerialPortLike`. UI:t äger därmed
behörighetsdialogen medan paketet äger read-loop, bytes, write-lås och städning
med `cancel`, `releaseLock` och `close`. Lokala strukturella typer används i
stället för experimentella globala browserdeklarationer. `close()` väntar in
redan accepterade writes. Om den fysiska porten inte kan stängas avvisas anropet
och aktuell state förblir `error`; ett falskt rent `closed` skickas inte.

Android-transporten (Capacitor) togs bort i steg 23; `android-usb` finns kvar som `kind` så att äldre
capturefiler går att läsa.
