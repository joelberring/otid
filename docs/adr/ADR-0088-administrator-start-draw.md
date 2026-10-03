# ADR-0088: befintlig startlottning i gemensam administration

Accepterad 2026-09-12, TASK050.

MANAGE_RACE integrerar DRAW_CLASS_START_TIMES. Befintlig roll behålls.
Audit anger verklig administratör. Application behåller FIXED-gräns,
versions-/sourceHash-kontroll, låsning och aktörsbunden idempotens.

Gemensamma cookies/Origin/CSRF och strikt4KiB request gäller även preview.
UI fryser serverns granskade plan, parametrar och request-id. Övriga åtgärder
spärras under granskning/retry. Starttider får ersättas uttryckligen; resultat
och publicerade listor ändras inte automatiskt. Fri start lämnas oförändrad.
Ingen ny algoritm, domängräns, migration eller offline-lottning.
Återställning tar bort nya adminvägen; sparad historik bevaras.
