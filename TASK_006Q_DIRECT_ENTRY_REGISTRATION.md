# TASK 006Q – direktanmälan

Status: Genomförd och verifierad 2026-09-04. ADR-0041 beslutad före implementation.

Arrangören registrerar namn, valfri klubb och ledig bricka i en befintlig klass.
Fast starttid anges endast för FIXED. Efter bekräftat sparande finns deltagaren
i nästa stationspaket och fungerar med vanlig avläsning och resultatvisning.

Ändringar: contracts, database/migration 0026, application, web och CLI.
Resultatmotor, IOF-adapter och stationens kö/ingest återanvänds utan ändring.

## Acceptans

1. Egen racecapability, privata cookies, Origin/CSRF före strikt 4 KiB body.
2. Validerade namn och valfri klubb/bricka; FIXED kräver explicit starttid,
   PUNCH avvisar fast tid. Exakt observerad klass/bana/startregel/snapshot krävs.
3. Atomisk entry + eventuell assignment + snapshotökning + journal/audit.
   Exakt retry återger original, ändrat intent/actor konflikterar. Samtidiga
   requests ger ingen dubbelbokad bricka eller orphan-entry.
4. Vanlig avläsning ger korrekt resultatrevision. Ingen status skapas före
   första avläsning. Nytt signerat paket innehåller deltagaren; gamla data består.
5. Mobilvy med 52 px kontroller, bekräftelse, tydlig kvittens och explicit
   same-id-retry utan Web Storage av hemligheter eller pendingintent.

Verifiera med ett litet antal kontrakts-/routetester, riktade PostgreSQLtester
och ett webbläsarflöde. Kör lint, typecheck, test och build vid delmålsgränsen.

Verifierat: lint, typecheck och build exit 0; 1 042 enhetstester,
3 riktade PostgreSQL-scenarier och 1 Playwrightflöde godkända. Exakta kommandon,
avgränsningar och kvarvarande antaganden finns i docs/status.md.
