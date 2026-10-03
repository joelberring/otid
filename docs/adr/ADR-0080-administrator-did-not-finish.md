# ADR-0080: DNF och återtagande i gemensam administration

Status: Accepterad. Datum: 2026-09-12. TASK041.

MANAGE_RACE får uttryckligen DECIDE_DID_NOT_FINISH och WITHDRAW_DID_NOT_FINISH
enligt ADR-0069. Kravet på separata funktionsinloggningar i ADR-0033/0034
ersätts för tävlingsadministratören, inte för begränsade roller. Verklig
principal används; audit skriver RACE_ADMIN_ACCESS_CREDENTIAL för admin och
äldre actor kinds för äldre roller. Replay förblir bundet till samma aktör.

Befintlig resultatpolicy ändras inte. DNF kräver publicerat aktuellt direkt
tekniskt OK/MP som absolut revisionshuvud utan annat aktivt manuellt beslut.
Aktivt DNF kvarstår när senare teknik anländer. Återtagande appendar exakt
restaureringsrevision från den granskade källan enligt ADR-0034; inte fallback,
ny beräkning eller mutation av raw/resultat. DNF utan avläsning och DNF direkt
på en manuell restaurering ingår inte. Dessa begränsningar ska visas i UI.

Gemensamma GET did-not-finish-candidates/did-not-finish-withdrawals och POST
entries/:entryId/did-not-finish respektive did-not-finish-withdrawal använder
MANAGE_RACE-preflight, gemensamma cookies, Origin/CSRF,4KiB body och no-store.
Befintliga strikt validerade kandidater, intents och kvittenshelpers återanvänds.
UI binder roster/entry/klass/bana/snapshot före granskning, visar exakt target
och restaureringskälla och håller samma frysta pendingintent vid nätfel.
Valbyte/logout/auth följer befintlig operation/abortlivscykel. Bekräftad
mutation är skild från misslyckad efterläsning.

Kvittens måste även ange exakt nästa revision: beslutets target+1 respektive
återtagandets absoluta huvud+1. Återställd status och reason måste matcha den
granskade tekniska källan. Detta skärper klientens kvittensvalidering, inte
serverns befintliga resultatpolicy.

Ingen migration behövs: befintliga actor-FK stödjer credentialidentiteten och
adminaudittypen finns. Ingen ny resultatstatus, domän-/teknik-/licensändring,
extern tjänst eller dependency. Vid incident stängs dessa adminåtgärder;
historiska beslut, withdrawal och revisioner lämnas oförändrade.
