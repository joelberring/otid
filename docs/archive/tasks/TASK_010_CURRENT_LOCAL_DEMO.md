# TASK 010 – Aktuell isolerad lokal demo

Status: klar lokal demonstration, 2026-09-07. Hela V1 är inte klar.

Användaren ska kunna prova senaste O-Tid på denna dator med syntetiska
deltagare och separata giltiga testbehörigheter. Detta är en lokal demonstration,
inte produktionsdrift eller en kopia av Skärgårdshelgen.

Kontroll visade att gamla otid_demo_20260906 saknar migration 0037:s authguard.
Den lämnas oförändrad. Ny databas otid_demo_20260907_preview kontrolleras saknas,
skapas, migreras och provisioneras med befintlig TASK007-CLI. Inga andra
databaser rensas eller migreras. Hemligheter hamnar endast i nya privata
0600-filer utanför repositoryt, aldrig i URL/logg/klientkod.

## Minimal kodändring före driftsteg

En utvecklingsflagga O_TID_LOCAL_DEMO=1 väljer fast .next-local-demo inom
apps/web. Den ska vara skild från både vanliga .next och .next-demo-test så
fortsatta tester inte använder den manuella demons byggkatalog. Kombination
med O_TID_DEMO_E2E=1 avvisas i utvecklingsläge. Produktion påverkas inte.
Detta tillämpar ADR-0057:s demoisolering med Nexts dokumenterade distDir;
ingen teknik, behörighetsregel eller domängräns ändras. Inga nya dependencies.

Berörda filer: apps/web/next.config.ts, .gitignore, riktat konfigurationstest, denna task,
demoguide och docs/status.md. Servern binds uttryckligen till 127.0.0.1:3001.
Ingen systemtrust, publik nätport eller riktig Eventornyckel används.

## Acceptans

- Konfigurationstest: tre skilda utvecklingskataloger, motstridiga flaggor
  avvisas, produktionens default/standalone ändras inte.
- Lint, typecheck, tester och build passerar; driftkontroller redovisas separat.
- Ny databas har aktuell migrationskedja och bara syntetiska fixtures.
- Färsk privat rollinstallation och startbar server på 3001. Standardroller
  gäller en timme enligt befintlig policy; ingen automatisk förlängning.
- Verklig HTTP-login/läsning för översikt, start, mål, speaker och klasslista
  provas med rätt roll; anonym åtkomst till privat lista avvisas.
- Simulatorns enhetsbundna READOUT-behörighet förbereds för den faktiska
  browserenheten. Avläsning ger syntetiskt resultat; ingen USB hävdas.
- Användarguide visar exakta länkar, lokal secretfil, utgångstider och
  återstart utan reseed. Föregående demo pekas inte ut som kompatibel.

Ingen automatisk lagring av roster i personlig browser: offlineförberedelse
kräver användarens separata lösenfras och samtycke. Fysisk mobil över nätet,
GPS, stafett, riktig USB och produktionsdrift ingår inte.

## Slutresultat

Aktuell användarguide: docs/local-demo-20260907.md. Servern kör på
127.0.0.1:3001 mot otid_demo_20260907_preview. Lopp-id är
fd400248-8b3b-4d9b-a6f8-62f8d52f7c73. Databasen migrerades genom 0037 och
slutkontrollen visar 1 event, 1 race, 2 entries, 2 klasser, 1 råpost och 1
resultatrevision. De gamla databaserna lämnades oförändrade.

CI=true pnpm lint, typecheck, test, build: samtliga exit 0. Typecheck kördes
också om efter bygg/start och passerade. Enhetssvit: 220 filer / 1 432 tester,
inklusive fem nya konfigurationsprov. Loggar /private/tmp/otid-010-*.log.
Full PG-/Android-/browserregression kördes inte om: endast utvecklingsconfig
ändrades. Föregående TASK009:s 238 PG-prov påstås inte nykörda i detta steg.
I stället verifierades den verkliga nya miljön separat enligt nedan.

Fem rollspecifika HTTP-prov gav vardera anonymt 401, login 200 och privat
GET 200/no-store: overview, startroster, målroster, speaker och klasslista.
En separat syntetisk testenhet gav stored och duplicate vid byteidentisk
omsändning; databasen har en råpost och en revision. In-app-browsern visar
Ada Löpare godkänd på 40:00. Den synliga simulatorns faktiska device-id har
separat READOUT-credential och orörd lokal sekvens; inga credentials matades
in eller sparades i den personliga browsern av agenten.

Det tillfälliga HTTP-kontrollskriptet slutade först med exit 1 efter lyckad
ingest/retry: cleanup anropade revokeStationCredential med fel argumentform.
Main rättade skriptet, identifierade testcredentialen genom DB-id utan
secrethash/token och spärrade just den via befintlig CLI (exit 0). Därefter
passerade en read-only-domänkontroll med nya rollinloggningar, exit 0, utan ny
avläsning: rätt revocation, fortfarande giltig browsercredential och exakt
1 råpost/1 revision. Inga okända commits spelades om blint.
Driftloggar finns i /private/tmp/otid-demo-preview.qwcoC7/.

Fyra privata credentialfiler är verifierat mode 0600; roller och READOUT
löper ut 2026-09-07T05:39:49.495Z (07:39:49 svensk tid). Ingen automatisk
förlängning eller bredare behörighet tillkom. Servern lämnades avsiktligt
igång för användarprov; inga externa portar eller certifikat lades till.

Kvarvarande antaganden: dator/server/PostgreSQL måste vara igång, de privata
filerna måste finnas kvar och annan browser kräver egen devicebunden token.
Offlinekö kräver användarens samtycke/lösenfras och ska inte raderas vid
credentialutgång. Fysisk mobil, riktig hårdvara och produktionsdrift återstår.
