# ADR-0055: Avgränsad administrativ återhämtning av avprickningskö

- Status: Accepterad; TASK 006W under implementation
- Datum: 2026-09-05
- Konkretiserar ADR-0050/0053/0054. Ingen ny generell IAM, resultatregel,
  dependency, server eller ändrad permanent device-/actorbindning.

## Problem och minsta återhämtningsväg

En lokal upplåst kö kan överleva den åtta timmar långa arbetscredentialen.
Ny session med samma fortfarande giltiga credential fungerar redan. Vid
utgång/spärrning måste kön bevaras men den ordinarie synken ska fortsatt neka.
Att ändra actor, device, sekvens, versionsgrund eller hash skulle ändra beviset
för vad operatören faktiskt sparade. Att förlänga/avspärra credentialen skulle
återge mer skrivbehörighet än återhämtningen behöver.

Vi inför därför ett separat, kortlivat recovery-grant för en **exakt fryst
manifestlista** av befintliga lokala operationer. Grantet tillåter endast att
de lämnas till samma synkdomän och att deras exakta kvittenser återhämtas.
Det tillåter inte ny rosterläsning, ny enhetsregistrering, nya markeringar,
ombasering eller avskrivning av konflikter. Den gamla credentialen förblir
utgången/spärrad och enheten förblir permanent knuten till sin ursprungsaktör.

## Auktoritet och integritet

Första utfärdandet sker via betrodd server-CLI med databasåtkomst, samma
operativa förtroendegräns som befintlig credentialprovisionering. Det är inte
en publik ny administratörsroll och ingen befintlig mål-/startbehörighet
utökas automatiskt. CLI kräver operatörsetikett och uttrycklig orsak. Innan
utfärdande måste ursprungscredentialen vara utgången eller spärrad; CLI gör
ingen automatisk spärrning eller förlängning. Produktionens operatör behöver
bekräfta ursprung/mobil med ansvarig arrangör, särskilt vid misstänkt missbruk.

Mobilen kan efter lokal upplåsning exportera ett strikt privat manifest utan
namn, lösenfras, credential eller plaintext-operationer. Det innehåller race,
device, ursprungsactor, capability och ett sammanhängande intervall av pending
requestId/localSequence/contentHash. Hela listan binds av canonical SHA-256.
Manifestfilen är inte ett bevis på att den gamla operatören fortfarande är
behörig; det är administratörens granskade beslut som ger recovery-grantet.
Krypterat fullarkiv och original-IDB ändras inte av manifestexport.

Grantet har UUID, hashed 32-byte secret, canonical manifest/hash, utfärdandetid,
utgångstid högst en timme senare, operatör och orsak. Token är
otid_checkin_recovery_v1.<grantId>.<base64url-secret>, visas endast vid
utfärdande och lagras aldrig i logg, URL, appcache eller IDB. Browsern behåller
den bara i minnet under ett uttryckligt återhämtningsförsök och tömmer fältet.
Grant kan spärras separat; en ny uttrycklig utfärdning behövs efter utgång.
Flera grant för samma bevis kan inte skapa dubbla verksamhetsoperationer.

## Manifest och servergrind

Format 1 har kind=OTID_CHECKIN_RECOVERY_MANIFEST, raceId, deviceId,
actorCredentialId, capability START_CHECKIN|FINISH_FOREST_WATCH,
firstSequence, lastSequence och items. Varje item har requestId, localSequence
och contentHash. Mellan 1 och 20 000 items, strikt stigande sammanhängande
sekvens, unika request-id, kanoniska gemena UUID/SHA-256 och PostgreSQL-räknare.
Tom lista, luckor och dubbletter avvisas. Inga tid-/namn-/fri metadatafält.

Utfärdaren låser ursprungscredential → race SHARE → device UPDATE och
validerar permanent scope/capability. Redan serverlagrade överlappande
sekvenser måste matcha request/hash/actor/race/device. Första saknade sekvens
måste vara serverns nästa; ingen lucka eller okänd framtida könivå godkänns.
Det frysta manifestet får senare inte ändras. Nya poster som operatören skapar
efter export omfattas inte och behöver annat uttryckligt beslut.

Ny privat HTTP-route /api/admin/races/<raceId>/checkin-recovery/sync tar samma
StartCheckinSyncRequest som ordinarie synk. Recovery-token går i Authorization,
aldrig cookie/URL. Strikt same-origin/JSON/4 KiB/no-store och ingen CORS.
Bearer + same-origin ersätter inte den ordinarie cookie-CSRF-grinden; den är
en separat route som inte använder cookies som auktoritet.

Token verifieras före bodyläsning och igen under grant SHARE-lås, inklusive
utgång och revocation. Sedan samma race → request advisory → device → entry
lås som ordinarie synk. Exakt medlemskap request/seq/hash och oförändrad
device/actor/race/capability krävs. Originalintentets hash räknas om. Båda
ingångarna ska använda samma interna transaktionsskrivare och domänplan;
recovery får aldrig bypassa revisions-, roster-, beroende-, DNS- eller
återkomstgrind. Äldre redan lagrad kvittens returneras före ny verksamhetsgrund.

## Spårbarhet och migration

Additiv migration tillägger immutable grant, items och delivery samt separat
revocation. Delivery binder recovery-grant till exakt ursprunglig operation,
även när endast en gammal kvittens återfås. Grant/sponsor är separat provenance;
ursprungsactor och normal receipt förfalskas inte. Ny operation, eventuell
DNS-effekt, recovery-delivery och audit måste committa i samma transaktion.
Exakt retry ändrar ingen journal och skapar ingen ny delivery/auditdubblett.

Delivery-audit använder egen action och grantId i fryst metadata, samma
provisioneringsmönster som utfärdaren. Den tillskriver inte leveransen en ny
vanlig arbetscredential och kräver ingen ny auditActorKind-enum. Den vanliga
operationsauditen behåller ursprunglig start-/målaktör oförändrad.

Rollback är att stänga CLI/route och bevara tabellerna, aldrig att radera kön,
granten eller historiken. Ingen äldre resultatschemaform förändras. Arkivimport
på annan mobil eller kloning av device är fortfarande inte tillåtet.

## Acceptans innan TASK 006W kan kallas klar

- Utgången/spärrad vanlig credential kan inte synka; kö/operation/hash finns kvar.
- Ny vanlig actor kan inte överta enheten. Recovery-grant får ingen vanlig auth.
- Manifest med lucka, dubblett, fel scope, ändrat hash eller aktiv original-
  credential får inget grant; giltigt överlapp kräver exakt tidigare operation.
- Recovery med okänd/ändrad operation, annat race/device, utgång/spärrat grant
  nekas utan verksamhetseffekt eller falsk kvittens.
- Giltig recovery med offlinekedja går genom samma domainregler, inklusive
  sena negativa rapporter och beroendekonflikt; inga fabricerade DNS/OK.
- Commit följd av tappat HTTP-svar och lokal reload ger samma receipt, en
  operation och en delivery. Samtidig revocation/ingest är atomiskt ordnad.
- Riktig browser → HTTP → PostgreSQL visar återhämtning av bevarad lokal kö,
  kvarvarande konflikter och att token/lösenfras inte cacheas eller loggas.

Detta ADR är beslut före implementation, inte bevis på färdig återhämtning.
