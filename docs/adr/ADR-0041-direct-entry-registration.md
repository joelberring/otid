# ADR-0041: Direktanmälan till befintlig klass

- Status: Accepterad
- Datum: 2026-09-04

## Beslut

TASK 006Q skapar en individuell entry i ett befintligt lopp och en befintlig
klass. Befintlig entry-/brickmodell, motor och raceadministrativa säkerhet
återanvänds. Inga personregister, externa identiteter, betalningar eller nya
dependencies införs.

`REGISTER_ENTRY` är separat racecapability med prefix
`otid_org_entry_registration_v1`, egna cookies, högst åtta timmars access och
en timmes session. Origin/CSRF kontrolleras före högst 4 KiB strikt JSON.
Den privata förberedelselistan innehåller klasser/bana/startregel/snapshot,
inte deltagar- eller rådata.

Requesten fryser klass-id, banversion, startregel och racesnapshot. Förnamn
och efternamn krävs (trim, 1–160 tecken), klubb är valfri (högst 200). FIXED
kräver explicit starttid med datum/offset enligt ADR-0039; PUNCH kräver null.
Valfri bricka följer ADR-0040:s kanoniska nummer och får inte redan ha någon
historisk koppling inom loppet. Ingen automatisk gissning eller namnmatchning.

Under session → credential → race UPDATE → request advisory kontrolleras hela
intentet på nytt. Entry med intern UUID/version 1, valfri brickkoppling,
snapshot +1, immutable registreringsjournal och actor-audit sparas atomiskt.
Loppet får högst 10 000 entries, samma gräns som befintliga läsar-/paketflöden.
Stale klass/bana/startregel/snapshot, upptagen bricka och overflow ger konflikt
utan delvis skapad entry. Två samtidiga registreringar mot samma snapshot ger
en vinnare; förloraren behöver läsa aktuell klassgrund och bekräfta igen.

Samma request-id/actor/hela normaliserade intent ger exakt ursprungligt svar,
även efter senare entryändring. Ändrat intent eller actor ger konflikt. Samma
namn under olika avsiktliga requests kan vara olika personer och dedupliceras
inte automatiskt. UI visar namn/klass/bricka/starttid före sista bekräftelsen
och tillåter endast explicit same-id-retry efter okänt commitsvar.

## Resultat, import och offline

Registrering skapar ingen råpost, readout eller resultatrevision. Ny avläsning
använder samma ingest/motor. En tidigare okänd avläsning på den angivna brickan
kan användas av befintlig separat explicit omräkning; gamla kvittenser ändras
inte. Ingen DNS eller annan status fabriceras före första resultatet.

Nästa signerade paket innehåller entry/brickkoppling och ny snapshot. Gamla
paket/outboxposter bevaras. Befintlig finalisering blir inaktuell och ny
finalisering kräver även den nya deltagarens resultat; gamla XML-bytes består.

Direktanmäld entry har inget externt IOF-id. Senare EntryList-import får därför
inte matcha på namn och kan skapa en separat extern entry. Operatören ska inte
återimportera samma direktanmälda person som en ny extern identitet utan en
framtida explicit identitetskoppling. Fast starttid kan rättas i befintlig vy.

## Migration och återställning

0026 är additiv: capability, auditaktör och immutable
entry_registration_request med intent och skapat entry-id. Inga gamla rader
skrivs om. Stäng nya routes/CLI och spärra credentials vid incident; använd
additiv rättning eller verifierad backuprestore. Radera inte historiska
journaler, anmälningar eller enumvärden som genväg.

Ingen Eventor, lottning, hyrbrickekonomi, stafett, GPS eller riktig USB.
