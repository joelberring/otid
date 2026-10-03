# ADR-0079: Manuellt DNS och rättning i gemensam administratörsvy

Status: Accepterad. Datum: 2026-09-12. TASK040.

ADR-0069:s gemensamma roll utökas uttryckligen med DECIDE_DID_NOT_START och
WITHDRAW_DID_NOT_START. Detta ersätter kravet på separat funktionsinloggning
i ADR-0029/0030 för MANAGE_RACE; begränsade operatörer får inga nya rättigheter.
Verklig principal/credential bevaras. Båda befintliga applicationtjänsterna
skriver RACE_ADMIN_ACCESS_CREDENTIAL i audit när aktören är administratör;
äldre roller använder sina tidigare audittyper. Exakt replay binds fortfarande
till samma verkliga aktör/intent. Ingen maskering eller generell wildcard.

Befintlig DNS-policy och withdrawal-resolver ändras inte. Nytt manuellt DNS
kräver helt tom revisionshistorik och skapar revision1 utan raw/readout.
Återtagande av felaktigt aktuellt manuellt DNS appendar withdrawal, inte ny
resultatstatus och inte mutation av DNS-revisionen. Ett redan återtaget DNS
kan därför inte ersättas av ett nytt manuellt DNS i detta snitt; senare riktig
avläsning kan skapa nytt aktivt resultat. Avpricknings-DNS är annan provenans
och får inte återtas via denna åtgärd. Inget automatiskt DNS från saknad mål-
avläsning, och ett återtaget DNS bevisar inte fysisk start eller återkomst.

Nya gemensamma routes: GET did-not-start-candidates och did-not-start-withdrawals;
POST entries/:entryId/did-not-start respektive did-not-start-withdrawal.
MANAGE_RACE-preflight, gemensamma cookies, Origin/CSRF för writes,4KiB body,
strict request/response och no-store. Svar binds till hela tillgängliga
intentidentiteten med befintliga rena klientkvittensfunktioner. Kandidater
måste matcha valt entry/klass/version/snapshot före granskning.

UI har en Ej startande-arbetsvy, explicit granskning/bekräftelse för beslut
och återtagande. Okänt sparutfall behåller samma minnesintent och request-id;
ingen ny underlagshämtning eller nytt intent krävs för retry. Pending får inte
döljas genom action/deltagarbyte. Logout/authfel följer befintlig livscykel.
Efter sparande visas effektivt resultat via befintlig centrala läsprojektion.

Ingen migration behövs: besluts-/withdrawal-aktörs-FK refererar befintlig
credential utan capabilitykolumn, och adminaudittypen finns redan. Ingen
teknik-, domän-, licens- eller offlineköändring. Vid problem stängs dessa
adminroutes/åtgärder; inga beslut, revisioner eller återtaganden tas bort.
