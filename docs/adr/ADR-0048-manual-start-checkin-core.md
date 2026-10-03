# ADR-0048: Separat versionsstyrd manuell startavprickning

- Status: Accepterad för domänregeln; lagring, transport och UI återstår
- Datum: 2026-09-05

Uppdatering: ADR-0049 ersätter förbudet mot DNS-resultatföljd efter
användarens uttryckliga förtydligande. Den rena regeln nedan behålls; dess
operativa rapport är fortsatt inte i sig ett lagrat ResultOutcome.

## Kontext

TASK 006W behöver manuell mobil avprickning utan automatisk
SPORTident-startsignal. Befintlig VIEW_START_LIST är read-only. Varken en tom
checkbox eller en startnotering är en råavläsning eller officiellt resultat.

## Beslut

Inför en ren regel i packages/domain som planerar en enda explicit ändring
för exakt race/entry och förväntad avprickningsrevision:

- UNMARKED: inget aktuellt avprickningsbesked; initial revision 0.
- STARTED: startpersonalen rapporterar start.
- REPORTED_NOT_STARTED: startpersonalen rapporterar ej start; inte resultat-DNS.

Alla tre kan uttryckligen ändras till varandra. Att återställa till UNMARKED
efter en tidigare markering är en ny revision, aldrig borttagen historik.
Samma aktuella värde ger UNCHANGED. Fel scope eller stale revision ger konflikt,
även om önskat värde råkar vara lika. Version får inte overflowa int32.

Regeln läser ingen klocka, auth, databas eller nät. Den beräknar ingen starttid,
skogskontroll eller resultatstatus och muterar inget input. Inga typer i
EvaluationResult/ResultOutcome eller stationens rådatakontrakt ändras.

Kommande application-service måste först validera aktör, race/entry och
rostergrund samt låsa den aktuella avprickningsrevisionen. Den ska journalföra
ändringen append-only med request-id, aktör och mottagningstid i samma
transaktion. Exakt requestretry ska läsas före regeln; UNCHANGED får inte
användas som ersättning för en korrekt idempotensjournal.

UI:s aktivering av checkboxläge ger ingen behörighet. Separat skrivcapability
krävs före någon endpoint införs. Publika listor och resultat påverkas inte.

## Öppet men inte blockering av den rena regeln

Mobilens krav på nätoberoende drift är ännu inte klarlagt. Ingen lokal
persistens, credentiallagring, migrationsmodell eller HTTP-design beslutas
här. Ett offlinekrav ska uppfyllas med beständig kö och explicit kvittens,
inte genom att kalla den rena regeln eller en minneskö offlineklar.

Avgränsningen är en byggsten i TASK 006W, inte ett färdigt vertikalt snitt.
Återkomstprojektion, samtidighet i PostgreSQL och användarflöde behöver fortsatt
implementation och acceptans innan uppgiften kan markeras klar.

## Tester

Samtliga tillståndsövergångar, initialt tillstånd, stale och cross-scope,
ogiltiga revisioner/UUID/statusar, revisionsoverflow och oföränderligt input.
Ingen dependency eller databasmigration införs i detta steg.
