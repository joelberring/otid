# ADR-0073: Explicit omräkning med gemensam administratörssession

- Status: Accepterad
- Datum: 2026-09-12
- Uppgift: TASK032

RECALCULATE_RESULT ansluts uttryckligen till MANAGE_RACE enligt ADR-0069.
Befintlig tjänst och immutable request-/resultatjournal återanvänds. Den
verkliga adminaktören journalförs som RACE_ADMIN_ACCESS_CREDENTIAL; tidigare
begränsad aktör behåller sin typ. Ingen migration eller resultatregel ändras.

ADR-0019:s frysta intent och låsning bevaras: aktiv brickkoppling, senaste
avläsning, senaste revision, entry/klass/snapshot och motorversion binds före
omräkning. Ny publicerad teknisk resultatrevision skapas efter explicit
bekräftelse, aldrig vid klass-/brick-/tidsändringen själv. Tidigare revisioner,
rådata och manuella resultatbeslut bevaras. Den tekniska kvittensen är inte
bevis på ändrat effektivt resultat om ett manuellt beslut fortfarande gäller.
Frysta finaliseringar/exporter ändras inte. Entry/snapshot ökar inte.

Gemensamma adminroutes GET recalculation-candidates och POST
entries/{entryId}/recalculate använder endast admincookies och verklig roll.
POST har Origin/CSRF, 4KiB och befintligt result-recalculation-prefix.
Kvittensen binds till request/race/entry/readout, förväntad ny revision,
snapshot och motor. Requestjournalen binder resterande intent på servern.

UI tillför Omräkning som fjärde åtgärd, inte ett samtidigt öppet formulär.
Separat kandidatläsning behövs eftersom ny ingest kan ändra revision utan ny
snapshot. Vid aktivering hämtas aktuellt roster och kandidater, och vald
entry/klass/version/snapshot måste överensstämma innan granskning tillåts.
Race/entry/kortkoppling ska bindas; ett sent eller avvikande underlag får
inte användas som om det hörde till nuvarande deltagarval. Nya writes
kontrollerar ändå hela intentet under lås. Saknad eller flertydig koppling/
avläsning visas utan sparknapp; ingen avläsning fabriceras.

Ett gemensamt pendingläge äger alla mutationer. Okänt svar ger exakt retry,
inte automatisk ny revision. Explicit logout/omladdning kan förlora minnes-
intent och kräver då kontroll av aktuellt tillstånd. Ingen beständig kö.
Vyn varnar före bekräftelse att en ny teknisk revision publiceras, att
manuella beslut kvarstår och att gamla finaliserade dokument inte uppdateras.

Vid incident stäng adminrouten/rollåtgärden; radera inte resultat eller journal.
Acceptans: riktig PG för sann audit, tidigare resultat/raw/manuellt beslut,
exakt retry/annan aktör/stale; browser för samma login efter starttidsändring,
tappat svar och en enda ny revision. Riktad lint/typecheck/test/build.
Ingen ny dependency, extern källa, riktig tävling eller hårdvara ingår.
