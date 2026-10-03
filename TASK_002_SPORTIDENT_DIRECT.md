# TASK 002 – direkt SPORTident, avgränsad hårdvaruspike

## Syfte

Bevisa en självständig, direkt förbindelse mellan O-Tids stationsklient och verklig SPORTident-hårdvara.

Detta är en teknisk spike. Bygg inte bred tävlingsfunktionalitet samtidigt.

## Förutsättningar som ska dokumenteras

Innan kodning, skapa `docs/research/sportident-hardware-inventory.md` med:

- faktisk stationmodell,
- USB VID/PID,
- firmware,
- tillgängliga SI-bricktyper,
- Androidenhet och Androidversion,
- desktopoperativsystem,
- kablar/OTG-adaptrar,
- om stationen fungerar i Config+ och MeOS.

Skapa en testmatris med status:

```text
untested | transport-open | captured | decoded | field-verified
```

## Licensgrind

Läs `AGENTS.md`.

Studera gärna dokumenterat beteende och kör MeOS parallellt som facit, men kopiera eller porta inte AGPL-kod. Om det visar sig nödvändigt ska spiken stoppas vid ett licensbeslut i stället för att smyga in kod.

## Del 1 – transport

Skapa `packages/device-transport` med:

- `ByteTransport`
- `ReplayTransport`
- `WebSerialTransport`
- Androidtransportens TypeScriptkontrakt

Skapa en minimal Kotlinmodul som:

- listar USB-enheter,
- begär Android USB-behörighet,
- öppnar en serielänk,
- sätter parametrar,
- skickar råa bytes,
- strömmar mottagna bytes,
- rapporterar attach/detach/error,
- aldrig tolkar SPORTident-protokoll.

Använd ett etablerat Android USB-seriebibliotek efter licensgranskning. Lägg dess licens och versionspinning i dokumentationen.

## Del 2 – capture CLI

Bygg:

```bash
pnpm si:ports
pnpm si:capture --port <port> --out <directory>
pnpm si:replay <session.json>
```

En session ska innehålla:

- rå binär ström,
- monotona tidsstämplar,
- ursprungliga chunkgränser,
- transportmetadata,
- manuella markörer som "card inserted" och "card removed",
- SHA-256.

Lägg inte verkliga personnamn i Git.

## Del 3 – frame parser

Skapa en streamingparser i `packages/sportident-protocol`.

Krav:

- godtyckliga chunkgränser,
- flera ramar i samma chunk,
- brus före ram,
- ofullständig ram,
- timeout,
- ACK/NAK,
- STX/ETX,
- DLE/escaping där relevant,
- längd,
- CRC,
- rå okänd frame som explicit typ.

Använd property-/fuzztester för chunkning.

## Del 4 – station probe

Implementera minsta protokoll för att:

- öppna station,
- prova relevanta baudlägen,
- läsa stationsinformation,
- rapportera protokolläge,
- nå `READY`,
- återhämta sig efter urkoppling.

Exakta kommandon ska dokumenteras i en självskriven protokollnot med bytefält och källhänvisning.

## Del 5 – en riktig korttyp

Välj den korttyp som faktiskt finns tillgänglig och är enklast att verifiera, sannolikt SI-Card 10, 11 eller SIAC.

Implementera:

- detektion,
- blockläsning,
- kortnummer,
- check/start/finish,
- kontrollstämplingar,
- tider,
- antal stämplingar,
- batteridata om station/kort ger den,
- normalisering till `NormalizedCardReadout`.

Spara alltid rå frame före normalisering.

## Del 6 – stationsdemonstrator

En enkel sida ska visa:

- transportstatus,
- stationsinfo,
- protokollstatus,
- rå frame count,
- senaste kortnummer,
- normaliserade stämplingar,
- parserfel,
- export av capture.

Ingen resultatberäkning behöver läggas här om Task 001-domänen redan kan ta emot normaliserad avläsning; koppla då in den genom befintligt ingest.

## Obligatoriska tester

- varje möjlig chunkdelning av alla golden frames,
- trasig CRC,
- avklippt frame,
- dubblerad frame,
- brus,
- två frames i samma chunk,
- urkoppling mitt i läsning,
- återanslutning,
- replay ger identiskt resultat varje gång,
- minst tre separata verkliga captures av samma korttyp,
- jämförelse mot MeOS/Config+ för kortnummer och samtliga stämplingar.

## Definition av lyckad spike

Spiken är lyckad först när:

1. en verklig station öppnas direkt,
2. en verklig bricka läses utan mellanprogram,
3. samma capture kan återspelas deterministiskt,
4. alla stämplingar matchar kontrollfacit,
5. ingen data går förlorad vid appomstart efter capture,
6. kvarvarande risker och korttyper är dokumenterade.

Codex får inte skriva "SPORTident stöds" om bara simulatorn fungerar.
