# TASK039: Journalförda deltagarändringar i gemensam administration

Status: klart avgränsat snitt, 2026-09-12. Beslut: ADR-0078 före implementation.

Vald deltagare får Historik med samma MANAGE_RACE-session. Visa journalförda
enskilda klass-/klass+start-/brick-/starttids-/namnändringar samt direktanmälan,
nyast deltagarversion först,20 per sida. Tidpunkt och före/efter visas tydligt.
Detta är inte full resultat-, import-, lottning- eller avprickningshistorik.

Berör contracts, application och web. Ingen migration eller write. Befintliga
journaler återanvänds, autentisering/race-scope behålls utan ny funktionsnyckel.
Browser använder befintlig operation/abort/logout och minnesburet underlag;
växling/hämtfel får inte visa annan deltagares historik. Inga namn i URL/cache.

Acceptans: riktig PG för scoped roll, sex källor, versionordning/pagination,
trasiga journaler och oförändrad DB. Strict HTTP kontrakt och no-store.
Befintlig browserkedja visar sparade före/efter från samma session; fel/byte/
logout döljer gammalt underlag. Kompakt mobil/dator. Riktad lint/typecheck,
kontrakt/application/HTTP/browserprov och build; ingen hårdvara/full svit.

Verifierat: contracts/application/web lint/typecheck/build exit0, kontrakt3,
HTTP15, PostgreSQL4 och browser3 godkända (25 olika riktade testfall).
Browser27,0s visar5 sparade förändringar, namn-/brickföre/efter, nätfelrensning,
uppdatering och direktanmälanspost för nyvald deltagare med samma session.
Pagination20+resten verifierad i PG, UI:s äldreknapp kodgranskad men inget
separat browserfall för21+historikposter. Skärmbilder390/1366 granskade.
Ingen fysisk mobil, produktionslast eller full workspace-/hårdvarusvit.
Detaljerade kommandon och inledande korrigerade kontrollfel i docs/status.md.
