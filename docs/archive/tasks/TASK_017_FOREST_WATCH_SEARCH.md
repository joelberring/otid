# TASK017 – Sökning utan att dölja målpersonalens osäkerhet

Status: implementerad, se verifiering i docs/status.md.
Bygger på befintlig behörig forest-roster; web-only.

Målpersonal söker namn, klubb eller bricknummer och kombinerar med klassval.
Visade rader filtreras i minnet, serverordning och forestState ändras aldrig.
Alla fem osäkerhetsgrupper behålls med separata antal för visat urval och hela
loppet. En tom sökning får inte kommunicera att skogen är tom. Globala
enhetsuppgifter, serverlästid, stale-/osäkerhetsvarningar och totalantal
bevaras även vid noll sökträffar och på utskrift. Aktiv söktext/klass ska framgå.
Söktext rensas i befintlig hide/låsning/logout/authfel; ingen persistence.
Konfliktgranskningspanelen får fortsatt hela underlaget, aldrig sökfiltret.

Scope: forest-watch-admin/report, svenska texter, CSS-module och fokuserade
test. Ingen API/schema/behörighetsmodell/resultatberäkning eller dependency.
Detta är presentationsfilter, inte nytt beslut om vem som är i skogen.
Ingen ny ADR behövs utan sådan arkitekturändring. Orelaterade moduler lämnas.

Acceptans: namn/klubb/bricknummer/case/Unicode och klass kombineras, clear,
oförändrade fem grupper/hela-loppet-tal/enheter, nollträff med explicit varning,
search synligt i utskrift, hide rensar privat söktext. Fokuserade rapporttester
och verklig browser med syntetiska API-svar på desktop/mobil; lint/typecheck/
build. Ingen ny backend-/hårdvaruacceptans eller fysisk skrivarverifiering.
