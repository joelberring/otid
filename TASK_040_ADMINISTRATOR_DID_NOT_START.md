# TASK040: Ej startande och rättning med samma administratör

Status: klart avgränsat snitt, 2026-09-12. ADR-0079 beslutad före implementation.

Vald deltagare får arbetsåtgärden Ej startande i gemensam MANAGE_RACE-session.
Den återanvänder DNS-beslut och återtagande från ADR-0029/0030. Rättning ingår
i samma snitt för att inte lämna administratören utan väg tillbaka efter fel.
Ingen ny resultatpolicy, automatisk frånvarobedömning eller avprickning.

Berör application policy/audit, web HTTP och workspace samt riktade tester.
Samma strikt validerade kandidater/intents/kvittenshelpers, samma pendingretry
och operation/abort/logout. Bara deltagare utan tidigare revision kan få nytt
manuellt DNS enligt befintlig policy. Ett aktuellt manuellt DNS kan återtas;
avpricknings-DNS hanteras inte av denna åtgärd. Gällande resultatremsa uppdateras
efter kvittens, men efterläsningsfel får inte förlora en lyckad kvittens.

Acceptans: samma login skapar och återtar manuellt DNS, exakt retry ger ett
beslut respektive återtagande, sann adminaudit, äldre roller oförändrade,
konflikt mot befintligt resultat. Rådata/revisionhistorik/snapshot bevaras vid
återtagande. Riktad PG, HTTP, browser samt lint/typecheck/build. Ingen riktig
tävling/hårdvara eller full svit. Inga frågor krävs från användaren.

Verifierat: application/web lint/typecheck/build exit0; HTTP16, policy2,
PG2 och4 olika browserfall godkända över körningarna. Första browserkörningen
gav3pass/1fail på testets felaktiga svenska textförväntan; rättat TASK040
återkört separat,1pass9,2s. Ingen produktändring för att passa assertionen.
Samma session, dubbla byteidentiska försök/beslut, återtagande, sann audit,
NO_ACTIVE_RESULT och bevarad raw/revisions-/snapshotversion verifierade.
Skärmbilder390/1366 granskade. Fysisk mobil, produktionslast och avpricknings-
DNS-rättning omfattas inte. Full workspace-/hårdvarusvit kördes inte.
