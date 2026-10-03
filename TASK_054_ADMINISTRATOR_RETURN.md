# TASK054: manuell återkomst med gemensam administratör

Status: implementerad 2026-09-12; riktade PostgreSQL- och browserprov passerade.
ADR-0091 ska följas före kodändring.

Administratören väljer deltagare, granskar registrerad start/återkomst och
bekräftar manuell återkomst. Detta är inte godkänt resultat eller en ny
startobservation. Befintlig checkin-domän avgör effekt, inklusive konflikt
och eventuell återkallelse av checkin-genererad DNS. Andra resultat bevaras.

Krav: ärlig aktörskälla, versionskontroll, en append-only operation, exakt
retry efter tappat svar, och omedelbart uppdaterad kvar-i-skogen-rapport.
Ingen utvidgning av personalens offlinecredentials/recovery, ingen dold kö.

Berörda delar: database migration/schema, contracts för nytt adminintent,
application online-wrapper och befintliga källvaliderare, web routes/UI.
Återanvänd intern checkin-writer; kopiera inte resultatlogiken till en ny tjänst.

Acceptans: PostgreSQL-prov av retry/konflikt, historisk källvalidering och
oförändrad offlinepersonalbehörighet; ett genomgående browserfall för
okänd/startad→manuell återkomst och oförändrade rådata/resultat där ingen
DNS-effekt är tillämplig. Berörda lint/typecheck/build. Ingen bred matris
utan koppling till den nya administrativa källan.

Förundersökning: device-tabellen har capability-check och composite-FK till
verklig credential/capability. Att bara tillåta FINISH_FOREST_WATCH för admin
skulle inte fungera och skulle ge fel käll-/aktörsmodell.

Genomfört: migration0046 utvidgar enbart device-check och lägger unik
MANAGE_RACE-källa per credential. Tillämpad endast på isolerade otid_029_test.
SQL-prov accepterar korrekt källa, avvisar dubblett/falsk målroll och rullar
tillbaka alla testinlägg. Kontraktet låter inte klienten välja actor/device/
sequence/action. packageVersion är granskad underlagsversion; expectedRevision
är checkin-revision. Två kontrakttester passerar; contracts/database
lint/typecheck/build exit0.

Skrivvägen och UI är implementerade: välj deltagare, uppdatera kvar-i-skogen,
granska och bekräfta återkomst med samma adminsession. Servern tilldelar källa
och sekvens; retry använder exakt samma frysta begäran. Konflikt visas inte
som registrerad återkomst. Startstatus och andra resultat bevaras, medan
befintlig checkin-logik kan återkalla checkin-genererad DNS.

Två PostgreSQL-prov passerade (1,29s): samtidig retry, ändrad avsikt/aktör,
behörighet, versionskonflikt, källhistorik och DNS-effekt. Ett browserprov
passerade (9,6s): granskning/avbryt, tappat verkligt HTTP-svar, exakt retry,
uppdaterad rapport och inga fabricerade resultat. Ingen fysisk mobil eller
produktionsdrift verifierad. Adminåterkomst kräver nät; ingen offlinekö ingår.
