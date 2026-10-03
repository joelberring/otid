# Acceptanstester

## TASK 001

| ID | Scenario | Automatisering |
|---|---|---|
| A001 | Samma batch 100 gånger ger en rå post | PostgreSQL-integrationstest |
| A002 | Saknad kontroll ger MP | Domäntest |
| A003 | Extra kontroll tillåts | Domäntest |
| A004 | Upprepad kontrollkod matchas per förekomst | Domäntest |
| A005 | Fel ordning ger MP | Domäntest |
| A006 | Okänd bricka förklaras utan resultat | Domäntest |
| A007 | Klassändring och omräkning skapar ny revision | PostgreSQL-integrationstest |
| A008 | Ogiltig XML lämnar loppet oförändrat | PostgreSQL-integrationstest |
| A009 | Samma XML-import skapar inga okontrollerade dubletter | PostgreSQL-integrationstest |
| A010 | Publikresultat väljer senaste publicerade revision | PostgreSQL-integrationstest |
| A011 | Officiellt strukturerade IOF-fixtures mappas och den gamla lokala dialekten avvisas | IOF-enhetstest |
| A012 | Simulatorns kö återställer paketversion, sekvens och hash och tar bara bort exakt kvitterad post | Webb-enhetstest |

Utöver dessa täcks fast starttid, startstämpling, kontraktsvalidering och
hashkonflikt med enhetstester/integrationstester.

Playwright skapar en tävling, importerar fixtures, öppnar arrangörsvyn,
simulerar en avläsning och verifierar klass, status och sträcktid i den publika
resultatsidan. Ett separat flöde bryter ingest, laddar om sidan, verifierar den
oförändrade lokala kön och skickar den till `stored` följt av en idempotent
`duplicate`. Testerna kräver körande PostgreSQL och webapp och ingår i CI.

## TASK 002A: transport- och capturefundament

| ID | Scenario | Automatisering |
|---|---|---|
| A2A001 | Capturevalidering avvisar hash-, schema-, ordnings- och intervallfel före första byte | Paketenhetstest |
| A2A002 | Replay bevarar RX-chunkgränser, emitterar inte TX och ger samma sammanfattning 100 gånger | Paket- och CLI-enhetstest |
| A2A003 | Recorded replay använder injicerad scheduler och close avbryter callbacks | Paketenhetstest |
| A2A004 | TX-matchning är strikt och skrivning på stängd replay avvisas | Paketenhetstest |
| A2A005 | Web Serial bevarar chunkar, väntar på writes även vid EOF/läsfel och rapporterar close-/detach-/read-fel sanningsenligt | Paketenhetstest |
| A2A006 | Node-serieadapter öppnar explicit låst 8N1 utan flödeskontroll och väntar på drain | CLI-enhetstest med fake driver |
| A2A007 | Ny partial-katalog och WAL synkas; output är privat och skrivs aldrig över | CLI-enhetstest |
| A2A008 | Recovery återställer längsta validerade WAL-prefix och karantänlagrar suffix byte-exakt med längd/SHA-256 | CLI-enhetstest |
| A2A009 | Error följt av detach kvarstår som error och råbytes skrivs inte till terminal | CLI-enhetstest |
| A2A010 | Repository- och symlinkvägar avvisas utan explicit opt-in | CLI-enhetstest |
| A2A011 | `si:ports` listar minimerad metadata utan att öppna eller proba | CLI-enhetstest och lokal smoke |
| A2A012 | Committad syntetisk fixture verifieras och replayas från repositoryroten | CLI-smoke |

Transport-/capturetesterna är syntetiska. Ingen rad i hårdvarumatrisen höjs av
dem och ingen protokollparser omfattas.

## TASK 002B: Android wire- och TypeScriptadapter

| ID | Scenario | Automatisering |
|---|---|---|
| A2B001 | Enhetslistan runtimevaliderar VID/PID och explicita portindex utan att öppna enheten | Paketenhetstest med fake plugin |
| A2B002 | Listener registreras före permission/open och klientens connection-id samt full konfiguration används | Paketenhetstest med fake plugin |
| A2B003 | Nekad permission lämnar ingen öppen nativeanslutning eller listener | Paketenhetstest med fake plugin |
| A2B004 | Främmande events filtreras och varje byteslyssnare får en defensiv kopia med identisk chunkgräns | Paketenhetstest med fake plugin |
| A2B005 | Writes serialiseras, bär explicit timeout, väntar på native completion och bevarar input trots konsumentmutation | Paketenhetstest med fake plugin |
| A2B006 | Requested close väntar på accepterade writes och är idempotent | Paketenhetstest med fake plugin |
| A2B007 | Ogiltig base64 och bakåtgående nativeordning ger explicit fel och stängning | Paketenhetstest med fake plugin |
| A2B008 | Detach ger explicit status och frigör anslutningen exakt en gång | Paketenhetstest med fake plugin |
| A2B009 | Write-fel propageras utan råbytes i felmeddelandet | Paketenhetstest med fake plugin |
| A2B010 | RX under native open buffras till fysisk commit och RX före misslyckad open bevaras | Paketenhetstest med fake plugin |
| A2B011 | Close under listener, permission eller native open avbryter och best-effort-stänger utan sen resursläcka | Paketenhetstest med fake plugin |
| A2B012 | Native sekvensgap, stale callback efter reopen och terminal native close hanteras deterministiskt | Paketenhetstest med fake plugin |
| A2B013 | Error/detach stoppar köade writes medan requested close dränerar redan accepterade writes och bevarar RX | Paketenhetstest med fake plugin |
| A2B014 | Kastande konsumentlyssnare isoleras och cleanupfel kan retryas utan att dölja primärt open-fel | Paketenhetstest med fake plugin |
| A2B015 | Native open bevarar RX före commit och emitterar observerbar opening/bytes/open-ordning | Kotlin/JVM-test med fake backend |
| A2B016 | Native writes är FIFO, defensivt kopierade, använder anropets timeout och dräneras vid begärd close | Kotlin/JVM-test med fake backend |
| A2B017 | Native detach gäller endast vald enhet, avbryter köade writes och stänger exakt en gång | Kotlin/JVM-test med fake backend |
| A2B018 | Native write-/closefel saneras, cleanup är idempotent och ett misslyckat close kan retryas | Kotlin/JVM-test med fake backend |
| A2B019 | Begränsad native eventkö kopierar bytes, ger global sammanhängande sekvens och explicit overflowfel | Kotlin/JVM-test |
| A2B020 | Pluginen registreras explicit av `MainActivity` | Android instrumenteringstest; APK kompilerad, körning återstår |

Native Kotlin/JVM-test, Android lint, app-APK och instrumenteringstest-APK ingår.
Instrumenteringstestet är inte kört eftersom emulator/fysisk Androidenhet
saknas. Fysisk USB ingår inte ännu. ADR-0008 och ADR-0009 beskriver grinden.
Inget fake-, build- eller linttest höjer hårdvarustatus.

## TASK 004: konkurrenssäker multi-station-ingest

| ID | Scenario | Automatisering |
|---|---|---|
| A4-001 | Två samtidiga stationer på samma bricka lagrar båda och skapar revisionerna 1–2 | PostgreSQL-integrationstest |
| A4-002 | Tio samtidiga stationer på samma bricka ger obrutna revisioner 1–10 utan dataförlust | PostgreSQL-integrationstest |
| A4-003 | Hundra samtidiga identiska retries ger en stored, 99 duplicate och exakt en råpost/readout/revision | PostgreSQL-integrationstest |
| A4-004 | Giltig/hashfelaktig/giltig batch sparar båda giltiga och kvitterar alla tre i ordning | PostgreSQL-integrationstest |
| A4-005 | Stale paket lagras, kräver uppdatering och resultatet märks med aktuell snapshot | PostgreSQL-integrationstest |
| A4-006 | Ahead paket lagras och visas utan falsk nedgraderingssignal | PostgreSQL-integrationstest |
| A4-007 | Sekvens/hash-konflikt avvisas utan mutation av första råpost, readout eller revision | PostgreSQL-integrationstest |
| A4-008 | Kontrakt och simulator kräver exakt queue/device/session, paketversion, sekvens, hash, kardinalitet och konsistent paketstatus | Kontrakts-, webb- och E2E-test |
| A4-009 | HTTP 500 på första köposten stoppar flush; senare sekvens skickas inte och båda ligger kvar | Playwright |
| A4-010 | Ingest samtidigt med klassändring använder en hel snapshot före eller efter ändringen | PostgreSQL-integrationstest |

Testerna använder riktig PostgreSQL/PostGIS. Ingen migration tillkommer i detta
snitt; befintliga append-only- och uniknyckelbarriärer behålls.

## TASK 005A: signerat paket och beständig stationskärna

| ID | Scenario | Automatisering |
|---|---|---|
| A5A-001 | Samma snapshot och signing key ger identiska canonical bytes, hash och RS256-signatur | Kontrakts-/applikationsenhetstest |
| A5A-002 | Manipulerad payload/signatur/key-id eller annan betrodd SPKI avvisas | TypeScript- och Androidtest |
| A5A-003 | Paketbygge under lopplås innehåller endast en sammanhängande snapshotversion | PostgreSQL-integrationstest |
| A5A-004 | Privat package route kräver exakt bearer-token, läcker inga deltagare vid 401 och svarar `no-store` | Playwright |
| A5A-005 | Android installerar paketet byteidentiskt; samma version/hash är idempotent | Android instrumenteringstest |
| A5A-006 | Downgrade och samma version/annan hash lämnar tidigare aktivt paket orört | Android instrumenteringstest |
| A5A-007 | Device-id, aktivt paket, nästa sekvens och pending outbox överlever stängd och återöppnad SQLite | Android instrumenteringstest |
| A5A-008 | Injicerat fel före commit lämnar varken sekvensökning eller halv outboxpost | Android instrumenteringstest |
| A5A-009 | Exakt stored/duplicate/rejected sparas atomiskt; fel device/sekvens/hash rullar tillbaka hela ackbatchen | Android instrumenteringstest |
| A5A-010 | Android backup- och transferregler exkluderar stationsdatabasen | Manifest-/instrumenteringstest |

De 11 stationslager- och 2 app-instrumenteringstesterna kompilerar till APK.
De har ännu inte exekverats: den temporära Android 11/API 30 AOSP ATD-emulatorn
nådde QEMU men förblev `offline` i ADB även med ren userdata och korrigerad
datapartition. Därför är A5A-005–A5A-010 inte markerade som runtime-verifierade.

## TASK 005B: lokal resultatmotor och operativ station

| ID | Scenario | Automatisering |
|---|---|---|
| A5B-001 | Stationen använder `@o-tid/domain` och ger samma utfall för samma readout/snapshot | Stations- och domänenhetstest |
| A5B-002 | Annan paketmotorversion ger inget lokalt besked men bevarar outboxposten | Stationsenhetstest |
| A5B-003 | Outbox committas före evaluering och lokalt besked visas först efter separat beständig insert | Stationsenhetstest + Android instrumenteringstest |
| A5B-004 | Aktiv payload överlever reopen och lokal hashkorruption avvisas | Android instrumenteringstest |
| A5B-005 | Additiv migration 1→2 behåller identitet, paket och legacy-outbox | Android instrumenteringstest |
| A5B-006 | Svensk status visar internet, serverkontakt, hårdvara, paketversion och kö utan färgberoende | Vy-/bundle-test |
| A5B-007 | Token och SPKI sparas inte av stations-UI:t | Stationsenhetstest/kodgranskning |
| A5B-008 | `www` byggs reproducerbart och kopieras till Android assets | Build- och APK-grind |

## TASK 005C: beständig stationssynk

| ID | Scenario | Automatisering |
|---|---|---|
| A5C-001 | Tappat stored-svar för känd respektive okänd bricka återvinns som duplicate med samma raw-id, evaluationHash och serverutfall | PostgreSQL-integrationstest |
| A5C-002 | Ingestutfall skapas i samma transaktion som raw/readout och kan inte uppdateras eller raderas | PostgreSQL-integrationstest |
| A5C-003 | Stationen skickar tidigaste pending som stabil single-event-batch med fryst kontext och idempotency-header | Stationsenhetstest |
| A5C-004 | Korrupt payload/hash skickas aldrig; nät-, HTTP-, body- och nativefel bevarar pending och stoppar ordnad flush | Stationsenhetstest |
| A5C-005 | Partiell, extra, omordnad eller motsägande kvittens appliceras inte | Stationsenhetstest |
| A5C-006 | Identisk retry är lokalt idempotent medan nytt centralbesked appenderas och äldre observation bevaras | Android instrumenteringstest |
| A5C-007 | Fel raw-id/hash/sekvens eller injicerat commitfel rullar tillbaka hela receipt-/observations-/outboxtransaktionen | Android instrumenteringstest |
| A5C-008 | SQLite-migration 1→3 och 2→3 bevarar all tidigare identitet, paket-, outbox-, receipt- och evalueringsdata | Android instrumenteringstest |
| A5C-009 | UI visar auktoritativ central status samt match, avvikelse, versionsskillnad, väntande och rejection utan färgberoende | Vy-/bundle-test |
| A5C-010 | Base URL kan återläsas efter omstart medan token och SPKI aldrig lagras | Stations- och Androidtest |
| A5C-011 | `stale` och `ahead` kvitteras men visas utan automatisk downgrade eller implicit ack | Stationsenhetstest |
| A5C-012 | Native HTTP-adaptern bygger och Android connected-teststatus redovisas explicit | Android build/instrumentering |

## TASK 005D: device-bunden stationsautentisering

| ID | Scenario | Automatisering |
|---|---|---|
| A5D-001 | Rätt aktiv credential är bunden till exakt device, lopp och `READOUT` och bevarar stored/duplicate-idempotens | PostgreSQL-integrationstest |
| A5D-002 | Saknad, trasig, felaktig, utgången eller spärrad credential ger generiskt 401 utan mutation eller privat läcka | PostgreSQL-integration/Playwright |
| A5D-003 | Giltig secret med fel race, device eller funktion ger generiskt 403 före ingest | PostgreSQL-integration/Playwright |
| A5D-004 | Servern lagrar endast secrethash; audit innehåller varken token eller hash | PostgreSQL-integrationstest |
| A5D-005 | Rotation skapar högre append-only generation och gammal credential fungerar tills explicit revocation | PostgreSQL-integrationstest |
| A5D-006 | Credential- och revocationrader samt audit kan inte uppdateras eller raderas | PostgreSQL-integrationstest |
| A5D-007 | Paketroute använder samma device-/race-bundna credential och svarar privat/no-store | Playwright |
| A5D-008 | Native credentialkuvert krypteras med Keystore/AES-GCM och skrivs atomiskt i no-backup-sökväg | Android instrumenteringstest |
| A5D-009 | Plugin returnerar endast credentialmetadata och native request injicerar auth endast till tillåten HTTPS/loopback-route | JVM-/instrumenteringstest |
| A5D-010 | 401/403, nätfel och credentialfel lämnar outbox pending och stoppar ordnad flush | Stationsenhetstest/Android instrumenteringstest |
| A5D-011 | UI visar saknad, aktiv, utgången och ogiltig auth med text/symbol utan färgberoende | Vy-/bundle-test |
| A5D-012 | CLI utfärdar, roterar och spärrar utan publikt provisionerings-API eller återläsbar plaintext | Applikations-/CLI-test |

## TASK 005E: kortlivad engångsparning

| ID | Scenario | Automatisering |
|---|---|---|
| A5E-001 | Giltigt kortlivat grant skapar exakt en device-/race-/READOUT-bunden credential och redemption | PostgreSQL-integrationstest |
| A5E-002 | Hundra samtidiga identiska inlösningar ger samma credentialmetadata och exakt en credential/redemption | PostgreSQL-integrationstest |
| A5E-003 | Ett konkurrerande annat attempt, device eller credentialhash kan inte ta över ett redan inlöst grant | PostgreSQL-integrationstest |
| A5E-004 | Exakt retry efter tappat svar eller grant-expiry returnerar samma metadata utan ny credential eller secret | PostgreSQL-integrationstest |
| A5E-005 | Utgånget, spärrat, felaktigt eller okänt grant ger generiskt negativt svar utan credential- eller rådatamutation | PostgreSQL-integration/Playwright |
| A5E-006 | Fem felaktiga försök inom tio minuter ger PostgreSQL-baserat 429 och fönstret återställs deterministiskt | PostgreSQL-integrationstest |
| A5E-007 | Grant-, revocation-, attempt- och redemptionrader är append-only och audit innehåller inga secrets eller hashvärden | PostgreSQL-integrationstest |
| A5E-008 | Pairing-route autentiserar före trasig JSON, validerar exakt kontrakt och svarar privat/no-store | Route-/Playwrighttest |
| A5E-009 | Native `begin` skapar SecureRandom-secret och krypterad pendingstate utan nätverk; separat `redeem` och reopen använder samma attempt/hash | JVM-/Android instrumenteringstest |
| A5E-010 | Native installerar credential före completed-markör och kan återhämta fel mellan stegen utan outboxmutation | Android instrumenteringstest |
| A5E-011 | Pluginstatus eller WebView får aldrig granttoken, credential-secret, token eller hash efter start | Stations-/Androidtest |
| A5E-012 | UI visar parning krävs, pågår, återuppta och lyckad med text/symbol utan färgberoende | Vy-/bundle-/Playwrighttest |
| A5E-013 | Den inlösta credentialen autentiserar befintliga package- och ingestflöden med oförändrad idempotens | PostgreSQL-integration/Playwright |

## TASK 005F: autentiserad pairingadministration

| ID | Scenario | Automatisering |
|---|---|---|
| A5F-001 | Accesscredential, session och CSRF lagras endast hashade; malformed/okänd/fel/expired/revoked ger generiskt 401 utan mutation | PostgreSQL-integration/route-test |
| A5F-002 | Produktionscookie är `__Host-`, Secure, HttpOnly för session, SameSite Strict och Path `/`; logout/revocation ogiltigförklarar sessionen | Route-/Playwrighttest |
| A5F-003 | Fel eller saknad Origin/CSRF, content type, för stor/extra body eller fel race avvisas före body/mutation/audit | Route-/PostgreSQLtest |
| A5F-004 | Hundra samtidiga identiska issue skapar ett grant och en actor-audit och returnerar samma metadata | PostgreSQL-integrationstest |
| A5F-005 | Samma idempotensnyckel med annan hash, actor eller race ger 409 utan ny rad | PostgreSQL-integrationstest |
| A5F-006 | Grantlistan är race-scopad, privat och visar ACTIVE/REDEEMED/REVOKED/EXPIRED utan token eller hash | Route-/Playwrighttest |
| A5F-007 | Hundra samtidiga revoke skapar en revocation/audit och samma `revokedAt`; fel races grant ger generisk 404 | PostgreSQL-integrationstest |
| A5F-008 | Sessionrevoke och issue/revoke följer sessions→grant-låsning och ingen mutation committar efter vunnen revoke | PostgreSQL-integrationstest |
| A5F-009 | Revoke före redeem stoppar inlösen; redeem före revoke lämnar skapad stationcredential giltig | PostgreSQL-integrationstest |
| A5F-010 | UI lagrar inga credentials/secrets i URL eller Web Storage, visar token exakt en gång och rensar vid explicit bekräftelse/reload | Vy-/Playwrighttest |
| A5F-011 | Webbutfärdat grant löses in via 005E och credentialen autentiserar package/ingest | Playwrighttest |
| A5F-012 | Audit identifierar operatorcredential/request men innehåller aldrig access-, session-, CSRF- eller pairingsecret/hash | PostgreSQL-integrationstest |

## TASK 005G: autentiserad IOF-import

| ID | Scenario | Automatisering |
|---|---|---|
| A5G-001 | `IMPORT_IOF` loggar in endast för exakt race; pairingcredential, fel race, expiry och revocation skapar ingen importsession | PostgreSQL-/route-test |
| A5G-002 | Import och pairing har separata host-only cookies med rätt Secure/HttpOnly/SameSite/Path-policy | Route-/Playwrighttest |
| A5G-003 | Origin, session, capability och CSRF verifieras före första bodybyte och igen under sessions-/credentiallås före commit | Route-/PostgreSQLtest |
| A5G-004 | Endast exakt `application/xml`, canonical request-id, 1–5 000 000 faktiska bytes och strikt UTF-8 accepteras | Route-test |
| A5G-005 | DTD, DOCTYPE, ENTITY och entity-expansion avvisas före parserarbete utan mutation eller intern feldetalj | IOF-/route-test |
| A5G-006 | Ogiltig stödd IOF XML ger stabilt privat 422 och lämnar import, request, snapshot och audit oförändrade | Route-/PostgreSQLtest |
| A5G-007 | Hundra samtidiga exakta requests skapar en importfil, requestrad, snapshotökning och actor-audit; resten är replay | PostgreSQL-integrationstest |
| A5G-008 | Samma request-id med annan actor, race eller serverhash ger 409 utan mutation | PostgreSQL-integrationstest |
| A5G-009 | Samma innehåll med nytt request-id skapar duplicate-request men ingen ny domänmutation, snapshot eller audit | PostgreSQL-integrationstest |
| A5G-010 | Logout eller credentialrevocation som vinner den andra authkontrollen blockerar importcommit | PostgreSQL-integrationstest |
| A5G-011 | CourseData och EntryList behåller atomär mappning, startregel och content-idempotens genom den skyddade ytan | PostgreSQL-/Playwrighttest |
| A5G-012 | UI behåller samma File/hash/request-id efter nätfel eller 401/403, retryar endast explicit och rensar först vid bekräftat utfall | Vy-/Playwrighttest |
| A5G-013 | Audit identifierar importcredential, request och importfil men innehåller aldrig XML, hash, namn, filnamn eller authhemligheter | PostgreSQL-integrationstest |
| A5G-014 | Befintlig pairingadmin, station, ingest, resultat och publikflöden regresserar inte | Full grind |

## TASK 005H: autentiserad klassändring

| ID | Scenario | Automatisering |
|---|---|---|
| A5H-001 | `CHANGE_ENTRY_CLASS` loggar in endast för exakt race; pairing/import, fel prefix/race, expiry och revocation skapar ingen klassession | PostgreSQL-/route-test |
| A5H-002 | Klassadmin har separata host-only cookies med rätt Secure/HttpOnly/SameSite/Path-policy | Route-/Playwrighttest |
| A5H-003 | Origin, session, capability, CSRF och idempotency-key verifieras före body och auth kontrolleras igen under lås | Route-/PostgreSQLtest |
| A5H-004 | Endast strikt versionsmärkt JSON i högst 4 KiB och strikt UTF-8 accepteras; fel är privata och detaljfria | Route-/kontraktstest |
| A5H-005 | Cross-race entry/klass ger 404; stale och no-op ger 409 utan request-, entry-, snapshot-, revision- eller auditmutation | PostgreSQL-integrationstest |
| A5H-006 | Hundra samtidiga exact retries ger en klassändring, snapshotökning, requestrad och actor-audit; resten är replay | PostgreSQL-integrationstest |
| A5H-007 | Samma request-id med annan actor/race/entry/klass/version ger 409; två request-id med samma expected version ger en vinnare | PostgreSQL-integrationstest |
| A5H-008 | Exact replay återger ursprungliga metadata efter en senare separat klassändring utan ny mutation eller audit | PostgreSQL-integrationstest |
| A5H-009 | Logout eller credentialrevocation som vinner transaktionsauth blockerar commit och requestjournalens update/delete avvisas | PostgreSQL-integrationstest |
| A5H-010 | Klassändringen skapar ingen `ResultRevision`; explicit omräkning anropas aldrig automatiskt | PostgreSQL-/Playwrighttest |
| A5H-011 | Klassunderlaget lämnas endast efter auth och den gamla öppna PATCH-routen kan inte längre mutera | Route-/Playwrighttest |
| A5H-012 | UI håller credential/pending request endast i minnet, retryar endast explicit och säger att resultat inte är omräknat | Vy-/Playwrighttest |
| A5H-013 | Audit identifierar actor/request och versionsskiftet utan namn, organisation eller authhemligheter | PostgreSQL-integrationstest |
| A5H-014 | Befintlig pairing, import, station, ingest, resultat och publikvy regresserar inte | Full grind |

## TASK 005I: autentiserad explicit resultatomräkning

| ID | Scenario | Automatisering |
|---|---|---|
| A5I-001 | `RECALCULATE_RESULT` loggar in endast för exakt race; andra capabilities, fel prefix/race, expiry och revocation skapar ingen session | PostgreSQL-/route-test |
| A5I-002 | Omräkning har separata host-only cookies med rätt Secure/HttpOnly/SameSite/Path-policy | Route-/Playwrighttest |
| A5I-003 | Origin, auth, capability, CSRF och canonical idempotency-key verifieras före body; auth görs igen under lås | Route-/PostgreSQLtest |
| A5I-004 | Endast strikt versionsmärkt JSON i högst 4 KiB och strikt UTF-8 accepteras; fel är privata och detaljfria | Route-/kontraktstest |
| A5I-005 | Kandidat-GET är privat och lämnar fryst intent utan bricknummer, punches, evaluation eller rawdata | Route-/PostgreSQLtest |
| A5I-006 | Giltig request skapar en publicerad `EXPLICIT_RECALCULATION`-revision, journal och actor-audit men ändrar ingen input-/snapshotrad | PostgreSQL-integrationstest |
| A5I-007 | Hundra concurrent exact retries ger en revision/journal/audit; två request-id från samma intent ger en vinnare | PostgreSQL-integrationstest |
| A5I-008 | Samma request-id med ändrad actor/race/entry/expected-kontext ger 409; replay efter senare händelser återger originalet | PostgreSQL-integrationstest |
| A5I-009 | Stale entry/klass/snapshot/assignment/readout/revision/engine ger 409 utan write | PostgreSQL-integrationstest |
| A5I-010 | Ingen/tvetydig assignment, saknad readout eller evaluation-mismatch ger 409 utan write; readoutval är deterministiskt | PostgreSQL-integrationstest |
| A5I-011 | Samtidig ingest ger obrutna revisioner och samtidig klass/import ger hel snapshot eller stale 409 utan deadlock | PostgreSQL-integrationstest |
| A5I-012 | Logout/revocation som vinner transaktionsauth blockerar commit; journal/resultatrevision är immutable | PostgreSQL-integrationstest |
| A5I-013 | Audit innehåller actor/request/resultatmetadata men inga namn, bricknummer, rawdata eller authhemligheter | PostgreSQL-integrationstest |
| A5I-014 | UI håller credential/pending intent endast i minnet, återhämtar tappad commit med samma request och gör ingen automatisk retry | Vy-/Playwrighttest |
| A5I-015 | Gamla POST-URL:en kräver rätt session, ingen bypass finns och klassändring startar aldrig automatisk omräkning | Route-/Playwrighttest |
| A5I-016 | Befintlig pairing, import, klassändring, station, ingest och publikresultat regresserar inte | Full grind |

## TASK 005J: autentiserad PII-fri tävlingsöversikt

| ID | Scenario | Automatisering |
|---|---|---|
| A5J-001 | `VIEW_RACE_OVERVIEW` loggar in endast för exakt race; andra capabilities, fel prefix/race, expiry och revocation skapar ingen session | PostgreSQL-/route-test |
| A5J-002 | Overview har separata host-only cookies med rätt Secure/HttpOnly/SameSite/Path-policy och max 1h session | Route-/Playwrighttest |
| A5J-003 | Förauth-HTML/RSC innehåller endast privat shell och aldrig race-, deltagar-, brick-, import- eller aktivitetsdata | Route-/Playwrighttest |
| A5J-004 | GET autentiserar och låser session→credential→race före SQL-projektion; avvisad auth kör ingen overviewfråga | Applikations-/PostgreSQLtest |
| A5J-005 | DTO:t är strikt och innehåller endast race-/eventstruktur, aggregat och senaste tider | Kontrakts-/route-test |
| A5J-006 | Canary-PII, brickor, punches, rawdata, evaluation, XML, rapport, hash, externa id:n och authmetadata förekommer aldrig i shell, svar eller fel | PostgreSQL-/Playwrighttest |
| A5J-007 | Alla counts, max och strukturrader är race-scopade och annat races canarydata påverkar aldrig svaret | PostgreSQL-integrationstest |
| A5J-008 | Hundra samtidiga GET ger inga writes/deadlocks; revoke/logout som vinner blockerar läsning och en vinnande läsning följs av unauthorized | PostgreSQL-integrationstest |
| A5J-009 | Samtidig snapshotmutation ger hel konfiguration före eller efter; samtidig ingest exponerar endast aggregat/aktivitet | PostgreSQL-integrationstest |
| A5J-010 | GET skriver ingen audit, requestjournal eller domänrad; issue/revoke auditeras utan secrets/hashes | PostgreSQL-integrationstest |
| A5J-011 | UI håller credential/DTO endast i minnet, pollar inte, uppdaterar explicit och rensar privat data direkt vid logoutbegäran | Vy-/Playwrighttest |
| A5J-012 | Overview-sessionen kan inte använda pairing/import/klass/omräkning/station och simulatorn finns inte på overviewytan | Route-/Playwrighttest |
| A5J-013 | Publikresultatsidan använder en separat minimal publik projektion och överläser ingen privat admin-/rawdata | Applikations-/Playwrighttest |
| A5J-014 | Befintlig pairing, import, klassändring, omräkning, station, ingest och publikresultat regresserar inte | Full grind |

## TASK 005K: autentiserat och idempotent tävlingsskapande

| ID | Scenario | Automatisering |
|---|---|---|
| A5K-001 | Global event-creation-credential loggar in endast med rätt prefix, hash, expiry och revocation | PostgreSQL-/route-test |
| A5K-002 | Sessionen har separata host-only cookies, max 1 h och rätt Secure/HttpOnly/SameSite/Path-policy | Route-/Playwrighttest |
| A5K-003 | Origin, session och CSRF avvisas före body-pull; application återautentiserar under lås | Route-/PostgreSQLtest |
| A5K-004 | Endast canonical key och strikt versionsmärkt UTF-8 JSON i högst 4 KiB accepteras; fel är detaljfria | Kontrakts-/route-test |
| A5K-005 | Event, exakt ett första lopp, requestjournal och actor-audit committar atomiskt | PostgreSQL-integrationstest |
| A5K-006 | Exact retry returnerar samma IDs; ändrad aktör eller något intentfält ger 409 utan write | PostgreSQL-integrationstest |
| A5K-007 | Hundra samtidiga identiska request ger en create/journal/audit och 99 replay utan deadlock | PostgreSQL-integrationstest |
| A5K-008 | Logout/revocation och create serialiseras i samma låsordning; journal och säkerhetsrader är immutable | PostgreSQL-integrationstest |
| A5K-009 | Audit/journal/svar saknar access-, session-, CSRF- och hashhemligheter | Kontrakts-/PostgreSQLtest |
| A5K-010 | UI håller credential och okänd commit endast i minnet, dubbelinskickslåser och retryar endast explicit | Vy-/Playwrighttest |
| A5K-011 | Publika `/` saknar createformulär/admincookies och ingen parallell öppen HTTP-bypass finns | Route-/Playwrighttest |
| A5K-012 | E2E-fixtures använder betrodd applicationkod; racecapabilities, station, ingest och publikresultat regresserar inte | Full grind |

## TASK 005L: fail-closed lokal utvecklingssimulator

| ID | Scenario | Automatisering |
|---|---|---|
| A5L-001 | Policyn tillåter endast exakt development + explicit mode + canonical HTTP-loopback-origin + matchande enkel authority | Webb-enhetstest |
| A5L-002 | Produktion/test, saknat/fel mode, malformed/icke-canonical origin, HTTPS, LAN/wildcard/lookalike och headeravvikelse ger avslag | Webb-enhetstest |
| A5L-003 | Avslag sker före routeparametrar/UUID/DB, anropar snapshot-loader noll gånger och lämnar inga simulator- eller racedetaljer | Webb-/route-test |
| A5L-004 | Tillåten lokal sida gör exakt en parametriserad `snapshot_version`-fråga; ogiltigt och okänt race ger 404 | Webb-/route-test |
| A5L-005 | Devservern binds till loopback och Playwright opt-in:ar explicit; simulatorns utvecklingsvarning och privata headers visas | Konfigurations-/Playwrighttest |
| A5L-006 | Reloadad localStorage-kö, ordnad flush, okänd commit, exact retry och autentiserad ingest regresserar inte | Webb-/Playwrighttest |
| A5L-007 | Standalone-produktion ger verklig generisk 404 med privata/noindex-headers trots fientlig modekonfiguration och otillgänglig DB | Produktionsprobe |
| A5L-008 | Station-package, device-batch, offline-SQLite, resultatrevision och publikresultat är oförändrade | Full grind |
| A5L-009 | Ingen migration, ny capability, SPORTidentparser, riktig USB, stafett, GPS eller höjd hårdvarustatus tillkommer | Dokument-/diffgranskning |

## TASK 005M: begränsad och strikt device-batch-ingress

| ID | Scenario | Automatisering |
|---|---|---|
| A5M-001 | Saknad/fel bearer och rätt credential med fel race/READOUT-scope ger 401/403 före första bodybyte | Webb-enhetstest/standaloneprobe |
| A5M-002 | Endast exakt `application/json` accepteras; annan eller parameteriserad medietyp ger detaljfritt privat 415 | Webb-enhetstest/E2E |
| A5M-003 | Canonical deklarerad längd 1–4 MiB krävs när headern finns; malformed, noll och faktisk mismatch ger 400 före ingest | Webb-enhetstest |
| A5M-004 | Faktisk chunked/streamad body räknas oberoende av header; exakt 4 MiB kan läsas och byte 4 MiB+1 ger 413 samt cancel | Webb-enhetstest |
| A5M-005 | Tom body, ogiltig UTF-8, trasig JSON, schemasvikt och okända batch/event/payload/punchfält ger generiskt 400 utan Zoddetalj | Kontrakts-/webbtest |
| A5M-006 | Fel body-device eller idempotency-key ger 403/400; ingest anropas noll gånger | Webb-enhetstest/E2E |
| A5M-007 | Realistisk 100×256-batch under 4 MiB når oförändrad ingest; Android behåller 512 KiB och single-event | Kontrakts-/webb-/stationstest |
| A5M-008 | Avslag skapar noll raw/readout/outcome/revision; efterföljande korrekt request blir stored och exact retry duplicate | PostgreSQL-/Playwrighttest |
| A5M-009 | 413/415 lämnar stationens pendingpost orörd, stoppar flush och applicerar ingen ack | Station-enhetstest |
| A5M-010 | Standalone med död DB svarar 401 på oavslutad chunked unauth-request före body completion utan DB-försök | Produktionsprobe |
| A5M-011 | Befintlig station-package, simulator, pairing, ingest, resultat och publikvy regresserar inte | Full grind |
| A5M-012 | Ingen migration, dependency, rate-limit/proxy, SPORTidentparser, riktig USB, stafett eller GPS tillkommer | Dokument-/diffgranskning |

## TASK 005N: autentiserad avläsnings- och resultathistorik

| ID | Scenario | Automatisering |
|---|---|---|
| A5N-001 | `VIEW_READOUT_RESULT_HISTORY` loggar in endast för exakt race; andra capabilities, prefix/race, expiry, logout och revocation avvisas före privat projektion | PostgreSQL-/route-test |
| A5N-002 | History har separata host-only cookies, högst 1 h session och privata no-store-/frame-/referrer-/MIME-headers | Route-/Playwrighttest |
| A5N-003 | Förauth-HTML/RSC innehåller bara shell och lopp-id, aldrig namn, bricka, punches, status eller revision | Route-/Playwrighttest |
| A5N-004 | List- och detalj-GET autentiserar och låser session→credential→race i repeatable read före SQL-projektion och gör inga writes | Applikations-/PostgreSQLtest |
| A5N-005 | Strikta bounded kontrakt och opaque keysetcursors avvisar okända fält, ogiltiga UUID/tider/limits/cursors och inkonsistent evaluation | Kontrakts-/route-test |
| A5N-006 | Feedpaginering med lika mottagningstid ger varje readout exakt en gång i statisk fixture | PostgreSQL-integrationstest |
| A5N-007 | Känd readout visar exakta normaliserade punches, första bedömning och alla publicerade/opublicerade revisionsorsaker | PostgreSQL-/Playwrighttest |
| A5N-008 | Okänd bricka syns med `entry: null` och tom historik; saknat äldre ingestutfall blir null utan fabricerad revision | PostgreSQL-integrationstest |
| A5N-009 | Fryst `upperRevision` är stabilt när omräkning appendar mellan sidor; en ny detaljrequest ser den nya revisionen | PostgreSQL-integrationstest |
| A5N-010 | Ett annat lopps kanariedata och raw-/device-/hash-/import-/auth-/auditfält förekommer aldrig i DTO, shell eller detaljfria fel | Kontrakts-/PostgreSQL-/Playwrighttest |
| A5N-011 | Hundra samtidiga GET gör noll writes; logout/revoke och snapshotmutation serialiserar utan auth→data-lucka | PostgreSQL-integrationstest |
| A5N-012 | UI visar kod plus svensk förklaring, paginerar explicit, pollar/auto-retryar inte och rensar all privat state före logout | UI-/Playwrighttest |
| A5N-013 | Befintlig översikt, parning, import, klassändring, omräkning, station, ingest, simulator och publikresultat regresserar varken beteende eller capabilityisolering | Full grind |
| A5N-014 | Ingen generell roll, resultatmutation, parser, riktig USB, stafett, GPS, Eventor eller ruttanalys tillkommer | Dokument-/diffgranskning |

## TASK 006A: autentiserad IOF StartList-import

| ID | Scenario | Automatisering |
|---|---|---|
| A6A-001 | Officiellt strukturerad individuell IOF 3.0 StartList tolkas via Class.Id/EntryId och tidszon normaliseras till UTC | Parser-/fixturetest |
| A6A-002 | Fel namespace/version, team, raceNumber ≠ 1, flera Start, saknad/tidszonlös/ogiltig StartTime samt okända fält avvisas | Parser-/kontraktstest |
| A6A-003 | Okänd/duplicerad klass eller entry, klasskonflikt och partiell klasscoverage ger atomiskt avslag utan domän-/import-/auditwrite | PostgreSQL-integrationstest |
| A6A-004 | Rätt IMPORT_IOF-session lagrar original/hash/rapport, sätter FIXED/starttid och ökar entry-/snapshotversion endast vid faktisk delta | PostgreSQL-/route-test |
| A6A-005 | Exact request-retry och samma content med nytt request-id skapar inga extra mutationer | PostgreSQL-/Playwrighttest |
| A6A-006 | Importen skapar ingen resultatrevision; rapport/audit räknar ändrade entries med tidigare resultat för separat explicit omräkning | PostgreSQL-integrationstest |
| A6A-007 | Tidigare raw, readout och resultatrevision förblir radmässigt oförändrade; importaudit saknar namn/XML/hemligheter | PostgreSQL-integrationstest |
| A6A-008 | Senare CourseData bevarar FIXED och senare EntryList bevarar fixedStartTime | PostgreSQL-integrationstest |
| A6A-009 | Nytt signerat stationpaket innehåller nya tider; gammalt paket förblir verifierbart och synk markeras stale | PostgreSQL-/stationstest |
| A6A-010 | Import-UI nämner StartList och visar klass-/start-/ändringsantal utan ny route, cookie eller capability | UI-/Playwrighttest |
| A6A-011 | Befintlig CourseData/EntryList, ingest, historik och publikresultat regresserar inte | Full grind |
| A6A-012 | Ingen Eventor-klient, startlottning, multi-race, stafett, SPORTident, GPS eller karta tillkommer | Dokument-/diffgranskning |

## TASK 006B: autentiserad IOF ResultList-export

| ID | Scenario | Automatisering |
|---|---|---|
| A6B-001 | `EXPORT_IOF_RESULT_LIST` loggar in endast för exakt race; andra capabilities, prefix/race, expiry, logout och revocation avvisas före projektion | PostgreSQL-/route-test |
| A6B-002 | Exporten har egna host-only cookies, högst 1 h session och privata attachment-/no-store-/MIME-/frame-/referrer-headers | Route-/Playwrighttest |
| A6B-003 | Senaste `published=true` per entry väljs; nyare opublicerad revision läcker inte och äldre snapshot räknas utan att filtreras | PostgreSQL-integrationstest |
| A6B-004 | Revisionens historiska classId/courseVersionId/evaluation används medan aktuellt namn/organisation uttryckligen är displaydata | PostgreSQL-integrationstest |
| A6B-005 | `OK`/`MP` blir `OK`/`MissingPunch`; entry utan revision blir inte DNS och korrupt/unsupported evaluation avvisas fail closed | Serializer-/PostgreSQLtest |
| A6B-006 | Historiska course controls ger `OK` eller `Missing` splits i sekvens; upprepade koder matchas per occurrence och start/mål/extra utelämnas | Serializer-/fixturetest |
| A6B-007 | XML har IOF 3.0-namespace, Snapshot, exakt ms→sekund, säker escaping, giltiga XML 1.0-tecken, fast ordning, LF och slutnewline | Serializer-goldentest |
| A6B-008 | Interna UUID:n, bricknummer, raw/readout, audit/auth/import, opublicerad data, extensions och GPS förekommer aldrig | Kontrakts-/PostgreSQL-/Playwrighttest |
| A6B-009 | Event med flera races samt bounded overflow avvisas; IOF raceNumber fabriceras inte | Applikations-/PostgreSQLtest |
| A6B-010 | Hundra repeatable-read GET utan writer ger identiska bytes/ETag och noll writes; samtidig ingest ger helt före/efter-läge | PostgreSQL-integrationstest |
| A6B-011 | Browserdownload verifierar filnamn, headers, räknare och bytes samt använder ingen URL-hemlighet eller Web Storage | UI-/Playwrighttest |
| A6B-012 | Befintlig import, omräkning, historik, station, ingest och publikresultat regresserar; ingen Eventor, arkiv, stafett, USB eller GPS tillkommer | Full grind/diffgranskning |

## TASK 006C: domänägd klassranking

| ID | Scenario | Automatisering |
|---|---|---|
| A6C-001 | Domänfunktionen ger competition ranking `1,1,3` och `1,2,2,4`; lika millisekunder delar placering och vinnare får time-behind noll | Domänenhetstest |
| A6C-002 | MP och mängd med endast MP visas utan Position/TimeBehind; status eller tid fabriceras aldrig | Domän-/serializer-/UI-test |
| A6C-003 | Dubblettnyckel, okänd status, tom banversion, negativ/osäker/icke-heltalstid avvisas fail closed | Domänenhetstest |
| A6C-004 | Permuterad input ger samma nyckel→ranking; stabil visningssortering påverkar inte delad position | Domänenhetstest |
| A6C-005 | Fler än en course-version bland klassens OK-resultat ger `MIXED_COURSE_VERSIONS` och inga rankingfält för hela klassen | Domän-/PostgreSQL-/UI-test |
| A6C-006 | Senaste publicerade revision per entry och revisionens historiska klass används; nyare opublicerad och aktuell entryklass påverkar inte | PostgreSQL-integrationstest |
| A6C-007 | Publik API-respons är strikt versionerad och saknar result-, entry-, class-, course-, readout-, raw- och auth-id:n | Kontrakts-/route-/Playwrighttest |
| A6C-008 | Publikvyn visar Placering/Efter och en textförklaring när blandade banversioner stoppar ranking | UI-/Playwrighttest |
| A6C-009 | IOF skriver `Time`, `TimeBehind`, `Position`, `Status` i exakt ordning, med exakta decimalsekunder | Serializer-goldentest |
| A6C-010 | IOF avvisar halvt rankingpar, ranking på MP, noll/negativ position samt negativ/osäker time-behind | Serializer-test |
| A6C-011 | Publikresultat och IOF-export visar samma position/time-behind för samma immutable underlag | PostgreSQL-/Playwrighttest |
| A6C-012 | Hundra exporter ger identiska bytes/hash och noll writes; samtidig ingest ger helt före/efter-läge | PostgreSQL-integrationstest |
| A6C-013 | Ingen migration, resultatrevisionsmutation, ny capability, Eventor, stafett, GPS, SPORTident-parser eller riktig USB tillkommer | Full grind/diffgranskning |

## TASK 006D: immutable individuell resultatfinalisering

| ID | Scenario | Automatisering |
|---|---|---|
| A6D-001 | `FINALIZE_RESULTS` loggar in endast för exakt race; annan capability/prefix/race, expiry, logout och revocation avvisas före kandidat/body | PostgreSQL-/route-test |
| A6D-002 | Finalisering har egna host-only cookies, högst 1 h session, strikt CSRF/Origin och högst 4 KiB versionsmärkt body | Route-/Playwright-/kontraktstest |
| A6D-003 | Kandidaten lämnar klassnamn, räknare, blockerarkoder, snapshot/hash och senaste revision men inga deltagarnamn, brickor, punches, rawdata eller evaluation | Kontrakts-/route-/PostgreSQLtest |
| A6D-004 | Full icke-tom klass med senaste publicerade `OK`/`MP` på aktuell snapshot/klass/bana finaliseras med deterministic frozen projection och hash | PostgreSQL-integrationstest |
| A6D-005 | Saknad eller stale revision, nyare opublicerad revision, korrupt evaluation, class/course mismatch och mixed course ger 409 utan finalisering/audit | PostgreSQL-integrationstest |
| A6D-006 | Loppsfinalisering kräver minst en entry och en exakt aktuell klassfinalisering per icke-tom aktuell klass; ofullständigt manifest ger 409 | PostgreSQL-integrationstest |
| A6D-007 | Olöst `UNKNOWN_CARD` blockerar loppet; resultatrevision på avläsningen löser blockeringen utan fabricerad DNS/DNF/DSQ | PostgreSQL-integrationstest |
| A6D-008 | Hundra concurrent exact retries ger en immutable rad/audit; två request-id:n serialiseras till obrutna scope-revisioner | PostgreSQL-integrationstest |
| A6D-009 | Samma request-id med ändrad actor/race/scope/class/snapshot/hash/revision ger 409; replay efter senare data återger originalet | PostgreSQL-integrationstest |
| A6D-010 | Finalisering och samtidig ingest/import/klassändring/omräkning ser helt före/efter under race-lås utan deadlock eller snapshotmutation | PostgreSQL-integrationstest |
| A6D-011 | `Complete` kräver runtimevaliderat finaliseringsbevis; liveexporten förblir `Snapshot` och multi-race avvisas | Serializer-/applikationstest |
| A6D-012 | Fryst download läser exakt sparade XML-bytes och hash över 100 läsningar, även efter senare display-, control- eller result changes | PostgreSQL-/route-test |
| A6D-013 | Complete-XML täcker exakt varje fryst entry en gång, mappar OK/MP, behåller ranking/splits/ordning och läcker inga interna bevis-, raw- eller authfält | Serializer-/PostgreSQL-/Playwrighttest |
| A6D-014 | Privat svensk UI gör kandidat → klassbeslut → loppsbeslut; credentials/pending intent hålls endast i minnet och retry sker endast explicit | UI-/Playwrighttest |
| A6D-015 | Update/delete på finalisering avvisas och rollbacknoten kräver spärr/roll-forward/full backup, aldrig destruktiv historikändring | Migration-/PostgreSQLtest |
| A6D-016 | Ingen ny resultatstatus, automatisk omräkning/publicering, Eventor, stafett, GPS, SPORTident-parser, riktig USB eller stationsändring tillkommer | Full grind/diffgranskning |

## TASK 006E: explicit individuellt ej-startbeslut

| ID | Scenario | Automatisering |
|---|---|---|
| A6E-001 | `DECIDE_DID_NOT_START` loggar in endast för exakt race; annan capability/prefix/race, expiry, logout och revocation avvisas före kandidat/body | PostgreSQL-/route-test |
| A6E-002 | DNS-sessionen har egna host-only cookies, högst 1 h session, strikt Origin/CSRF och högst 4 KiB strikt versionsmärkt JSON | Route-/Playwright-/kontraktstest |
| A6E-003 | Kandidat-GET lämnar endast namn, organisation, klass och fryst versions-/revisionsunderlag efter auth; ingen bricka, punch, rawdata eller full evaluation | Kontrakts-/route-/PostgreSQLtest |
| A6E-004 | Giltig entry utan tidigare revision skapar atomiskt immutable beslut, publicerad revision 1 med DNS/DID_NOT_START/MANUAL_DID_NOT_START, null readout och en actor-audit | PostgreSQL-integrationstest |
| A6E-005 | Saknad/stale entry, klass, bana, snapshot, policy eller befintlig revision ger 409 utan beslut, revision eller audit | PostgreSQL-integrationstest |
| A6E-006 | Hundra samtidiga exact retries ger ett beslut/revision/audit; ändrad actor/race/entry/intent med samma request-id ger 409 | PostgreSQL-integrationstest |
| A6E-007 | Samtidig ingest ger antingen DNS revision 1 följd av CARD_READOUT revision 2 eller CARD_READOUT revision 1 och write-fritt DNS-avslag | PostgreSQL-integrationstest |
| A6E-008 | Databasconstraint avvisar manuell orsak med readout, kortorsak utan readout eller fel beslutsreferens; beslut och revision är immutable | Migration-/PostgreSQLtest |
| A6E-009 | Kortmotorn och stationens evaluation producerar/accepterar fortsatt inte DNS; endast den separata lagrade ResultOutcome-unionen gör det | Domän-/kontraktstest |
| A6E-010 | Domänranking lämnar DNS orankad och oförändrar OK-placering/tid efter; publikvyn visar Ej start utan tid/splits/placering | Domän-/kontrakts-/UI-/Playwrighttest |
| A6E-011 | Snapshot och Complete mappar explicit DNS till status-only `DidNotStart`; serializeraren avvisar tider, ranking, controls eller splits på DNS | Serializer-/fixture-/PostgreSQLtest |
| A6E-012 | OK+MP+explicit DNS kan klass-/loppsfinaliseras; saknad revision eller olöst UNKNOWN_CARD blockerar fortsatt och gamla Complete-bytes är stabila | PostgreSQL-/Playwrighttest |
| A6E-013 | UI håller credential och okänd commit endast i React-minne, retryar explicit med exakt samma intent och rensar privat state vid logout | UI-/Playwrighttest |
| A6E-014 | Audit/DTO/fel saknar token-, cookie-, CSRF-, hash-, raw- och punchhemligheter | Kontrakts-/PostgreSQL-/route-test |
| A6E-015 | Full grind regresserar inte ingest, omräkning, historik, export, finalisering, station eller offlinekö; ingen DNF/DSQ/Eventor/stafett/GPS/parser/USB tillkommer | Full grind/diffgranskning |

## TASK 006F: explicit återtagande av manuellt ej-startbeslut

| ID | Scenario | Automatisering |
|---|---|---|
| A6F-001 | Endast separat `WITHDRAW_DID_NOT_START` för exakt race kan logga in/lista/skriva; andra capabilities, prefix, race, Origin, CSRF, expiry och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6F-002 | Listan visar bounded manuella beslut som `WITHDRAWABLE`, `WITHDRAWN` eller `SUPERSEDED` med minimal metadata och utan bricka, punches, rawdata, full evaluation eller hemligheter | Kontrakts-/PostgreSQL-/UI-test |
| A6F-003 | Giltigt target måste vara strikt manuell DNS med korrekt decision↔revision↔race↔entry-provenans och entryns absoluta resultathuvud | Domän-/PostgreSQL-integrationstest |
| A6F-004 | En lyckad mutation skapar exakt en immutable withdrawal och audit men noll resultatrevisioner, rawposter, readouts eller snapshotändringar | PostgreSQL-integrationstest |
| A6F-005 | Stale entry/klass/bana/snapshot/decision/revision och senare resultatrevision ger konflikt utan domänwrite | Kontrakts-/PostgreSQL-integrationstest |
| A6F-006 | Hundra samtidiga exact retries ger en withdrawal/audit; ändrat intent eller actor med samma request-id och två request-id:n mot samma target ger konflikt | PostgreSQL-integrationstest |
| A6F-007 | Om withdrawal vinner får senare ingest revision 2; om ingest vinner blockeras withdrawal utan partiell write | PostgreSQL-integrationstest |
| A6F-008 | Publik och Snapshot går från DNS till ingen aktiv rad utan fallback; omittedEntryCount ökar och senare riktig revision visas normalt | Domän-/applikations-/PostgreSQLtest |
| A6F-009 | Withdrawal före ny finalisering ger `WITHDRAWN_DID_NOT_START`; finalisering före withdrawal behåller historisk Complete XML/hash byte-exakt men aktuell basis blir stale | PostgreSQL-integrationstest |
| A6F-010 | DB-komposit-FK/unique/check och immutable-trigger avvisar felparning, dubbelt target, update och delete | Migration-/PostgreSQLtest |
| A6F-011 | Svenskt UI kräver separat bekräftelse, lagrar credential/pending intent endast i minnet och auto-retryar aldrig okänd commit; explicit retry återanvänder request-id | UI-/Playwrighttest |
| A6F-012 | Full grind regresserar inte DNS, ingest, ranking, historik, export, finalisering, station eller offlinekö; ingen DNF/DSQ/Eventor/stafett/GPS/parser/USB tillkommer | Full grind/diffgranskning |

## TASK 006G: manuell diskvalifikation med återtagande

| ID | Scenario | Automatisering |
|---|---|---|
| A6G-001 | Endast separata `DISQUALIFY_RESULT` respektive `WITHDRAW_DISQUALIFICATION` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6G-002 | Båda sessionerna har egna host-only cookies, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6G-003 | Kandidat/list-DTO visar endast minimal namn-, organisation-, klass-, revisions- och livscykelmetadata; aldrig bricka, punch, rawdata, full evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6G-004 | Exakt aktuellt publicerat readoutbaserat OK eller MP skapar atomiskt immutable decision, publicerad DSQ-revision och actor-audit utan raw/readout/snapshotwrite | Domän-/PostgreSQL-integrationstest |
| A6G-005 | DSQ-konstruktorn bevarar entry/klass/bana, tider, controls och splits exakt, ändrar bara status/reason och avvisar DNS/UNKNOWN_CARD/DSQ/korrupt källa | Domän-/kontraktstest |
| A6G-006 | Stale entry/klass/bana/snapshot/target, nyare opublicerad revision, återtaget DNS utan aktivt resultat och redan aktiv DSQ ger 409 utan domänwrite | PostgreSQL-integrationstest |
| A6G-007 | Senare ingest/omräkning appenderar teknisk revision men gemensam resolver låter aktiv DSQ styra publik, Snapshot och finaliseringsbasis tills withdrawal | Domän-/applikations-/PostgreSQLtest |
| A6G-008 | Withdrawal utan senare teknisk revision appenderar exakt originaltargetets OK/MP; efter senare revision appenderas exakt den intentbundna senaste giltiga källans utfall | Domän-/PostgreSQL-integrationstest |
| A6G-009 | Hundra samtidiga exact retries ger en decision/withdrawal, en respektive revision och audit; ändrad actor/target/head/source/intent med samma request-id konflikterar | PostgreSQL-integrationstest |
| A6G-010 | Samtidig ingest, beslut, withdrawal och finalisering följer race→entry→revision, ger obrutna revisioner och helt före/efter utan deadlock eller automatisk källändring | PostgreSQL-integrationstest |
| A6G-011 | Komposit-FK/unique/check och immutable-trigger avvisar korskopplad decision/DSQ/source/restoration, dubbelt withdrawal, update och delete | Migration-/PostgreSQLtest |
| A6G-012 | Ranking lämnar DSQ orankad med ordningen OK, MP, DSQ, DNS; publik visar Diskvalificerad med källtid/splits men utan position/tid efter | Domän-/kontrakts-/UI-/Playwrighttest |
| A6G-013 | IOF Snapshot och ny Complete mappar DSQ till `Disqualified`, bevarar tillåtna tider/splits, förbjuder ranking och läcker inga interna beslut/reason/proveniensfält | Serializer-/fixture-/PostgreSQLtest |
| A6G-014 | Finaliseringsformat 2 fryser effektiv DSQ samt decision/target/underliggande head; format 1 förblir läsbart och äldre Complete XML/hash är byte-exakt efter withdrawal | Kontrakts-/PostgreSQL-integrationstest |
| A6G-015 | Historiken visar target→DSQ→senare teknik→restoration utan mutation; stationens evaluation/ack fortsätter avvisa DSQ | Kontrakts-/PostgreSQL-/stationstest |
| A6G-016 | Två svenska tvåstegsytor håller credential/pending intent endast i minnet, har minst 52 px touchmål/textstatus och auto-retryar aldrig okänd commit | UI-/Playwright-/CSS-test |
| A6G-017 | Full grind och tom PostgreSQL-restore från migration 0000–0016 passerar; ingen DNF/Eventor/stafett/GPS/parser/riktig USB/generell resultateditor tillkommer | Full grind/migrationsgranskning |

## TASK 006H: manuellt resultatgodkännande med återtagande

| ID | Scenario | Automatisering |
|---|---|---|
| A6H-001 | Endast separata `APPROVE_RESULT` respektive `WITHDRAW_RESULT_APPROVAL` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6H-002 | Egna host-only session-/CSRF-cookies, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6H-003 | Kandidat/list-DTO är bounded och visar bara minimal display-, klass-, versions-, revisions- och livscykelmetadata; aldrig bricka, punches, rawdata, evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6H-004 | Exakt aktuellt publicerat tekniskt `MP/MISSING_CONTROL` eller `MP/WRONG_ORDER` med giltig tid skapar atomiskt immutable decision, `OK/MANUAL_APPROVAL`-revision och audit utan raw/readout/snapshotwrite | Domän-/PostgreSQL-integrationstest |
| A6H-005 | Konstruktorn deep-kopierar identitet, tider, controls och splits, ändrar bara status/reason och avvisar tidslöst/korrupt MP samt andra statusar | Domän-/kontraktstest |
| A6H-006 | Stale entry/klass/bana/snapshot/target, opublicerad/manuell revision och aktiv approval/DSQ ger konflikt utan domänwrite | PostgreSQL-integrationstest |
| A6H-007 | Senare ingest/omräkning appenderar teknisk revision men gemensam resolver låter aktiv approval styra publik, ranking, Snapshot och finalisering tills withdrawal | Domän-/applikations-/PostgreSQLtest |
| A6H-008 | Withdrawal utan senare teknik restaurerar original-MP; med senare teknik restaureras exakt intentbunden senaste giltiga tekniska OK/MP-källa | Domän-/PostgreSQL-integrationstest |
| A6H-009 | Hundra samtidiga exact retries ger en decision/withdrawal, en respektive revision och audit; ändrad actor/target/head/source/intent konfliktar | PostgreSQL-integrationstest |
| A6H-010 | Samtidig ingest, approval, withdrawal och finalisering följer race→entry→revision och ger helt före/efter utan automatisk källändring | PostgreSQL-integrationstest |
| A6H-011 | Komposit-FK/unique/check och immutable-trigger avvisar korskopplad decision/approval/source/restoration, dubbelt target/withdrawal, update och delete | Migration-/PostgreSQLtest |
| A6H-012 | Approval rankas som OK med exakt källtid, millisekundtie och mixed-course-policy; withdrawal härleder om hela klassen | Domän-/kontrakts-/PostgreSQLtest |
| A6H-013 | Publik format 3 visar svensk manuell provenans och ranking; format 1/2 förblir läsbara och inga interna id:n läcker | Kontrakts-/UI-/Playwrighttest |
| A6H-014 | IOF Snapshot/Complete skriver `OK`; saknad split tillåts endast med strikt `manualApprovalProof`, skrivs `Missing` utan tid och proof/proveniens serialiseras aldrig | Serializer-/fixture-/PostgreSQLtest |
| A6H-015 | Finaliseringsformat 3 fryser approval/target/underliggande head; format 1/2 förblir läsbara och äldre Complete XML/hash är byte-exakt efter withdrawal | Kontrakts-/PostgreSQL-integrationstest |
| A6H-016 | Historik format 3 visar MP→approval→senare teknik→restoration; stationens evaluation/ack fortsätter avvisa `MANUAL_APPROVAL` | Kontrakts-/PostgreSQL-/stationstest |
| A6H-017 | Två svenska tvåstegsytor har separata capabilities, synligt fokus, minst 52 px touchmål, text+symbol, minnesburet intent och endast explicit same-id-retry efter okänd commit | UI-/route-/Playwright-/CSS-test |
| A6H-018 | Full grind och tom PostgreSQL-restore från migration 0000–0017 passerar; ingen DNF/kontrollneutralisering/Eventor/stafett/GPS/parser/riktig USB/editor tillkommer | Full grind/migrationsgranskning |

## TASK 006I: explicit individuellt ej fullföljt

| ID | Scenario | Automatisering |
|---|---|---|
| A6I-001 | Endast `DECIDE_DID_NOT_FINISH` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6I-002 | Egen host-only session/CSRF, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6I-003 | Kandidat-DTO är bounded och visar endast minimal display-, versions- och targetmetadata; aldrig bricka, punches, rawdata, evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6I-004 | Exakt absolut aktuellt, publicerat och tekniskt `OK|MP` skapar atomiskt immutable decision, status-only `DNF/DID_NOT_FINISH` och audit utan raw/readout/snapshotwrite | Domän-/PostgreSQL-integrationstest |
| A6I-005 | DNF-konstruktorn bevarar endast entry/klass/bana och avvisar manuell/okänd/korrupt källa; outcome saknar alltid tider, controls och splits | Domän-/kontraktstest |
| A6I-006 | Stale entry/klass/bana/snapshot/target, nyare opublicerad eller manuell head och aktiv DNS/DSQ/approval/DNF ger konflikt utan domänwrite | PostgreSQL-integrationstest |
| A6I-007 | Gemensam entry-låst manual-grind gör DNS/DSQ/approval/DNF ömsesidigt uteslutande och failar stängt på dubbelaktiv/korrupt provenance | Applikations-/PostgreSQLtest |
| A6I-008 | Approval→senare teknik→DSQ blockeras; aktiv DNF blockerar nya DSQ/approval och senare teknik upphäver ingen aktiv manual-overlay | PostgreSQL-integrationstest |
| A6I-009 | Hundra samtidiga exact retries ger en decision/revision/audit; ändrad actor/target/intent konflikterar och två request-id:n mot samma entry ger en vinnare | PostgreSQL-integrationstest |
| A6I-010 | Om ingest vinner blir DNF stale utan write; om DNF vinner appenderas senare teknik medan levande publik/Snapshot/finalisering förblir DNF | PostgreSQL-integrationstest |
| A6I-011 | Komposit-FK/unique/check och immutable-trigger avvisar korskopplad target/decision/DNF, dubbelt request/target/entry, update och delete | Migration-/PostgreSQLtest |
| A6I-012 | DNF är orankad med ordningen OK, MP, DSQ, DNF, DNS och publik format 4 visar Ej fullföljt utan tid/ranking/controls/splits | Domän-/kontrakts-/UI-/Playwrighttest |
| A6I-013 | IOF Snapshot och ny Complete mappar DNF till `DidNotFinish` med endast Status och läcker ingen intern reason/provenans | Serializer-/fixture-/PostgreSQLtest |
| A6I-014 | Finaliseringsformat 4 fryser DNF decision/target/effective/underlying head; format 1–3 läses och äldre Complete XML/hash förblir byte-exakta | Kontrakts-/PostgreSQL-integrationstest |
| A6I-015 | Historik format 4 visar tekniskt target→DNF; stationens evaluation/ack och device-batch-kontrakt fortsätter avvisa DNF | Kontrakts-/PostgreSQL-/stationstest |
| A6I-016 | Svensk tvåstegsyta har separat capability, synligt fokus, minst 52 px touchmål, text+symbol, minnesburet intent och endast explicit same-id-retry efter okänd commit | UI-/route-/Playwright-/CSS-test |
| A6I-017 | Full grind och tom PostgreSQL-restore från migration 0000–0018 passerar; ingen DNF-withdrawal/tid/kontrollneutralisering/Eventor/stafett/GPS/parser/riktig USB/editor tillkommer | Full grind/migrationsgranskning |

## TASK 006J: append-only återtagande av individuellt DNF

| ID | Scenario | Automatisering |
|---|---|---|
| A6J-001 | Endast `WITHDRAW_DID_NOT_FINISH` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6J-002 | Egen host-only session/CSRF, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6J-003 | Withdrawal-listan är bounded och visar bara minimal display-, versions-, decision-, head- och sourcemetadata; aldrig tider, bricka, punches, rawdata, evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6J-004 | Exakt aktiv reciprocal DNF-kedja utan senare teknik skapar atomiskt immutable withdrawal, publicerad restoration från originaltarget och audit utan raw/readout/snapshotmutation | Domän-/PostgreSQL-integrationstest |
| A6J-005 | Efter senare ingest restaureras exakt den intentbundna direkta publicerade tekniska latest-`OK|MP`-revisionen; ingen äldre fallback tillåts | Domän-/PostgreSQL-integrationstest |
| A6J-006 | Opublicerat, manuellt, korrupt, stödfrämmande eller stale absolut huvud/source och redan återtaget DNF ger konflikt utan domänwrite | PostgreSQL-integrationstest |
| A6J-007 | Resolvern kräver exakt decision↔target↔DNF↔withdrawal↔source↔restoration och normalt huvud restoration/senare; varje mismatch failar stängt | Domän-/applikationstest |
| A6J-008 | Flera historiska DNF-kedjor tillåts men högst en aktiv; ett nytt DNF kräver ny direkt teknisk revision och får inte targeta restorationen | Applikations-/PostgreSQLtest |
| A6J-009 | Hundra samtidiga exact retries ger en withdrawal/revision/audit; ändrad actor eller ett intentfält konflikterar och två request-id:n ger en vinnare | PostgreSQL-integrationstest |
| A6J-010 | Om ingest vinner blir withdrawal stale utan write; om withdrawal vinner blir restoration `N+1` och senare ingest `N+2` med obruten latest-semantik | PostgreSQL-integrationstest |
| A6J-011 | Samtidig finalisering och withdrawal serialiseras helt under racelås; aktuell basis blir stale men äldre Complete-bytes/hash ändras aldrig | PostgreSQL-integrationstest |
| A6J-012 | Komposit-FK/unique/check och immutable-trigger avvisar fel race/entry/revision/decision/head/source/restoration, dubbel withdrawal, update och delete | Migration-/PostgreSQLtest |
| A6J-013 | Publik format 4 och Snapshot går från status-only DNF till exakt restaurerat `OK|MP`; OK rankas på nytt och MP förblir orankat | Domän-/kontrakts-/PostgreSQL-/UI-test |
| A6J-014 | IOF använder vanlig `OK`/`MissingPunch` efter withdrawal, läcker inga interna id:n och äldre Complete med `DidNotFinish` är byte-exakt | Serializer-/fixture-/PostgreSQLtest |
| A6J-015 | Historik format 5 visar target→DNF→eventuell senare teknik→restoration och format 1–4 förblir läsbara | Kontrakts-/PostgreSQLtest |
| A6J-016 | Finaliseringsformat 5 fryser withdrawal/source/restoration; format 1–4 läses och ny Complete använder exakt restaurerat outcome | Kontrakts-/PostgreSQL-integrationstest |
| A6J-017 | Svensk tvåstegsyta har separat capability, synligt fokus, minst 52 px touchmål, text+symbol, minnesburet intent och endast explicit same-id-retry efter okänd commit | UI-/route-/Playwright-/CSS-test |
| A6J-018 | Full grind och restore både 0000→0019 och befintlig 0018→0019 passerar; ingen editor/tid/kontrollneutralisering/Eventor/stafett/GPS/parser/riktig USB tillkommer | Full grind/migrationsgranskning |

## TASK 006K: explicit individuellt utom tävlan

| ID | Scenario | Automatisering |
|---|---|---|
| A6K-001 | Endast `DECIDE_OUT_OF_COMPETITION` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6K-002 | Egen host-only session/CSRF, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6K-003 | Kandidat-DTO är bounded och visar endast minimal display-, versions- och targetmetadata; aldrig bricka, punches, rawdata, evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6K-004 | Exakt absolut aktuellt, publicerat och direkt tekniskt `OK|MP` skapar atomiskt immutable decision, `OOC/OUT_OF_COMPETITION` och audit utan raw/readout/snapshotwrite | Domän-/PostgreSQL-integrationstest |
| A6K-005 | OOC-konstruktorn deep-kopierar identitet, tider, controls och splits och ändrar endast status/reason; manuell/restaurerad/okänd/korrupt källa avvisas | Domän-/kontraktstest |
| A6K-006 | Stale entry/klass/bana/snapshot/target, nyare opublicerad eller manuell head och aktiv DNS/DSQ/approval/DNF/OOC ger konflikt utan domänwrite | PostgreSQL-integrationstest |
| A6K-007 | Gemensam entry-låst manualgrind gör DNS/DSQ/approval/DNF/OOC ömsesidigt uteslutande och failar stängt på dubbelaktiv/korrupt provenance | Applikations-/PostgreSQLtest |
| A6K-008 | Hundra samtidiga exact retries ger en decision/revision/audit; ändrad actor/target/intent konflikterar och två request-id:n mot samma entry ger en vinnare | PostgreSQL-integrationstest |
| A6K-009 | Om ingest vinner blir OOC stale utan write; om OOC vinner appenderas senare teknik medan levande publik/Snapshot/finalisering förblir OOC | PostgreSQL-integrationstest |
| A6K-010 | Komposit-FK/unique/check och immutable-trigger avvisar korskopplad target/decision/OOC, dubbelt request/target/entry, update och delete | Migration-/PostgreSQLtest |
| A6K-011 | OOC är orankad med ordningen OK, MP, DSQ, DNF, OOC, DNS; bevarade tekniska fakta påverkar inte OK-ranking eller mixed-course | Domän-/kontrakts-/PostgreSQLtest |
| A6K-012 | Publik format 5 visar Utom tävlan med targetens fakta men utan ranking eller interna id:n; format 1–4 förblir läsbara | Kontrakts-/UI-/Playwrighttest |
| A6K-013 | IOF Snapshot och ny Complete mappar OOC till `NotCompeting`, bevarar tillåtna tider/splits och förbjuder Position/TimeBehind/proof/provenans | Serializer-/fixture-/PostgreSQLtest |
| A6K-014 | Finaliseringsformat 6 fryser OOC decision/target/effective/underlying head; format 1–5 läses och äldre Complete XML/hash förblir byte-exakta | Kontrakts-/PostgreSQL-integrationstest |
| A6K-015 | Historik format 6 visar tekniskt target→OOC→eventuell senare teknik; äldre format förblir låsta och stationens evaluation/ack avvisar OOC | Kontrakts-/PostgreSQL-/stationstest |
| A6K-016 | Svensk tvåstegsyta har separat capability, synligt fokus, minst 52 px touchmål, text+symbol, minnesburet intent och endast explicit same-id-retry efter okänd commit | UI-/route-/Playwright-/CSS-test |
| A6K-017 | Samtidig OOC mot ingest/finalisering ger helt före/efter utan deadlock eller historikmutation | PostgreSQL-integrationstest |
| A6K-018 | Full grind och tom PostgreSQL-restore 0000→0020 passerar; inget withdrawal/utan-tidtagning/editor/Eventor/stafett/GPS/parser/riktig USB tillkommer | Full grind/migrationsgranskning |

## TASK 006L: explicit återtagande av individuellt utom tävlan

| ID | Scenario | Automatisering |
|---|---|---|
| A6L-001 | Endast `WITHDRAW_OUT_OF_COMPETITION` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6L-002 | Egen host-only session/CSRF, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6L-003 | Kandidat-DTO är bounded och visar endast minimal display-, versions- och revisionsmetadata; aldrig bricka, punches, rawdata, full evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6L-004 | Aktiv OOC utan senare teknik återtas atomiskt till originaltargetens canonicala `OK|MP` med immutable withdrawal, restoration och audit | Domän-/PostgreSQL-integrationstest |
| A6L-005 | Med senare teknik måste requestbundet absolut huvud självt vara den direkta publicerade tekniska källan; restorationen kopierar alla tider/controls/splits exakt | Domän-/kontrakts-/PostgreSQLtest |
| A6L-006 | Stale entry/klass/bana/snapshot/decision/OOC/absolute/source, fel status/reason/policy och opublicerad/manuell/restaurerad/korrupt källa ger noll writes | PostgreSQL-integrationstest |
| A6L-007 | Resolvern validerar alla historiska OOC-kedjor, tillåter högst en aktiv, räknar bara oåtertagen OOC i mutexen och gör aldrig targetfallback | Domän-/applikations-/PostgreSQLtest |
| A6L-008 | Hundra samtidiga exact retries ger en withdrawal/restoration/audit; ändrad actor eller ett intentfält konflikterar och två request-id:n ger en vinnare | PostgreSQL-integrationstest |
| A6L-009 | Om ingest vinner blir withdrawal stale utan write; om withdrawal vinner appenderas restoration och senare teknik med obrutna revisionsnummer | PostgreSQL-integrationstest |
| A6L-010 | Samtidig finalisering och withdrawal ger helt före/efter utan deadlock; äldre `NotCompeting` Complete XML/hash är byte-exakta | PostgreSQL-integrationstest |
| A6L-011 | Komposit-FK/unique/check och immutable-trigger avvisar fel race/entry/revision/decision/head/source/restoration, dubbel withdrawal, update och delete | Migration-/PostgreSQLtest |
| A6L-012 | Efter withdrawal använder publik format 5 exakt restaurerat `OK|MP`; OK rankas på nytt och MP förblir orankat utan intern provenans | Domän-/kontrakts-/PostgreSQL-/UI-test |
| A6L-013 | IOF Snapshot och ny Complete använder vanlig `OK`/`MissingPunch`, bevarar källfakta och läcker inga interna id:n | Serializer-/fixture-/PostgreSQLtest |
| A6L-014 | Historik format 7 visar target→OOC→eventuell teknik→withdrawal/restoration och format 1–6 förblir läsbara | Kontrakts-/PostgreSQLtest |
| A6L-015 | Finalisering format 7 fryser decision/OOC/absolute/source/withdrawal/restoration och äldre format/projektioner förblir stabila | Kontrakts-/PostgreSQL-integrationstest |
| A6L-016 | Nytt OOC efter withdrawal kräver en senare ny direkt teknisk revision; den manuella restorationen kan aldrig targetas | Domän-/PostgreSQL-integrationstest |
| A6L-017 | Svensk tvåstegsyta har separat capability, synligt fokus, minst 52 px touchmål, text+symbol, minnesburet intent och endast explicit same-id-retry | UI-/route-/Playwright-/CSS-test |
| A6L-018 | Full grind, 0000→0021 och befintlig 0020→0021 passerar; ingen editor/utan-tidtagning/Eventor/stafett/GPS/parser/riktig USB tillkommer | Full grind/migrationsgranskning |

## TASK 006M: explicit individuellt utan tidtagning

| ID | Scenario | Automatisering |
|---|---|---|
| A6M-001 | Endast `DECIDE_WITHOUT_TIMING` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6M-002 | Egen host-only session/CSRF, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6M-003 | Kandidat-DTO är bounded och visar endast minimal display-, versions- och targetmetadata; aldrig bricka, punches, rawdata, evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6M-004 | Exakt absolut aktuellt, publicerat och direkt tekniskt `OK/COMPLETE` skapar atomiskt immutable decision, status-only `NT/WITHOUT_TIMING` och audit utan raw/readout/snapshotwrite | Domän-/PostgreSQL-integrationstest |
| A6M-005 | NT-konstruktorn bevarar endast entry/klass/bana och avvisar MP, manuell/restaurerad/okänd/korrupt källa; outcome saknar alltid tider, controls och splits | Domän-/kontraktstest |
| A6M-006 | Stale entry/klass/bana/snapshot/target, nyare opublicerad/manuell head och aktiv DNS/DSQ/approval/DNF/OOC/NT ger konflikt utan domänwrite | PostgreSQL-integrationstest |
| A6M-007 | Gemensam entry-låst manualgrind gör DNS/DSQ/approval/DNF/OOC/NT ömsesidigt uteslutande och failar stängt på dubbelaktiv/korrupt provenans | Applikations-/PostgreSQLtest |
| A6M-008 | Hundra samtidiga exact retries ger en decision/revision/audit; ändrad actor/target/intent konflikterar och två request-id:n mot samma entry ger en vinnare | PostgreSQL-integrationstest |
| A6M-009 | Om ingest vinner blir NT stale utan write; om NT vinner appenderas senare teknik medan levande publik förblir NT | PostgreSQL-integrationstest |
| A6M-010 | Komposit-FK/unique/check och immutable-trigger avvisar korskopplad target/decision/NT, dubbelt request/target/entry, update och delete | Migration-/PostgreSQLtest |
| A6M-011 | NT är orankad med ordningen OK, MP, DSQ, DNF, OOC, NT, DNS och påverkar inte OK-ranking eller mixed-course | Domän-/kontrakts-/PostgreSQLtest |
| A6M-012 | Publik format 6 visar Utan tidtagning utan tid/ranking/controls/splits/interna id:n; format 1–5 förblir läsbara och låsta | Kontrakts-/UI-/Playwrighttest |
| A6M-013 | IOF Snapshot och ny klass-/loppsfinalisering avvisar aktiv NT utan utelämning eller fabricerad status; äldre Complete XML/hash förblir byte-exakta | Export-/kontrakts-/PostgreSQLtest |
| A6M-014 | Historik format 8 visar exact target→NT→eventuell senare teknik; format 1–7 förblir läsbara och stationens evaluation/ack avvisar NT | Kontrakts-/PostgreSQL-/stationstest |
| A6M-015 | Samtidig NT mot ingest/finalisering ger helt före/efter utan deadlock eller historikmutation | PostgreSQL-integrationstest |
| A6M-016 | Svensk tvåstegsyta har separat capability, synligt fokus, minst 52 px touchmål, text/symbol, minnesburet intent och endast explicit same-id-retry | UI-/route-/Playwright-/CSS-test |
| A6M-017 | Full grind, 0000→0022 och befintlig 0021→0022 passerar; inget withdrawal/editor/manuell tid/IOF-NT/Eventor/stafett/GPS/parser/riktig USB tillkommer | Full grind/migrationsgranskning |

## TASK 006N: explicit återtagande av individuellt utan tidtagning

| ID | Scenario | Automatisering |
|---|---|---|
| A6N-001 | Endast `WITHDRAW_WITHOUT_TIMING` för exakt race kan logga in/läsa/skriva; fel capability/prefix/race, expiry, logout och revocation avvisas | PostgreSQL-/route-/Playwrighttest |
| A6N-002 | Egen host-only session/CSRF, högst 1 h session, strikt Origin/CSRF, auth före body och högst 4 KiB strikt JSON | Route-/säkerhets-/Playwrighttest |
| A6N-003 | Kandidat-DTO är bounded och visar endast minimal display-, versions-, decision-, head- och sourcemetadata; aldrig bricka, punches, rawdata, full evaluation, token eller hash | Kontrakts-/PostgreSQL-/UI-test |
| A6N-004 | Aktiv NT utan senare teknik återtas atomiskt till originaltargetens canonicala `OK/COMPLETE` med immutable withdrawal, restoration och audit | Domän-/PostgreSQL-integrationstest |
| A6N-005 | Med senare teknik måste requestbundet absolut huvud självt vara den direkta publicerade tekniska `OK|MP`-källan; restorationen kopierar tider/controls/splits exakt | Domän-/kontrakts-/PostgreSQLtest |
| A6N-006 | Stale entry/klass/bana/snapshot/decision/NT/absolute/source, fel status/reason/policy och opublicerad/manuell/restaurerad/korrupt källa ger noll writes | PostgreSQL-integrationstest |
| A6N-007 | Resolvern validerar alla historiska NT-kedjor, tillåter högst en aktiv, räknar bara oåtertagen NT i mutexen och gör aldrig targetfallback | Domän-/applikations-/PostgreSQLtest |
| A6N-008 | Hundra samtidiga exact retries ger en withdrawal/restoration/audit; ändrad actor eller ett intentfält konflikterar och två request-id:n ger en vinnare | PostgreSQL-integrationstest |
| A6N-009 | Om ingest vinner blir withdrawal stale utan write; om withdrawal vinner appenderas restoration och senare teknik med obrutna revisionsnummer | PostgreSQL-integrationstest |
| A6N-010 | Samtidig finalisering och withdrawal ger helt före/efter utan deadlock; äldre NT-relaterade Complete XML/hash är byte-exakta | PostgreSQL-integrationstest |
| A6N-011 | Komposit-FK/unique/check och immutable-trigger avvisar fel race/entry/revision/decision/head/source/restoration, dubbel withdrawal, update och delete | Migration-/PostgreSQLtest |
| A6N-012 | Efter withdrawal använder publik format 6 exakt restaurerat `OK|MP`; OK rankas på nytt och MP förblir orankat utan intern provenans | Domän-/kontrakts-/PostgreSQL-/UI-test |
| A6N-013 | Aktiv NT blockerar Snapshot/Complete; efter withdrawal används vanlig `OK`/`MissingPunch`, källfakta bevaras och interna id:n läcker inte | Serializer-/fixture-/PostgreSQLtest |
| A6N-014 | Historik format 9 visar target→NT→eventuell teknik→withdrawal/restoration och format 1–8 förblir läsbara | Kontrakts-/PostgreSQLtest |
| A6N-015 | Finalisering format 8 fryser decision/NT/absolute/source/withdrawal/restoration och äldre format/projektioner förblir stabila | Kontrakts-/PostgreSQL-integrationstest |
| A6N-016 | Nytt NT efter withdrawal kräver en senare ny direkt teknisk OK/COMPLETE; den manuella restorationen kan aldrig targetas | Domän-/PostgreSQL-integrationstest |
| A6N-017 | Svensk tvåstegsyta har separat capability, synligt fokus, minst 52 px touchmål, text/symbol, minnesburet intent och endast explicit same-id-retry | UI-/route-/Playwright-/CSS-test |
| A6N-018 | Full grind, 0000→0023 och befintlig 0022→0023 passerar; ingen editor/manuell tid/IOF-NT/Eventor/stafett/GPS/parser/riktig USB tillkommer | Full grind/migrationsgranskning |

## TASK 006O: individuell fast starttid

- Kontrakt: explicit offset och UTC-normalisering, dygnsgräns, ogiltigt datum,
  högst millisekundprecision, strikt intent och exakt versionsökning.
- Tre PostgreSQL-scenarier: ändring → separat omräkning, gamla revisioner/raw/
  readouts och Complete bevaras, nytt signerat paket/stale ingest; behörighet,
  no-op/stale/PUNCH, null→tid, idempotens och samtidig vinnare; aktivt NT
  består vid samtidig starttidsändring/ingest. Journalens update/delete avvisas.
- Tre route-scenarier: egna säkra cookies och race/capability; Origin och auth
  före body, separat CSRF-bevis; faktisk 4 KiB-gräns och normaliserat intent.
- Ett Playwrightflöde: privat shell, mobil bredd, bekräftelse före write,
  minst 52 px bekräftelseknapp, tappat commitsvar, explicit samma-id-retry,
  en journalrad, länk till omräkning, ingen Web Storage och logout.
- Oförändrade Android- och övriga E2E-/PostgreSQL-scenarier behöver inte
  upprepas för detta snitt. ADR-0039 beskriver antaganden och återställning.

## TASK 006P: individuellt brickbyte

- Två kontrakts- och tre routetester skyddar nytt bricknummer, exakt fryst
  assignment/versionsgrund, kvittens, privata cookies, Origin/auth före body,
  CSRF-bevis och faktisk 4 KiB-gräns.
- Fyra PostgreSQL-scenarier täcker byte/återbyte, exakt retry, bevarade gamla
  resultat/raw/ingestkvitton, ny paketkoppling, sen gammal bricka som okänd,
  explicit omräkning av tidigare okänd ny bricka, no-readout och dubbelaktiv
  konflikt, annans historiska bricka, samtidiga writers, importens atomära
  ägarskapsskydd samt aktivt NT över samtidig ingest.
- Ett Playwrightscenario kontrollerar privat shell, 390 px bredd, 52 px
  kontroller, bekräftelse före write, tappat commitsvar, samma-id-retry,
  exakt en journal/aktiv koppling, ingen Web Storage och logout.
- Hela PostgreSQL-sviten körs en gång eftersom EntryList-importen ändrats.
  Riktig SPORTident och oförändrade Androidflöden verifieras inte av dessa tester.

## TASK 006Q: direktanmälan

- Två kontraktstester skyddar normaliserade namn/tider, FIXED/PUNCH,
  kanonisk valfri bricka och kvittensens versions-/assignmentbindning.
- Tre routetester skyddar egna cookies/capability, Origin/auth före body,
  CSRF och faktisk 4 KiB-gräns samt strikt intent till tjänsten.
- Tre PostgreSQL-scenarier täcker atomisk registrering utan förtida resultat,
  exakt retry efter namnändring, immutable journal/audit, signerat paket och
  vanlig ingest, stale/fel auth/historisk brickägare, samtidiga requests utan
  orphan-entry, FIXED utan bricka samt separat omräkning av tidigare okänd
  avläsning utan omskrivning av originalkvittensen.
- Riktat Playwrightflöde verifierar mobilvy, bekräftelse före write,
  tappat commitsvar, samma-id-retry, en registrering, inget förtida resultat,
  ingen Web Storage och logout. Resultatet dokumenteras i status.md.
- Motor, import, stationskö och Android ändras inte; tidigare fulla
  PostgreSQL-/Androidsviter upprepas inte utan ny konkret risk.

## TASK 006R: privat operativ startlista

- Kontrakttester skyddar strict DTO, totalgränser, tidszon, unika entry/class-id,
  PUNCH utan fast tid och dubbelaktiv koppling utan godtyckligt bricknummer.
- Riktade PostgreSQL-scenarier täcker FIXED/PUNCH, sortering, saknad/dubbelaktiv
  bricka, inga läswrites, race/capability och spärrad credential.
- Routetester skyddar egna cookies, capability, Origin före loginbody,
  no-store, authfel och avvisad överprojektion.
- Tidsvisningstest täcker dygnsskifte, millisekunder och höstens upprepade
  timme med olika explicita UTC-offsetar.
- Playwright testar mobilvy, klassfilter, tävlingstid trots annan browserzon,
  gammal lista vid nätfel, uppdatering, logout/spärrning utan kvarvarande PII
  samt oförändrade entries/snapshot och inga resultatwrites.

## TASK 006S: explicit publicering av startlista

- Strikta kontrakt avvisar interna id:n/brickor, tom publicering, ogiltig
  tidszon, PUNCH med fast tid och inkonsekvent nullable förhandsgranskning.
- PostgreSQL testar fryst namn/tid, samma-id-retry, ändrad actor/intent,
  raceisolering, samtidiga publiceringar, no-op, withdrawal trots ogiltigt
  underlag, ny publicering och oföränderlig historik. Databasens hash-CHECK
  verifieras med avvisad NULL-hash; inga resultatrevisioner skapas.
- Rutter skyddar egna cookies, capability, Origin/CSRF, 4 KiB och strict svar.
  Publik läsning saknar cookies och överprojicerat innehåll avvisas.
- Playwright testar explicit mobil granskning/bekräftelse, förlorat commitsvar
  med samma request-id, fryst offentlig kopia, withdrawal med ogiltigt nytt
  underlag, 404 och automatisk borttagning av tidigare deltagardata.
- Fulla övriga integration-/E2E-/Android-/produktionstester upprepas inte för
  detta snitt. Ingen fysisk hårdvara eller maxgränslast verifieras.

## TASK 006T: fryst IOF StartList

- IOF-adaptern testar exakt XML-struktur, obligatoriskt tomt Start, FIXED/PUNCH,
  UTC/millisekunder, escaping, felaktig kalender/offset, XML 1.0-tecken och
  strikt format utan överprojicerade IDs/kort/status/race; totalgränser testas.
- PostgreSQL återanvänder publiceringsflödet och verifierar oförändrade XML-bytes
  efter namn/tidsändring, withdrawal, legacy NULL → ompublicering samt olika
  hash för olika strukturerade namn trots identiskt displayName.
- Publik route testar attachment/mime/no-store/inga cookies samt tom 404/409/503.
- Mobil E2E laddar ner faktisk fil, kontrollerar namn och frånvaro av privata
  fält, jämför bytes efter ändring och verifierar 404/länkborttagning efter
  withdrawal. Inget fullständigt IOF-import-roundtrip påstås: exporten saknar
  externa personidentiteter och vår tidsimport kräver dem avsiktligt.
- Engångskontroll med xmllint mot pinnad officiell XSD utförs utan vendling;
  det verifierar producerade dokument, inte generell full IOF 3.0-funktionalitet.

## TASK 006U: enkel klasslottning

- Domän: golden seed, inputordningsoberoende, inga mutationer, unik täckning,
  intervall/dygnsgräns, singleton, seed/UUID/version/roster/tidsgränser.
- Kontrakt: offsetnormalisering, strikt parameterrange, inga klientplanswrites,
  unika previewentries, exakta tidsslots/ändringsflaggor och rimlig kvittens.
- PostgreSQL: preview utan journalwrites, exact retry, ändrad actor/intent,
  stale version/roster, samtidiga kandidater en vinnare, PUNCH/overflow,
  race-/klass-/capabilityisolering, immutable header/items, no-op och
  oförändrad maxversion. Publicerad webb/IOF-kopia är byte-/innehållsfryst.
- Mobil E2E: granska gammal/ny tid utan writes, bekräfta, förlorat commitsvar,
  samma-id-retry, båda tider/versioner + en snapshotökning, inga nya resultat
  eller automatiska publiceringar, Web Storage tomt och fungerande logout.
- Rutter: egna cookies och capability, auth/Origin före body, CSRF,
  faktisk 4 KiB-gräns, strict intent och skrivfri preview utan idempotency-key.
- Maxlast/fältdrift och produktionrestore kvarstår; inga nya hårdvarulöften.

## TASK 006V: Testeventorimport (liveprov kvar)

- Adapter: opaka IDs, explicit flera lopp, namn/standarddatum, giltiga XML-
  entiteter/CDATA/attribut, felaktiga namespaces/IDs/datum/UTF-8, duplicate fields,
  DTD och XML-komplexitet. Endast fixed Testeventor HTTPS, ingen redirect/cache,
  ApiKey-header, högst 2 MiB och timeout över hela läsningen. Syntetiska fixtures.
- Kryptering: ägar-/anslutnings-/keyId-bindning, fel masterkey, manipulation,
  canonical envelope, radbrytningsskydd, bounded privat CLI-input, generiska fel.
- PostgreSQL 17/PostGIS: migration 0031 från tom databas, skrivfri preview,
  explicit etapp två, immutable journal och krypterad lagring, auth före body,
  exakt replay utan nät/masterkey, changed intent, global duplicate/concurrency,
  spärr/expiry under hämtning och rollback när sista audit-write misslyckas.
- Mobil 390 px: verklig session/list-route, gemensam POST-route-handler och PG,
  men syntetiskt upstreamsvar injiceras i testprocessens POST-dispatch. Granskning
  utan writes, ändrat sökunderlag rensar preview, inget defaultlopp, minst 52 px
  bekräftelse, tappat commitsvar/samma-id-retry, en intern tävling/ett lopp,
  inget Web Storage och logout. Detta är inte full live-HTTP-verifiering.
- Återstår: autentiserad läsning och import av användargodkänd Testeventortävling,
  riktiga API-svar, produktionsnyckelhantering/restore och driftbelastning.

## TASK 001:s ursprungliga verifieringsgräns

- riktig SPORTident-hårdvara eller råa protokollbytes,
- två timmars fältdrift och återställning efter verklig process-/strömförlust,
- PostGIS-geometri,
- fältbeteende i regn, skarpt ljus och med handskar,
- generell produktionsautentisering för övriga adminytor, last, backup och
  återställning.
