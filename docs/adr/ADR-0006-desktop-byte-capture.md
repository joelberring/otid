# ADR-0006: Desktoptransport och beständigt råcaptureformat

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

TASK 002 kräver ett Node-baserat CLI för att lista serieportar och fånga råa
bytes. CODEX_BRIEF:s befintliga `ByteTransport.kind` räknar upp Android USB,
Web Serial, TCP och replay, men ingen vanlig desktopprocess. Web Serial är ett
webbläsar-API och kan därför inte bära `pnpm si:capture` i Node.

Transportlagret får inte känna till SPORTident-ramar, brickor, kontroller eller
resultat. Capture måste bevara bytes, riktning, ursprungliga chunkgränser och
monoton tid även om processen avbryts. Verkliga captures kan innehålla
brickidentiteter och ska behandlas som privata tills de granskats.

## Beslut

`ByteTransport.kind` utökas med `node-serial`. Detta är en adapterutvidgning,
inte en ändring av domängränsen:

- `packages/device-transport` äger kontrakt, `ReplayTransport`,
  `WebSerialTransport` och Androidtransportens TypeScriptkontrakt,
- `apps/si-tools` äger Node-adaptern och CLI:t,
- `serialport` 13.0.0 används endast i Node-adaptern och versionspinnas exakt,
- protokolltolkning och kortnormalisering ingår inte i detta steg.

Captureformat version 1 består av:

```text
<session>.partial/
  session.partial.json
  capture.wal.ndjson
  traffic.bin
  timeline.ndjson

<session>/
  session.json
  capture.wal.ndjson
  traffic.bin
  timeline.ndjson
```

WAL-posten innehåller följdnummer, riktning, monoton mikrosekundtid och bytes i
base64. Den fsyncas innan `recordChunk` kvitteras. Även den nya partial-katalogens
förälder synkas innan capturestart kvitteras. `traffic.bin` och
`timeline.ndjson` byggs deterministiskt från WAL:en, så en avbruten session kan
återställas utan att gissa chunkgränser. Slutmanifestet innehåller byte- och
händelseantal, fullständiga serieparametrar (baud, databitar, stoppbitar, paritet
och flödeskontroll) samt SHA-256 för artefakterna. Manifestet skrivs via temporär
fil och atomiskt namnbyte; därefter byter sessionskatalogen namn från `.partial`.

Recovery använder endast det längsta newline-avslutade WAL-prefix som hela
capturevalidatorn godkänner. En avklippt eller ogiltig suffix gissas aldrig utan
bevaras byte-exakt som privat `capture.wal.quarantine.bin` med längd och SHA-256
i `capture.wal.quarantine.json`. Båda filerna och katalogposterna synkas innan
den validerade WAL:en ersätts atomiskt med prefixet. Tillsammans bevarar de exakt
originalinnehållet.

Nya kataloger skapas med behörighet `0700` och filer med `0600`. Befintliga
utdata skrivs inte över. Replay verifierar schema, ordning, offset, längd och
checksummor före första byte och emitterar bara mottagna (`rx`) chunkar till
`onBytes`; sända (`tx`) chunkar bevaras som captureevidens.

`si:capture` kräver en explicit `--baud`; verktyget får inte smyga in ett
odokumenterat stationsantagande. Verkliga captures nekas inne i repositoryt om
operatören inte uttryckligen anger att detta är avsiktligt. Råcapture muteras
aldrig för anonymisering; en granskad fixture är i så fall ett separat härlett
artefakt med egen hash och proveniens.

Alla `ByteTransport`-implementationer rapporterar aktuell state direkt vid
prenumeration, börjar i `closed/initial` och behandlar `open()` på en redan öppen
transport idempotent. Androidgränsen är ett JSON-säkert Capacitor-wire-kontrakt
med anslutnings-ID, base64-bytes, native sekvens/tid samt attach/detach-events;
ingen Kotlinimplementation ingår i detta snitt.

## Licens

`serialport` 13.0.0 och dess repository anger MIT. Versionen kräver Node 20 eller
senare och använder en separat native binding. Projektet tillåter endast det
specifika byggsteget för `@serialport/bindings-cpp`; inget generellt tillstånd
för godtyckliga install scripts införs. Ingen MeOS- eller Oxygenkod används.

## Konsekvenser

- Desktop-CLI:t blir testbart utan SPORTident genom replay och mocktransport.
- En verklig port kan listas och öppnas när hårdvara finns, men implementationen
  i sig höjer ingen station/kort-kombination över `untested`.
- WAL dubbellagrar bytes tills en uttrycklig retentionändring beslutas; detta är
  en accepterad kostnad för enkel återställning i spiken.
- Parser, CRC, probe, Android-Kotlin och kortavkodning är separata senare snitt.
- Native binding måste verifieras per stödd OS/arkitektur innan fältpåstående.
