# ADR-0093: administrativ rättning av startmarkering

Accepterad 2026-09-12 för TASK056. Utvidgar ADR-0091:s förbud mot att admin
ändrar startstatus, men ändrar inte TASK054/055:s återkomstanrop.

Administratören får uttryckligen rätta startmarkeringen till UNMARKED,
STARTED eller REPORTED_NOT_STARTED. Detta är en administrativ observation,
inte en startstämpling eller ändrad tävlingstid. Granska deltagare, målstatus
och underlags-/entry-/checkin-version före separat bekräftelse.

Lagra som MARK_START med verklig MANAGE_RACE-källa i befintlig append-only
journal. Den befintliga domänplanen bevarar manuell återkomst för MARK_START;
anropet får inte acceptera en klientvald återkomstflagga. Separat action-kind
skiljer avsikten från TASK054/055:s FINISH_CORRECTION även vid retry. Bevara
gammal kvittens utan att tillämpa den igen efter senare ändringar.

Versionsbunden målstatus räcker i kontraktet; ingen extra föregående status
lagras i anropet. Samma request-id med ändrad målstatus, aktör eller annat
action-kind ger konflikt. Servern äger källa, sekvens, race och aktör.

Domänen avgör checkin-DNS och konflikt med faktisk/manuell återkomst eller
andra resultat. Ingen frånvaro får automatiskt bli ej startande. UNMARKED
innebär osäkerhet, inte bevis på att personen inte startat. UI visar dessa
konsekvenser och läser om rapporten efter kvittens. Inga rådata ändras.

Tillåt administrativ MARK_START i gemensam historisk källvalidering före
skrivning. Behåll FINISH_CORRECTION:s skydd mot startbyte i återkomstanropen.
Personalens offline-/recoverykontrakt förblir oförändrade. Ingen ny migration
eller domänlogik behövs. Vid återgång stäng nya anropet, men behåll stöd för
att läsa redan lagrad administrativ MARK_START-historik.
