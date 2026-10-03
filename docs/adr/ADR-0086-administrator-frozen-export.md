# ADR-0086: frysta officiella exporter i gemensam administration

Accepterad 2026-09-12, TASK048.

TASK047:s EXPORT_IOF_RESULT_LIST används även för befintliga loppfinaliseringar.
Gemensamma GET-routes kräver faktisk race-bunden MANAGE_RACE-session och
returnerar privata no-store-svar. Finalization-id valideras separat.

Application läser befintlig fryst Complete-fil, aldrig dagens projektion.
Klienten binder download till vald finalisering, revision, race och SHA-256.
Utgången/låst session stoppar sent svar; historik rensas vid låsning.
UI anger uttryckligen att senare ändringar inte ingår i historiska filer.

Ingen rätt att FINALIZE_RESULTS läggs till och inget fastställs vid läsning.
Ingen ny teknik/domängräns/migration. Vid återställning tas endast nya
UI/routes bort; historik och ursprungliga exportvägar bevaras.
