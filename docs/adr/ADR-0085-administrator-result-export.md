# ADR-0085: aktuell resultat­export i gemensam administration

Accepterad 2026-09-12, TASK047.

MANAGE_RACE får EXPORT_IOF_RESULT_LIST genom den explicita listan över
integrerade funktioner. Begränsad exportroll behåller sin befintliga väg.
Gemensam adminroute kräver faktisk MANAGE_RACE och race-bunden session.

Read-only GET återanvänder application-exporten och privat no-store-svar.
Klienten kontrollerar befintliga metadata, filnamn och SHA-256 före download;
utgången/låst session får inte skapa en sen nedladdning. Filen innehåller
personuppgifter och sparas avsiktligt på administratörens enhet, inte i cache.

Snapshot, utelämnade deltagare, stale-resultat, NT-spärr och enloppsgräns
behålls. Ingen implicit publicering/finalisering eller Complete. Historiska
Complete-exporter integreras inte här. Ingen ändrad domängräns eller teknik.
Vid återställning tas nya adminvägen bort; inga data behöver återställas.
