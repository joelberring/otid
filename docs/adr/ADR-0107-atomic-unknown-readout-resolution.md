# ADR-0107: atomisk lösning av en vald okänd avläsning

- Status: Accepterad för TASK085
- Datum: 2026-09-19

## Kontext

När servern saknar aktiv brickkoppling sparas råmeddelandet, den normaliserade
avläsningen och det första serverutfallet `UNKNOWN_CARD`, men ingen
`ResultRevision` skapas. Historiken visar avläsningen utan deltagare. En
operatör vid mål behöver kunna rätta detta utan att förlora den ursprungliga
observationen.

Nuvarande brickbyte och individuella omräkning är två separata kommandon.
Omräkningen hittar senaste avläsning för ett bricknummer och kan därför inte
användas för att sanningsenligt garantera att en viss vald okänd avläsning
bedöms. Att kedja två HTTP-skrivningar lämnar dessutom ett mellanläge vid
nätfel.

## Beslut

TASK085 inför en egen racebunden, idempotent `MANAGE_RACE`-writer med en
explicit `readoutId`. Den utför i en PostgreSQL-transaktion, med låsordningen
autentisering -> race `FOR UPDATE` -> target-entry -> request-advisory lock:

1. verifiera att exakt den valda normaliserade avläsningen hör till loppet och
   dess bevarade första serverutfall fortfarande är `UNKNOWN_CARD`;
2. verifiera att requestens bricknummer är avläsningens bricknummer;
3. välj en befintlig Entry eller skapa en enkel ny Entry med exakt Class,
   namn och frivillig klubb, inklusive befintlig kapacitetskontroll;
4. skapa eller återaktivera den enda lagliga aktiva brickkopplingen för entryn;
5. bygg den nya sammanhängande snapshoten och kör den rena resultatmotorn mot
   **just den valda** avläsningen;
6. append:a exakt en ny publicerad resultatrevision med en särskild,
   sanningsenlig resolutionsorsak samt en immutable requestjournal och audit.

Det ursprungliga råmeddelandet, `card_readout` och första
`device_ingest_outcome` förblir `UNKNOWN_CARD`. Journalen är den uttryckliga
förbindelsen från den historiska avläsningen till den senare beslutade
brickkopplingen och revisionen; den ändrar inte den första tekniska
observationen. Replay med samma actor/race/fullständiga intent returnerar samma
kvittens. Ändrad readout, deltagare, registreringsuppgifter, bricka eller
förväntad grund ger konflikt utan delskrivning.

## Gränser

Detta är ett måloperatörsflöde, inte ett sätt att skapa eller skriva om
råstämplingar. En senare avläsning med samma bricknummer får aldrig väljas i
stället för requestens `readoutId`. Inget automatiskt DNS, ingen massomräkning,
ingen ändring av tidigare resultat, manuell beslutskedja, finalisering eller
IOF-export ingår.

`MANAGE_RACE` återanvänds för den samlade operatörsåtgärden; den nya vägen får
inte höja en begränsad `CHANGE_ENTRY_CARD`, `RECALCULATE_RESULT` eller
`VIEW_READOUT_RESULT_HISTORY`-credential. Läsning av kandidat och skrivning är
egen route-/kontraktsyta med CSRF och `no-store`; den exponerar endast det
operativa minimum som krävs.

Ingen riktig USB/SI-parser, GPS, karta, stafett eller Eventorändring hör till
TASK085. MeOS används endast som beteendereferens enligt licensregeln; ingen
kod, struktur eller data återanvänds.

## Återställning

Migrationen är additiv. Produktionsåtergång innebär att inaktivera writer/UI,
rätta framåt med en ny immutable handling eller återställa en verifierad full
PostgreSQL-backup. Råmeddelande, ingestutfall, journal, brickkoppling och
resultatrevision droppas aldrig för att "ångra" en enskild lösning.
