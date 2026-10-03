# TASK301 – rätta manuell klassrubrik i befintligt klassupplägg

ADR-0167 är accepterad före implementation. Målet är att rätta ett manuellt
klassnamn med bevarat klass-ID/bana, från exakt vald rad i Före→Klasser.
Dokumentfasen är klar; implementation/verifiering återstår.

## Sammanhängande leverans

1. Strikt GET/request/kvittens och idempotensnyckel.
2. Migration0086 med immutable journal, FK och återställningsnot.
3. Skyddad application-läsning och race-/aktörsbunden transaktion.
4. Befintlig adminsession-route med GET/POST, Origin/CSRF/no-store.
5. Tunt namnområde i vald klass, granskning, fryst retry och återläst roster.

Namnbytet får inte skapa klass/bana/deltagare/resultat. Exakt retry ger samma
kvittens, fel namn/snapshot/klass/aktör ger ingen delwrite och externidentifierad
klass avvisas. Frysta publiceringar är historiska; aktuella etiketter förändras.

## Proportionerlig kontroll

Contracts/database/application/web lint/typecheck/build; små kontrakt/routeprov.
Utöka befintligt TASK081-PG-fall med ett namnbyte/retry och extern spärr mot
en ny isolerad databas. Återanvänd TASK227:s enda browserfall med ett granskat
lyckat namnbyte vid390/1280 px. Ingen ny testplattform, verklig credential eller
demoändring. Inga testresultat finns ännu.

Antaganden: importägda klasser behöver senare uttrycklig rättnings-/omimport-
policy. Klassupplägg är online; offlinefältbruk/produktions-TLS/full restore
verifieras inte här. Äldre resultatsnapshot omräknas inte automatiskt.
