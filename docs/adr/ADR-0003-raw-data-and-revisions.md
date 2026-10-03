# ADR-0003: Immutabel rådata och append-only revisioner

- Status: Accepterad
- Datum: 2026-08-30

## Kontext

En avläsning måste kunna skickas om utan dubletter och resultat måste kunna
räknas om utan att historiken skrivs över.

## Beslut

`raw_device_message` är unik på `(device_id, local_sequence)` och lagrar
innehållshash. Normaliserad avläsning refererar råposten. `result_revision` och
`course_version` är append-only och varje omräkning skapar en ny rad. Auditposter
beskriver klassändring och explicit omräkning. Update/delete blockeras både genom
avsaknad av applikationsmetoder och databas-trigger.

## Konsekvenser

Historiken kan förklaras och återspelas. Lagringsbehovet växer monotont och kräver
senare retention/arkivpolicy. Korrigering sker genom nya revisioner, inte mutation.
