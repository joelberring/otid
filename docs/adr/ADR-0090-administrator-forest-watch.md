# ADR-0090: privat uppföljningsrapport för tävlingsadministratör

Accepterad 2026-09-12, TASK052.

MANAGE_RACE får en direkt skyddad read-wrapper runt befintlig rosterprojektion.
Vi lägger inte FINISH_FOREST_WATCH i allowlisten: den befintliga behörigheten
omfattar också enhetsregistrering/sync som inte integreras i detta lässnitt.
Ingen ny capability eller ändrad personalroll; adminprincipal verifieras i
application och route, projektionen läses under samma repeatable-read-transaktion.

Rapporten är privat/no-store, låsning rensar den. Nätfel behåller endast
uttryckligen gammalmärkt underlag. Manuell uppdatering och daterad rapport,
inte realtidsposition eller bevis för tom skog. Filter kan aldrig dölja
att hela loppet innehåller fler deltagare. Ingen ny domänlogik/migration.
Återställning tar bort nya läsvägen utan dataändring.
