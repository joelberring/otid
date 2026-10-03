# TASK 006W – acceptanskontroll 2026-09-05

Omfattning: användarens manuella startavprickning med beständig offlineväg,
spårbar ej-start/rättning och privat kvar-i-skogen-lista. Detta är inte
TASK 001 och tillför ingen stafett, GPS, kartvisning eller riktig USB.
Kontrollen gäller syntetisk testtävling och isolerad PostgreSQL, inte driftsättning.

## Krav mot implementation och körd evidens

| TASK-krav | Implementation och verifiering |
| --- | --- |
| 1. Mobil upprop, klassfilter, skrivaktivering, blandade starter | `apps/web/src/checkin/roster-controls.tsx` och `tests/e2e/task-006w-checkin.spec.ts`: FIXED/PUNCH samtidigt, klassfilter och uttryckligt skrivläge. |
| 2. Omarkerad/startat/ej start utan enbart färg | Tre textmärkta åtgärder och separat server-/lokal uppgift i samma komponent; browserprovet läser markeringen även efter offline reload. |
| 3. Spårbar rättning utan historieförlust | `packages/application/src/start-checkin-sync.ts`; journal-/DNS-source-PG-prov visar immutable original och append-only-revisioner. Browserprovet jämför originaloperationer före/efter målrättning och explicit granskning. |
| 4. Två mobiler, retry och motstridiga intents | `packages/application/test/integration/task-006w-sync.test.ts` provar konkurrerande enheter, samtidiga retries och ingest under entrylås. Browserprovet använder två separata kontexter, tappar verkligt commitsvar och jämför byteidentiskt retry. |
| 5. Ingen write med läsroll eller persondata före auth | Device-/sync-integration provar VIEW_START_LIST/fel roll, scope och auth före body. `tests/e2e/task-006w-forest-watch.spec.ts` provar tomt inloggningsskal, privat no-store och döljning efter logout/401. |
| 6. Endast explicit ej start ger DNS; mål rättar; ingen falsk tid/retur | Ren `packages/domain/src/start-checkin-sync.ts` samt dess test; PG provar DNS och riktig readout i båda ordningar. Browserprovet skapar DNS, återtar vid mål och bevarar återkomst mot sen negativ rapport. Klicktid är observation, inte officiell starttid. |
| 7. Beständig kö, reload, tappat svar, återanslutning, beroenden | `checkin-vault.ts`/`checkin-vault-sync.ts`: strict-IDB, CAS, canonical hash och fryst ordnad kö. Nio riktiga IDB-browserprov täcker reload, fel kvittens, abort, korruption och flikkapplöpning. HTTP/PG-browserprovet täcker recovery efter spärr, granskning efter offline reload, upprepade online-events, låsning under committat men fördröjt svar och exakt retry. PG provar avvisad föregångare utan automatisk ombasering. |
| 8. Privat utskrivbar skogslista med osäkerhet och synktid | `forest-watch-report.tsx` samt forest-watch-browserprovet: fem grupper, klassfilter, datatid, enheternas senaste durabla mottagning, mobil/print och tydlig varning att offlineköer är okända. Granskad startad utan återkomst ligger kvar för uppföljning. |

## Kompletterande ADR-krav

- ADR-0049/0053: separat uttrycklig lokal rensning finns nu i mobilvyn.
  Den kräver checkbox och version/CAS, nekar pending eller ogranskade konflikter
  och tar bara vald vault. Browserprov nekar väntande kö, rensar efter recovery,
  verifierar frånvaro efter reload och bevarad serverhistorik. Separat IDB-prov
  tillåter granskad historik först efter uppdaterat roster och bevarar kvittensen
  fram till den uttryckliga lokala rensningen. Ingen verklig tävling rensades.
- ADR-0054: tre appskalsprov täcker privat förberedelse, faktisk cachekontroll,
  offline reload och äldre roster utan reviewmetadata. Appcache innehåller inte
  persondata, credentials, API, RSC eller kartor.
- ADR-0055: återhämtning använder manifestbundet tillfälligt grant, ursprunglig
  actor och samma synkskrivare. PG provar revokering, scope/hash, atomicitet och
  konkurrens; browser provar tappat svar/låsning/reload och ingen plaintexttoken.
- ADR-0056: explicit FINISH-granskning kräver fryst källa, orsak och bekräftelse.
  PG och browser provar stale-underlag, exakt retry och oförändrad originalhistorik.
  Mobilroster begär reviewDetails uttryckligen och lagrar granskningskunskap
  krypterat. Standardroster ändrar inte äldre klienters fältuppsättning.

Terra Medium gjorde en avgränsad read-only-kontroll av krav 1–8. Dess enda
konkreta implementationslucka var rensnings-UI och hantering av granskade
konflikter vid rensning. Huvudagenten åtgärdade och browserverifierade båda.
Exakta slutkommandon och resultat finns i `status.md` under slutacceptans.

## Kvarvarande antaganden, inte utlovat produktionsstöd

- Fysisk mobil, handskar/regn, energisparläge, låg lagringskvot och browserns
  framtida lagringsutrymning är inte fältverifierade. UI visar best-effort-risk.
- Enhetsförlust, bortglömd passfras, raderad browserprofil eller komprometterad
  origin kan inte garanteras återställbara. Låsning raderar aldrig enda lokala kön.
- Produktionens credentialutfärdning, backup/restore och migrationer behöver
  genomföras enligt driftinstruktionerna. Den privata tävlingsdatabasen har inte
  migrerats eller ändrats av detta snitt; ingen riktig Eventor-nyckel användes.
- Skogslistan visar senast känd kunskap, aldrig faktisk position eller garanti
  om att alla kommit tillbaka. Utskrifter måste hanteras som privata kopior.

Nästa minsta vertikala uppgift: ett avgränsat fältprov med två fysiska mobiler,
syntetisk tävling och samma offline–synk–mål–utskriftsflöde. Ingen ny funktion.
