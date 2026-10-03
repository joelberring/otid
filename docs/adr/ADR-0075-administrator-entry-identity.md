# ADR-0075: Namn och klubb med gemensam tävlingsadministratör

- Status: Accepterad
- Datum: 2026-09-12
- Implementationsstatus: inkopplad och riktat verifierad i TASK034

## Kontext

Användaren kräver att tävlingsadministratörer kan göra vardagsändringar med
samma inloggning. ADR-0069 ersätter separata funktionsinloggningar som slutlig
administratörsdesign. TASK026 har redan en versionsbunden textändring enligt
ADR-0067, men journalens capability-check i migration0041 tillåter bara
CHANGE_ENTRY_IDENTITY. Den sammansatta aktörsnyckeln binder verklig credential,
race och capability. Enbart en ny knapp eller policyändring räcker därför inte.

## Beslut

MANAGE_RACE får uttryckligen använda CHANGE_ENTRY_IDENTITY genom befintlig
centrala åtgärdspolicy. Begränsade credentials behåller sina exakta rättigheter.
Tjänsten changeEntryIdentityAsAdmin återanvänds: samma låsordning, CAS, no-op-
kontroll, versionsgränser och historiska exakta retry. Journalen skriver
auth.principal.capability, aldrig en fabricerad begränsad roll. Audit använder
RACE_ADMIN_ACCESS_CREDENTIAL för administratören och behåller den tidigare
typen för begränsad rättare. Retry binder även lagrad capability till aktören.

Ny migration0045 utökar endast entry_identity_change_capability_check till
CHANGE_ENTRY_IDENTITY eller MANAGE_RACE; Drizzle-definitionen följer samma
regel. Befintlig composite actor-FK, entry-/klass-scope, versionskrav, unika
index och immutabletrigger behålls. Inga historiska journalrader skrivs om.

Den gemensamma HTTP-ytan får identity-candidates GET som återanvänder
listEntryIdentitiesAsAdmin och entries/[entryId]/identity PATCH som använder
befintligt ändringskontrakt och idempotency-prefix. Samma administratörscookies,
exakt admin-preflight, Origin/CSRF och private no-store används. PATCH får
8 KiB faktisk bodygräns som TASK026; övriga adminåtgärders gräns ändras inte.
Svaret binds till race/entry/request/klass, tidigare och nya textfält samt
båda versionsövergångarna. Ingen separat rättningsinloggning införs här.

## Kompakt arbetsflöde

En femte åtgärd, Namn och klubb, visar tre fält för vald deltagare. Separata
givenName/familyName hämtas från auktoritativ identity-list; displayName får
aldrig delas upp. Kandidaten binds till samma roster-race/snapshot/entry/
klass/version före granskning. Ny text följer befintligt kontrakts trimning;
förväntad text jämförs exakt och tomt klubbfält blir null. Klubb är fortfarande
entryns fritext, inte ett nytt globalt register eller organisations-ID.

Formuläret delar befintlig operation och pendingintent. Före/efter granskas
innan sparande, ett tappat svar tillåter exakt samma retry, och ett sent svar
får inte återöppna en utloggad vy. Efter kvittens läses deltagarunderlag och
gällande resultat på nytt; namnändringen ska synas utan ny inloggning.
Ingen parallell klientkö, beständig cache eller automatisk personsammanslagning.

## Bevarade verksamhetsregler

Endast de tre textfälten samt entry-/snapshotversion ändras. Interna/externa
identiteter, klass, starttid, brickägarskap, raw och resultatrevisioner förblir
oförändrade. Befintligt importskydd omfattar också administratörens journal.
Levande listor och nästa signerade paket får rättad text; gamla paket och
frysta startlistor/Complete-bytes ändras inte. Omräkning och ny publicering
är fortsatt explicita åtgärder. Ingen ny resultataktualitetsregel införs.

## Migration och återställning

Kör migration före aktivering av ny skrivväg. Prova endast mot uttryckligen
isolerad syntetisk PostgreSQL under utveckling. Vid återgång stängs den nya
adminvägen, men den utökade checken behålls när MANAGE_RACE-journaler finns.
Återinför inte en constraint som gör giltig historik olaglig. Radera inte
journaler; använd framåtriktad korrigering eller verifierad full backuprestore.
Ingen privat/manuell demodatabas migreras implicit av detta beslut.

## Acceptans

- PostgreSQL: admin och begränsad rättare använder samma tjänst med verklig
  journalcapability/audit, historiskt adminretry efter senare rättning ger
  samma svar, annan aktör/avsikt och stale underlag ger konflikt.
- PostgreSQL: felaktig actor/capability-kombination avvisas fortsatt av FK;
  oförändrade rådata/resultat/kopplingar och TASK026:s import-/exportregression.
- HTTP: korrekt metod, behörighet, bodygräns och full kvittensbindning.
- Browser: samma session och vald deltagare genom textändring med tappat
  svar/exakt retry; rättat namn/klubb visas, endast en journal, desktop/mobil
  utan horisontell overflow och inget återöppnande efter logout.
- Riktad lint, typecheck, tester och build för berörda paket.

Ingen ny dependency, teknik, domängräns, extern källa eller licensändring.
Globalt medlemsregister, bulkredigering, Eventorskrivning och ny historikvy
ingår inte i detta snitt. Beslutet är inte bevis på färdig implementation.
