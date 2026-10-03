# ADR-0118: explicit korrigering av observerad starttid i PUNCH-klass

- Status: Accepterad och implementerad
- Datum: 2026-09-20

## Kontext

TASK031 rättar den planerade fasta starttiden för en `FIXED`-klass före
resultatutvärdering. TASK006W:s startavprickning är ett operativt faktum om
start/närvaro, inte en tidskälla. TASK093 kan rätta ett observerat målslag.
Ingen av dessa vägar kan hantera att en bevarad startstämpling i en
`PUNCH`-klass är dokumenterat felaktig, till exempel efter ett stationsklockfel.

Att ändra `CardReadout.startPunchedAt`, råbytes eller historisk
`ResultRevision` skulle förstöra underlaget. En generell manuell tidseditor
skulle dessutom blanda observerad start, fast start, mål och banfakta, och göra
resultathistorik samt IOF-finalisering svår att bevisa.

## Beslut

TASK104 inför en enda `MANAGE_RACE`-skyddad append-only åtgärd för exakt en
Entry: rätta **observerad starttid** endast när dess absoluta resultathuvud är
en publicerad direkt teknisk `OK` eller `MP`, med `PUNCH`-klass, `readoutId`,
bevarad `CardReadout.startPunchedAt`, mål och löptid. Starttiden i det tekniska
utfallet måste motsvara den bevarade observerade starten. Klassen får inte vara
`FIXED`, och källan får inte ha en aktiv DNS/DNF/DSQ/approval/OOC/NT-overlay
eller vara en tidigare manuell rättning.

Operatören anger en explicit offsetbunden UTC-tid med högst millisekund-
precision. Den ska skilja sig från den observerade starttiden, ligga strikt
före bevarad måltid och ligga på eller före varje bevarad matchad
kontrollpassering. Åtgärden skapar aldrig en saknad startpassering.

Den nya immutable `ResultRevision` får orsaken
`MANUAL_PUNCH_START_TIME_CORRECTION`. Den bevarar entry, historisk klass och
bana, status/reason, måltid, saknade/extra kontroller och kontrollföljd från
källan. Den beräknar ny `elapsedMs` från korrigerad start och bevarad måltid.
Varje splits kontroll/förekomst bevaras; dess ackumulerade och första
sträck-tid räknas om från den nya starten, medan senare sträck-differenser
bevaras. Ingen kontroll, punch, måltid eller status fabriceras eller ändras.

En egen immutable journal binder källrevision, `readoutId`, observerad och
korrigerad starttid, actor, request-id, kandidatens canonical basis-hash samt
skapad revision. Revisionen refererar journalen. Råmeddelanden, CardReadout,
Entry, klass, bana, snapshot, stationspaket och äldre revisioner muteras inte.
Snapshotversionen ökar inte.

## Samtidighet, idempotens och projektion

Preview och commit binder race/entry, entryversion, snapshotversion, historisk
klass/bana och startregel, exakt source revision/readout/start/mål samt
canonical basis-hash. Commit följer den befintliga resultatmutationsordningen:
session/credential, raceläsning, request-advisory-lås, entry-lås, exact replay,
grundkontroll, journal, revision och audit i en transaktion.

Idempotensnyckeln är `manual-punch-start-time-correction:<request-id>`. Endast
exakt samma aktör och canonical intent får spela upp samma kvittens; ändrad
start, källa, target eller aktör ger konflikt. Senare ingest får fortfarande
append:a en teknisk revision men skriver aldrig om rättningen.

Den centrala lagrade-revisionsvalideringen verifierar journalen, PUNCH-grunden,
bevarad måltid/kontrollföljd/status och den härledda löptids-/splitmatematiken.
Publikranking, speaker och Snapshot-/IOF-export använder en sådan validerad
revision utan ny IOF-status. En gammal fryst `Complete` förblir byte-identisk;
en ny finalisering måste frysa den nya grunden enligt ADR-0028. En framtida
återtagandefunktion kräver ett eget ADR-beslut.

## Operativ yta och konsekvenser

Den gemensamma svenska `/manage`-vyn visar endast en kvalificerad kandidat och
dess observerade start, första kontroll, mål och löptid. Den visar inmatad ny
start och beräknad löptid i ett tvåstegsflöde. Vid osäkert svar finns endast
exakt retry i minnet; ingen ny klientkö, cache eller capability införs.

Detta löser ett verkligt PUNCH-problem utan att göra tidsrättning generell.
Det omfattar inte fysisk startstation, startavprickning, fast start, mål-
rättning, GPS, kartor eller stafett.
