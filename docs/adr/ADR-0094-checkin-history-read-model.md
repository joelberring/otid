# ADR-0094: privat deltagarjournal för avprickning

Accepterad 2026-09-12 för TASK057.

Visa avprickningsoperationer för en deltagare med verklig MANAGE_RACE-
session. Läs befintliga operationer och verifiera lagrad intent/kvittens och
källans aktör/lopp/capability med befintliga regler. Ingen rollaliasning,
resultatberäkning eller skrivning ingår. Personalens offlinekontrakt ändras inte.

Projectionen visar action, kvittensens effect, källroll/etikett samt både
observedAt och receivedAt. Credentialhemligheter, sessionsvärden och råa
transportdata ingår aldrig. APPLIED, UNCHANGED och CONFLICT presenteras
åtskilda; en konflikt är inte en senare tillämpad startstatus.

Sortera mottagningstid fallande och request-id som entydig skiljare.
Paginera högst50 rader med scopebunden cursor för lopp/deltagare och exakt
databastid/id, enligt befintlig avläsningshistorik. Cursor är en sidgräns,
inte behörighet; autentisera varje läsning. Tidsordningen anger mottagning,
inte orsakssamband mellan enheter. Effektens revision visas separat.

UI säger att endast serverlagrad historik visas: osynkade mobilobservationer
kan saknas. Uppdatering börjar om från senaste sidan; deltagarbyte/logout
rensar underlaget och pågående svar måste vara bundna till rätt deltagare.
Ingen cache i beständig browserlagring eller publik endpoint. Befintlig
start-/återkomstfunktionalitet ändras inte av detta dokument.
