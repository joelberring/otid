# ADR-0173: Storstädning – ett statusflöde, en session, ingen tävlingsversionsgrind

Status: beslutad 2026-10-18 av ägaren (Joel). Kompletterar ADR-0168 och ADR-0169.

## Bakgrund

Granskningen 2026-10-18 visade att applikationslagret bär maskineriet från
tiden före omstarten: en journaltabell, ett kontrakt, ett cookie-par och en
"återtagande"-tvilling per administrativ åtgärd (64 av 114 tabeller), tre
sessionsnivåer under namnet från den borttagna stationsparningen, en
tävlingsversion som bumpas på 25 ställen och ger "conflict" i öppna formulär,
och omkring 10 000 rader kod som ingenting anropar.

## Beslut

1. **Ett statusflöde.** En tjänst `setEntryStatus` tar emot beslut (ej start,
   struken, disk, utom tävlan, utan tidtagning, godkänn manuellt, ändrad
   start-/sluttid) och lägger till en ny `result_revision` med orsak, aktör
   och begärans-id (idempotens). Återtagande är en ny revision. Besluts- och
   återtagandetabellerna tas bort. Revisioner skrivs fortfarande aldrig över.
2. **Underlag per löpare, inte tävlingsversion.** `expectedSnapshotVersion`
   tas bort ur adminåtgärder. Tävlingsversionen behålls bara för
   avläsningspaketet.
3. **En session.** Kontosessionen och rollen på tävlingen räcker.
   `pairing_admin_*`, delegationer och capability-listan tas bort.
4. **Ett skrivställe.** `appendResultRevision` och `evaluateAndStore` är de
   enda som skriver revisioner. En säkerhetspolicy. Ett suffix.
5. **Död kod tas bort**, migrationerna slås ihop till en baslinje (ingen
   produktionsdata, ADR-0168 beslut 6), och referensdokument som beskriver
   det gamla systemet arkiveras.

## Konsekvenser

- Mycket färre tabeller, rutter och kontrakt. Playwright-flödena är
  specifikationen: de ska passera oförändrade.
- Historik visas från revisionerna. Audit-händelser behålls.
