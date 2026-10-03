# TASK035: Direktanmälan med samma administratörsinloggning

Status: avgränsat implementerat och verifierat efter ADR-0076. 22 riktade
testfall godkända; lint/typecheck/build för berörda paket exit0.
Exakta resultat och begränsningar finns i docs/status.md.

Bygg hela flödet från gemensam adminvy till befintlig registreringstjänst:
ny deltagare, befintlig klass, valfri bricka/klubb och FIXED/PUNCH-start.
Efter kvittens väljs deltagaren för fortsatt administration. Ingen extra login.

Berör application policy/audit/test samt web routes/formulär/texter/browser.
Befintliga contracts/database återanvänds; ingen migration planeras.
Acceptans och avgränsning enligt ADR-0076. Kör riktad lint/typecheck/test/build,
rapportera exakta resultat och kvarvarande drift-/fysiska antaganden.
