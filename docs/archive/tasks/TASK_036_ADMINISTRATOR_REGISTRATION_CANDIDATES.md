# TASK036: Dubblettvarning före direktanmälan

Status: avgränsat implementerat och verifierat efter ADR-0077. 23 riktade
testfall godkända; lint/typecheck/build för berörda paket exit0.
Se docs/status.md för exakta resultat och begränsningar.

Koppla ADR-0068:s matchning och kontrakt till skrivfri application-sökning,
gemensam admin-POST och TASK035:s granskningspanel. Samma namn är varning,
historiskt upptagen bricka spärr, aldrig automatisk sammanslagning. Befintlig
deltagare kan väljas i samma vy. Okänd registreringscommit retryas exakt utan
ny sökning. Berör application/web och riktade PG/HTTP/browserprov; ingen
migration, kontraktsändring eller ny roll. Acceptans enligt ADR-0077.
