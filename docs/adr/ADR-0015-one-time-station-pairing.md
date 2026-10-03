# ADR-0015: Kortlivad engångsparning med native-genererad credential-secret

- Status: Accepterad
- Datum: 2026-08-31

## Kontext

TASK 005D skyddar ingest och stationspaket med individuella, device- och
loppscoppade credentials. Provisioneringen sker dock med en betrodd CLI vars
hela credential-JSON manuellt förs till stationen. Briefen kräver parning via en
kort engångskod eller QR, men projektet har ännu ingen arrangörsinloggning eller
generell rollmodell som kan skydda ett webbaserat utfärdargränssnitt.

Ett vanligt servergenererat bearer-token skapar ett svårt retryproblem: om
servern committar inlösen men HTTP-svaret tappas kan plaintext-token inte
återskapas ur dess lagrade hash. Att spara plaintext eller en reversibelt
krypterad kopia på servern skulle bredda hemlighetsytan. Att skapa en ny
credential vid varje retry skulle förbruka engångsgrantet oklart och lämna
oanvända credentials.

Rate limiting måste fungera över flera Node-processer och omstarter. En
processlokal räknare är därför inte en godtagbar produktionsbarriär.

## Beslut

### Grant och betrodd utfärdning

En betrodd server-CLI utfärdar ett `station_pairing_grant` för exakt race och
scope `READOUT`. Grantet är giltigt högst 15 minuter och anger när den framtida
stationscredentialen ska gå ut; credentialens utgångstid måste ligga efter
hela grantfönstret. Formatet är
`otid_pair_v1.<grant-id>.<secret>` med en 32-byte slumpsecret i canonical
base64url. Endast SHA-256-hash lagras och plaintext visas en gång.

CLI-gränsen behålls eftersom arrangörsautentisering ligger utanför detta snitt.
Tokensträngen är avsiktligt QR-redo, men QR-rendering, kamera och ett
arrangörsgränssnitt införs inte. Ett grant kan spärras före inlösen genom en
append-only revocation och löper annars ut automatiskt.

### Native-genererad credential och pendingförsök

Androidstationen genererar själv 32 slumpbytes med `SecureRandom` för
credentialen och ett UUID som `attemptId`. `beginDevicePairing` får inte öppna
nätverk. Innan det anropet returnerar sparas följande i en separat AtomicFile under
`noBackupFilesDir`: granttoken, attempt-id, credential-secret, normaliserad
bas-URL och starttid. Innehållet krypteras med samma icke-exporterbara
AndroidKeyStore-princip som credentialvalvet men med separat AAD/purpose.
`redeemDevicePairing` får därefter endast använda denna beständiga pendingstate;
WebView skickar inte grant eller secret en andra gång.

Inlösen skickar endast credential-secretens SHA-256-hash tillsammans med
attempt- och device-id. Servern får aldrig plaintext. När svaret kommer bygger
native tokenformatet `otid_stn_v1.<credential-id>.<secret>`, installerar det i
credentialvalvet och ersätter pendinghemligheterna först efter lyckad
installation med en krypterad, icke-hemlig completed-markör som bär attempt-id
och credentialmetadata. Därmed kan även ett tappat plugin-/JavaScript-svar
återläsas idempotent. Pluginstatus exponerar aldrig granttoken,
credential-secret eller hash.

### Transaktion, engångsbarriär och retry

Pairing-routen autentiserar grantets bearer före bodyparsning när det är
möjligt. Applikationstjänsten serialiserar kända grant med ett radlås och utför
i en enda PostgreSQL-transaktion:

1. expiry, revocation, secret och rate limit verifieras,
2. requestens exakta kontrakt valideras,
3. en `station_device` skapas eller återanvänds,
4. nästa append-only credentialgeneration skapas med presenterad secret-hash,
5. en unik `station_pairing_redemption`, attemptlogg och auditpost appenderas.

Redemption har unik grantreferens och unikt attempt-id. En retry med exakt samma
autentiserade grant, attempt-id, device-id och credentialhash returnerar samma
publika credentialmetadata. Den skapar ingen ny rad och kan återspelas tills
credentialen går ut. Ett annat attempt, device eller hash får aldrig återanvända
grantet. Ingen replay returnerar någon secret.

Denna asymmetri gör tappat svar och processdöd säkra utan återläsbar serversecret:
stationen äger redan credential-secretens enda plaintextkopia i krypterad
pendingstate.

Requesten använder `Idempotency-Key: pairing:<attemptId>` och ett exakt delat
kontrakt med `formatVersion`, `attemptId`, `deviceId` och
`credentialSecretHash`. Routen är global under `/api/station-pairing/redeem`;
race och scope kommer endast från det autentiserade grantet och kan därför inte
väljas av klienten.

### Rate limit och fel

Varje syntaktiskt giltigt försök mot ett känt grant appenderar ett
`station_pairing_attempt` fram tills grantet är blockerat. Fem misslyckade försök inom ett rullande
tiominutersfönster spärrar ytterligare inlösen under återstående fönster och ger
`429` med begränsad `Retry-After`. Grantets radlås gör kontroll och append
serialiserade över processer.

När fem felrader redan finns är efterföljande 429-svar read-only tills fönstret
löpt ut; annars blir limiteringen själv en obegränsad skrivförstärkare. En exakt
autentiserad replay av en redan committad redemption kontrolleras före blocket
och tillåts fortsatt, eftersom den bara returnerar samma publika metadata och
aldrig skapar credential eller secret. Även replayen är read-only; den första
success-attempten och den unika redemptionraden räcker som auditspår.

Felaktig grantsecret räknas och loggas utan att routen läser bodyn; attempt- och
device-id är därför nullable i attemptloggen och fylls först efter autentiserad,
validerad body. Inget obetrott bodyfält används som auth- eller rate-limitnyckel.

Malformed och okända grant-id:n avvisas generiskt utan att skapa godtyckliga
databasrader. Eftersom secret har 256 bitars entropi är detta inte en
bruteforcegräns, men generellt volym-/DoS-skydd vid reverse proxy dokumenteras
som driftkrav och byggs inte här. Obeprövade forwardingheaders används inte som
säker klientidentitet.

Ogiltig auth, expiry, revocation eller förbrukat grant ger samma generiska
`401`. Rate limit ger generiskt `429`; giltig auth med ogiltigt bodykontrakt ger
generiskt `400`, och ett autentiserat men konkurrerande redan förbrukat attempt
ger generiskt `409`. Alla svar är `no-store` och negativa svar innehåller inga
race-, device-, grant- eller credentialfält.

## Konsekvenser

- Stationen kan paras och återhämta tappade svar utan att servern lagrar
  plaintext credential-secret.
- Engångsegenskapen och rate limit är databasstödda och fungerar över
  processomstarter.
- Ny parning för samma device/lopp ger en högre credentialgeneration. Den äldre
  spärras fortsatt explicit enligt ADR-0014, vilket undviker utelåsning vid
  ofullständig installation.
- Android får en liten separat pairingadapter och pendingfil. SQLite, outbox,
  resultatmotor och ingest-idempotens ändras inte.
- Den publika pluginmetoden och UI-vägen för att installera en komplett
  plaintextcredential tas bort. Credentialvalvets installation finns endast
  som intern promotion från pairingcoordinatorn. Betrodda revokeverktyg kan
  finnas kvar, men CLI-issue/rotate får inte vara normal produktprovisionering.
- Manuell grantutfärdning är ett avsiktligt kvarvarande operatörssteg. Full
  arrangörsautentisering och QR-kamera måste komma i egna snitt.
- Ingen ny kryptografi- eller rate-limitdependency behövs; Node crypto,
  Androids plattformskrypto och PostgreSQL räcker.

## Migration och återställning

Migration 0003 är additiv. Grant, revocation, attempt och redemption skyddas av
immutabilitetstriggers. Automatisk destruktiv rollback tillåts inte. En verifierad
full backup tas före manuell nedtagning och normal återställning sker med
roll-forward.

Androids SQLite migreras inte. En skadad pendingfil kan rensas endast genom en
separat uttrycklig operatörsåtgärd och ett nytt grant utfärdas; befintlig
deviceidentitet, installerad credential, paket,
outbox, lokala bedömningar och serverobservationer får inte ändras. Om servern
redan committat inlösen måste samma intakta pendingstate återanvändas; ett nytt
grant skapar annars en ny generation.

## Avvisade alternativ

- Servergenererad credential-secret i inlösensvaret: ett tappat svar kan inte
  återställas utan plaintextlagring eller ny credential.
- Krypterad plaintextcredential i PostgreSQL: ger servern en onödig
  återläsningsnyckel och större läckageyta.
- Ny credential per retry: bryter engångs- och idempotenssemantiken.
- Processlokal rate limiter: förlorar tillstånd vid omstart och delas inte av
  flera webbprocesser.
- Mutera grantet med `redeemed_at`: tappar append-only-historik; en separat unik
  redemption är tydligare.
- Automatisk revocation av tidigare credential: kan låsa stationen ute om den
  nya installationen aldrig blir beständig.
- Arrangörswebb utan färdig autentisering: flyttar endast den öppna
  säkerhetsgränsen.
- QR-/kamerabibliotek i detta snitt: påverkar inte parningens säkerhets- eller
  retryegenskaper och breddar implementationen.
