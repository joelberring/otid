# ADR-0092: rätta manuell återkomst med gemensam administratör

Accepterad 2026-09-12 som implementeringsriktning för TASK055.
Ersätter endast ADR-0091:s förbud mot administrativ nollställning av manuell
återkomst. Ingen skrivväg aktiveras genom dokumentet.

## Beslut

Administratören får ta bort en felaktig manuell återkomst genom en ny
append-only FINISH_CORRECTION med manualReturnRegistered=false. Behåll
granskad startstatus, verklig MANAGE_RACE-aktör och samma serverhanterade
källa/sekvensmodell som TASK054. Ingen journalrad eller rå avläsning raderas.

Använd ett separat onlineanrop för rättningen. Befintligt registreringsanrop
och dess strikta kontrakt ska fortsatt betyda true. Återanvänd gemensam intern
tjänst med servervald målflagga, inte kopierad resultatlogik. Klienten får
inte välja actor, source, sequence eller godtycklig startstatus.

Granskningen binder deltagare, underlags-/entry-/checkin-version och
observationstid precis som TASK054. Request-id binds även till målflaggan:
ett registrerings-id får inte återanvändas som rättnings-id eller tvärtom.
Exakt retry av en tidigare lagrad rättning återger dess ursprungliga kvittens,
även efter senare registrering. Ny begäran med gammal version ger konflikt.

## Tävlingsmässig effekt

Rättningen tar endast bort den manuella observationen. En teknisk återkomst
från avläsning försvinner inte. UI får inte lova att personen åter hamnar i
gruppen kvar i skogen; läs om rapporten efter kvittens.

Befintlig planStartCheckinSync avgör resultatpåverkan. Om bevarad startstatus
är REPORTED_NOT_STARTED kan checkin-genererad DNS åter skapas som ny revision.
Teknisk återkomst eller annat resultat kan i stället ge konflikt enligt
befintliga regler. UI upplyser om detta innan bekräftelse, och visar aldrig
en durabel CONFLICT-kvittens som en tillämpad rättning. Ingen implicit
startstatusändring införs för att kringgå en konflikt.

## Kompatibilitet

Historiska källvalidatorer ska acceptera båda administrativa målflaggorna
innan false får skrivas. Personalens credential-, enhets- och recoverykontrakt
förblir oförändrade. Ingen ny migration, dependency eller domängräns behövs:
befintlig journal representerar redan båda booleanvärdena.

Vid återgång stängs rättningsanropet, men läsning av lagrad false-historik
behålls. Gamla validators som avvisar denna historik får inte återinföras.
