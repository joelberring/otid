# ADR-0018: Capability-separerad, racebunden klassadministration

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 001:s klassändring är en öppen PATCH-route som läser obegränsad JSON före
autentisering och lämnar interna feltexter samt hela den uppdaterade entry-raden.
Applikationstjänsten tar rätt race- och entrylås, validerar klassens race och
ökar entry-/snapshotversion, men klienten uttrycker inte vilken entry-version
operatören såg. Två gamla flikar kan därför serialiseras och båda skriva, och
retry efter okänd commit utför samma mutation en gång till.

TASK 005F–005G har ett smalt hash-only säkerhetssubstrat för racebundna
capabilities. `PAIR_STATION` och `IMPORT_IOF` tillhör andra trust domains och
ska inte ges klassändringsrätt. En generell användar-, medlems- eller rollmodell
är för bred för nästa bevis.

Klassändring och resultatomräkning har en uttrycklig domängräns: ändringen
skapar audit och ny snapshot men skriver aldrig om en tidigare
`ResultRevision`. Endast ett separat operatörsanrop får skapa en ny revision.

## Beslut

### Separat capability och separat webbsession

Säkerhetssubstratet utökas additivt med `CHANGE_ENTRY_CLASS`. Credentialen är
bunden till exakt race, individuellt märkt, högst åtta timmar och använder
prefixet `otid_org_entry_class_v1`. Sessionen gäller högst en timme och får egna
session-/CSRF-cookies:
`__Host-otid-entry-class-admin-session` och
`__Host-otid-entry-class-admin-csrf`, med explicita andra namn för loopback.

De fysiska `pairing_admin_*`-tabellerna återanvänds för migrationssäkerhet men
capabilitypolicyn görs exhaustiv. Issue, login, revoke och auditmetadata måste
välja policy för exakt capability; ingen tvåvägs-fallback får tolka en framtida
capability som en annan.

Login är race- och capability-specifik. Den befintliga klass-PATCH-routen
ersätts med den säkra implementationen så att ingen parallell bypass finns.
Den skyddade klassadminsidan serverrenderar endast ett shell; deltagarunderlag
hämtas först efter att klassessionen verifierats.

### Tvåfasig auth och strikt faktisk JSON-body

Unsafe requests kräver exakt canonical Origin samt klassadminytans egna session-
och CSRF-cookies. Första authkontrollen sker utan mutation före bodyläsning.
Idempotency-headern valideras därefter innan requestströmmen läses till högst
4 KiB. Medietypen ska vara exakt JSON, bytes ska vara strikt UTF-8 och objektet
ska vara strikt `{formatVersion: 1, classId, expectedEntryVersion}`.

Mutationstransaktionen autentiserar samma session på nytt under lås. Låsordning
är `session -> accesscredential -> race -> request advisory -> entry`. Det
förlänger den befintliga `race -> entry -> revision`-ordningen utan nät-I/O under
lås och gör vunnen logout/revocation definitiv före commit.

### Requestbunden idempotens och optimistic intent

Webbläsaren skapar ett internt request-UUID och skickar canonical header
`Idempotency-Key: entry-class-change:<request-id>`. `expectedEntryVersion`
binder operatörens avsikt till den version som faktiskt visades. Efter racelås
och request-advisory-lås kontrolleras tidigare request före aktuell entry, så en
exact retry kan återge sitt ursprungliga utfall även efter senare mutationer.

En ny append-only `entry_class_change_request` får ett servergenererat internt
UUID som primärnyckel och ett unikt request-id. Request-id:t är ett internt
protokoll-id, inte identiteten för ett externt Eventor-/IOF-objekt. Journalen
binder actorcredential, race, entry, expected version, gammal/ny klass,
entry-/snapshotversion före och efter samt ändringstid.

Exakt retry med samma actor/race/entry/målklass/expected version är read-only
och återger ursprungliga metadata med `replayed: true`. Samma request-id med
ändrad kontext ger 409. Två olika request-id för samma gamla version ger en
vinnare och en stale-konflikt.

Byte till redan aktuell klass avvisas med 409 utan journal, audit eller
versionsökning. Det skärper den gamla öppna route-semantiken avsiktligt: en no-op
är inte en domänförändring och får inte skapa snapshot-/audit-churn.

### Atomik, audit och resultatrevisioner

Första giltiga mutation uppdaterar entryns klass med explicit versionsvillkor,
ökar snapshotversionen exakt ett, appenderar requestjournalen och skapar
`ENTRY_CLASS_CHANGED_BY_ADMIN` i samma transaktion. Auditaktören är
`ENTRY_CLASS_ACCESS_CREDENTIAL`; request-id ligger i auditfältet. Före/efter
innehåller endast klass-id och entry-/snapshotversioner. Personnamn,
organisation, credentiallabel, token, session, cookie, CSRF och authhash ingår
inte.

Klassändringen skapar ingen `ResultRevision` och anropar inte
`recalculateEntry`. Den befintliga explicita omräkningen hålls som en separat
utvecklingsyta tills ett eget säkerhets- och domänsnitt beslutas.

### Privat UI och fel

En separat svensk sida visar bara klassfunktionens scope, sessionsstatus och
minimalt deltagarunderlag. Accesscredential och pending request hålls endast i
React-minne. Okänd commit och 401/403 behåller exakt request för explicit retry;
ingen automatisk retry eller Web Storage används. Bekräftad ändring visar:
”Klassen ändrades. Resultatet är inte omräknat.” Reload fabricerar inget utfall.

Authfel är generiska 401/403, entry/class utanför rätt race ger generiskt 404,
stale/no-op/requestkonflikt ger generiskt 409 och kontraktsfel 400. Interna
feltexter returneras aldrig. Alla svar är `private, no-store`, `nosniff` och
`no-referrer`; sidan förbjuder inramning och oanvända browserfunktioner.

## Konsekvenser

- Klassändringen blir produktionsautentiserad utan att pairing/import eller en
  generell rollplattform får bredare rättigheter.
- Gammal browserstate kan inte tyst skriva över en senare operatörsändring.
- Tappat svar kan återhämtas exakt utan dubbel snapshot- eller auditmutation.
- Deltagardata flyttas från det öppna adminsidelagret till ett privat,
  capabilityskyddat dataanrop för denna funktion.
- Befintlig explicit omräkning förblir oskyddad utvecklingsyta och den nya sidan
  får inte presentera den som del av samma skyddade workflow.
- Ingen dependency eller extern kod behövs.

## Migration och återställning

Migration 0006 lägger till capabilityn `CHANGE_ENTRY_CLASS`, actor-kind
`ENTRY_CLASS_ACCESS_CREDENTIAL`, capabilityspecifik åttatimmarsgräns och
append-only `entry_class_change_request` med konsekvenschecks och
immutabilitetstrigger. Äldre credentials, sessioner, entries, auditposter och
resultatrevisioner lämnas oförändrade.

PostgreSQL kan inte ta bort enumvärden säkert med enkel rollback. Vid incident
inaktiveras nya routes/CLI och en korrigerande migration görs. Full rollback
sker från verifierad backup. Journalen får inte raderas för att simulera
rollback.

## Avvisade alternativ

- Ge `PAIR_STATION` eller `IMPORT_IOF` klassrätt: bryter minsta privilege och
  trust-domainseparation.
- Generell `MANAGE_RACE`, OIDC eller medlems-/rollmodell: för brett för detta
  vertikala snitt.
- En parallell säker route: lämnar den gamla öppna PATCH-routen som bypass.
- Page-only eller client-only auth: skyddar varken HTTP-route eller data.
- Läs body före auth eller lita på `Content-Length`: möjliggör obehörig
  resursförbrukning och en kringgåbar gräns.
- Endast entry-version utan request-id: stoppar stale overwrite men kan inte
  säkert återge ett tappat commitutfall.
- Endast request-id utan entry-version: retry blir säker men två olika gamla
  operatörsavsikter kan fortfarande skriva över varandra.
- Audit som idempotensbarriär: blandar säkerhetsbevis och requeststate samt gör
  exakt svarsåtergivning osäker.
- Acceptera no-op och öka version/snapshot: skapar falska domänförändringar.
- Journalföra avvisad no-op/stale: gör avvisningar till beständig personbunden
  historik utan behov och komplicerar retrysemantiken.
- Automatisk resultatomräkning: bryter etablerad revisionsregel och gömmer en
  separat operatörsåtgärd i klassmutationen.
- Gemensamma cookies med pairing/import: skapar capabilityförväxling och
  flikkonflikter.
- Automatisk browserretry eller Web Storage för credential/request: döljer
  okänd commit och ökar hemligheters livslängd.
