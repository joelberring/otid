# O-Tid SI transportverktyg

Detta Node-skal implementerar endast portinventering, rå bytecapture och
verifierad replay enligt ADR-0006. Det tolkar inte SPORTident-protokoll och ett
lyckat kommando är inte bevis för SPORTident-stöd.

## Kommandon

```bash
pnpm si:ports
pnpm si:capture --port /dev/cu.example --baud 38400 --out /säker/privat/katalog
pnpm si:replay /säker/privat/katalog/<session>/session.json
```

`si:ports` listar men öppnar eller proberar aldrig portar. Standardutdata är
avsiktligt begränsad till path, VID, PID och manufacturer; stabila serienummer,
PnP-ID och fysisk location exponeras inte. `si:capture` kräver explicit baudrate;
verktyget gissar inte stationsläge. Output inne i repositoryt avvisas om inte
`--allow-repository-output` anges uttryckligen.

Manifestet lagrar de faktiskt använda serieparametrarna: baudrate, åtta
databitar, en stoppbit, ingen paritet och ingen flödeskontroll.

Under capture kan stdin endast innehålla någon av följande markörkoder, en per
rad:

```text
card-inserted
card-removed
cable-detached
```

Fri text och personuppgifter accepteras inte som markörer. Terminalen skriver
aldrig råbytes.

## Beständighet och integritet

Varje capture börjar i en unik privat `<session>.partial`-katalog. Varje bytechunk
skrivs fullständigt som base64 till `capture.wal.ndjson` och synkas innan
skrivningen kvitteras. `traffic.bin` och `timeline.ndjson` återbyggs från WAL:en.
`session.json` är commitmarkören och innehåller SHA-256 för alla tre artefakter.
Katalogen byter därefter atomiskt namn till `<session>` utan att befintlig output
skrivs över.

`si:replay` läser bara kompletta `session.json`-sessioner. Hela bundlen valideras
mot `@o-tid/device-transport` före första RX-chunk emitteras. TX-chunkar bevaras
som evidens men emitteras inte som mottagna bytes. Sammanfattningen är
deterministisk och innehåller endast antal och hashar.

En avbruten `.partial`-session kan återställas med den exporterade
`recoverPartialCapture`-funktionen. Återställningen använder det längsta
radavslutade WAL-prefix som hela formatvalidatorn godkänner. En trunkerad eller
ogiltig svans bevaras byte-exakt och privat i `capture.wal.quarantine.bin`, med
längd och SHA-256 i `capture.wal.quarantine.json`. Båda katalogposterna synkas
innan WAL:en ersätts. Svansen tolkas aldrig som en fullständig post och ingen
förlorad chunkgräns gissas.

Riktiga captures kan innehålla pseudonyma brickidentiteter och ska förbli privata
tills de har granskats. Råcapture får inte muteras för anonymisering; skapa i så
fall ett separat härlett artefakt med egen proveniens och hash.
