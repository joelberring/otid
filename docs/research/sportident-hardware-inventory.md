# SPORTident-hårdvaruinventering

- Inventeringstid: 2026-08-30, Europe/Stockholm
- Status: ofullständig; ingen SPORTident-enhet var ansluten vid inventeringen

## Faktiskt observerad utvecklingsmiljö

| Egenskap | Observerat värde | Evidens |
|---|---|---|
| Desktop | Apple Silicon (`arm64`) | `uname -m` |
| Operativsystem | macOS 26.5.1, build 25F80 | `sw_vers` |
| Synliga serieportar | `/dev/cu.Bluetooth-Incoming-Port`, `/dev/cu.debug-console` | lokal portinventering |
| SPORTident USB-enhet | Ingen synlig | `system_profiler SPUSBDataType` och `/dev/cu.*` |

`pnpm si:ports` kördes också med native `serialport` 13.0.0 på Node 24.11.1.
Kommandot avslutade med exitkod 0, rapporterade samma två generiska macOS-portar
och angav uttryckligen `opened: false`, `probed: false` och
`sportidentSupportClaimed: false`.

## Uppgifter som måste fyllas med fysisk utrustning

| Uppgift | Värde |
|---|---|
| Stationmodell | Okänd – inte tillhandahållen/ansluten |
| USB VID/PID | Okänd |
| Firmware | Okänd |
| Tillgängliga SI-bricktyper | Okända |
| Androidenhet | Okänd |
| Androidversion | Okänd |
| USB-/OTG-kablar och adaptrar | Okända |
| Fungerar i Config+ | Ej verifierat |
| Fungerar i MeOS | Ej verifierat |

Inga värden får gissas från produktnamn eller syntetiska fixtures. Modeller,
firmware och VID/PID ska läsas från den faktiska enheten eller ett kontrollerat
inventeringsunderlag innan teststatus höjs.

## Testmatris

Tillåtna statusvärden är `untested`, `transport-open`, `captured`, `decoded` och
`field-verified`.

| Station | Firmware | Korttyp | Plattform | Status | Evidens/notering |
|---|---|---|---|---|---|
| Okänd | Okänd | Okänd | macOS 26.5.1 arm64 | untested | Ingen SI-enhet ansluten 2026-08-30 |
| Okänd | Okänd | Okänd | Android, modell/version okänd | untested | Ingen Androidinventering tillgänglig |

## Grind före statusändring

- `transport-open`: port, VID/PID, modell, firmware och öppningslogg finns.
- `captured`: rå `.bin`, manifest, chunkgränser, monotona tider och SHA-256 finns.
- `decoded`: egen parser/normalisering reproducerar alla fält mot kontrollfacit.
- `field-verified`: verkligt fälttest och jämförelse mot oberoende facit finns.

Personnamn får inte ingå i serie- eller captureloggar. En råcapture är privat och
immutabel. Den får inte anonymiseras genom mutation; endast en separat härledd
fixture med egen hash, proveniens och granskat innehåll får eventuellt läggas i
Git.
