# TASK 005B – lokal resultatmotor och operativ stationsvy

## Syfte

Gör TASK 005A:s signerade paket och beständiga kö användbara under ett verkligt
nätavbrott, fortfarande utan SPORTident-protokoll:

> Androidstationen ska kunna läsa tillbaka sitt aktiva verifierade paket, spara
> en simulatornormaliserad avläsning, köra exakt projektets rena resultatmotor,
> spara den lokala bedömningen och därefter visa ett stort svenskt besked samt
> kritisk stationsstatus.

Servern är fortsatt auktoritativ. Den lokala bedömningen är ett versionsmärkt
operatörsbesked och får inte ersätta serverns resultatrevision.

## Leverabler

- read-only native API för aktivt pakets verifierade payloadbytes,
- kontroll av payloadhash vid varje återläsning,
- direkt återanvändning av `evaluateCardReadout` från `packages/domain`,
- fail-closed för lokal bedömning när paketets motorversion inte matchar appens,
- rå/normaliserad outboxpost committad före varje evalueringsförsök,
- separat append-only lagring av lokal bedömning när den lyckas,
- additiv SQLite-migration från version 1 till 2 utan omskrivning av gamla
  paket eller outboxposter,
- operativ svensk stationsvy med internetstatus, uttrycklig hårdvarustatus,
  paketversion, avlästa, kvitterade, avvisade och väntande poster,
- stor lokal OK/MP/okänd-bricka-yta som visas först efter beständig lagring,
- minimal browserbundle för Capacitors befintliga `www`-skal,
- tester för motorparitet, versionsgrind, persistensgräns och statusmodell.

## Dataflöde

1. Operatören installerar ett paket via TASK 005A:s token- och SPKI-bootstrap.
2. Native lagret läser aktiv `payload_bytes` och jämför SHA-256 med den
   append-only lagrade hashen innan bytes lämnas till TypeScript.
3. TypeScript runtimevaliderar paketet och simulatorinputen.
4. Simulatorpayload och innehållshash enligt befintligt ingestkontrakt
   (`SHA-256(JSON.stringify(payload))`) committas till outboxen med en ny sekvens.
5. Om motorversionen matchar körs `evaluateCardReadout` från `packages/domain`.
6. Motorversion, snapshotversion, pakethash och `EvaluationResult` läggs till i
   en separat append-only lokal bedömningsrad knuten till outboxsekvensen.
7. Först efter steg 6 visas ett resultat. Fel i steg 5–6 lämnar steg 4 intakt.

## Acceptanstester

1. Samma readout och snapshot ger samma domänutfall lokalt som ett direkt anrop
   till den delade motorn.
2. En annan `resultEngineVersion` ger inget lokalt resultat men outboxposten
   finns kvar.
3. Okänd bricka, MP och OK lagras med stabila koder och visas på svenska utan
   att domänpaketet översätter dem.
4. Fel vid enqueue lämnar ingen sekvensökning. Fel vid lokal bedömning lämnar
   den redan committade outboxposten orörd och utan fabricerat resultat.
5. Aktiv payload återläses efter databasomstart; hashfel avvisas.
6. Migration 1→2 behåller äldre paket, identitet och köposter. Äldre poster utan
   lokal bedömning kan fortfarande synkroniseras.
7. Vyn visar internet, hårdvara, paketversion och köstorlek med text/ikon utöver
   färg och har stora tryckytor.
8. Bearer-token och betrodd SPKI sparas inte i localStorage eller SQLite av UI:t.
9. Stationsbundle byggs reproducerbart och kopieras till Androidappen.

## Berörda delar

- `packages/domain` för en smalare, fortsatt ren evalueringsinput,
- `packages/contracts` för strikt simulator- och lokalt bedömningskontrakt,
- `apps/station/src`, `apps/station/ui` och `apps/station/www`,
- `apps/station/android/otid-station-store`,
- `docs/architecture.md`, `docs/offline-sync.md`, `docs/acceptance-tests.md`,
  `docs/status.md`,
- ADR-0012.

Ingen PostgreSQL-migration krävs.

## Ingår inte

- serveruppladdning eller konfliktjämförelse mellan lokal och central bedömning,
- QR-parning, tokenrotation eller produktionsautentisering,
- SPORTident-parser, probe, kortnormalisering eller fysisk USB,
- nya resultatregler, manuell juryhantering eller resultatrevision lokalt,
- stafett, GPS, kartor, Eventor eller speaker.
