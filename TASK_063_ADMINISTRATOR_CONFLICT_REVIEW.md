# TASK063: granska avprickningskonflikter i gemensam adminvy

Status: implementerad 2026-09-12 enligt ADR-0097; verifieringsresultat och
begränsningar i docs/status.md. Inte produktionsverifierad.

Serverdel genomförd: källetiketter, migration0047 och verklig MANAGE_RACE-
aktör i granskning/validator/audit. Två riktade PostgreSQL-fall passerar;
exakt retry, ändrad orsak och senare konflikt ingår. Lint/typecheck/build
för database/application exit0. Se docs/status.md för kommandon.
Adminroute och separat granskningsmarkering i historiken är också införda.
Granskningspanelen finns nu under Start- och återkomsthistorik för vald
deltagare. Gemensam adminsession, obligatorisk orsak/bekräftelse och fryst
intent vid okänt utfall. Automatisk skogsuppdatering pausar under granskning.
Genomgående HTTP/PostgreSQL/browserprov med tappat svar passerar: exakt retry,
en granskningspost och bevarad konflikt med separat journalmarkering.

Administratören granskar aktuell grund och originalrapporter för en deltagare,
anger orsak och bekräftar KEEP_CURRENT_STATE. Behåll historik och aktuella
fakta; rapporten ska fortsatt visa den som saknar återkomst för uppföljning.

Berör database migration0047/schema, application tjänst/validator/källhämtning,
adminens contracts/history och web route/UI. Återanvänd ADR-0056:s domänplan
och versionerade intent. Ingen ny personalroll, offlinekö eller resultatlogik.

Första delsteg: rätta källhämtningen så att befintlig målpersonal kan granska
administrativa konflikter utan saknad deviceLabel. Adminenheter ska fortfarande
inte skickas i personalens offline-roster.

Riktad acceptans: riktig aktör/FK/audit, original oförändrat, exakt retry,
ändrat sourceHash/ny konflikt avvisas, motsägande aktuellt läge kan inte
avskrivas; granskad historik skiljs från olöst konflikt. Ett genomgående
browserfall med orsak/granskning/tappat svar. Berörda lint/typecheck/build;
inga breda regressioner utöver den befintliga granskningsfunktionens berörda prov.
