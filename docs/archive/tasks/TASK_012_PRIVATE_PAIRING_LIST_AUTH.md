# TASK 012 – Spärrsäker privat parkopplingslista

Status: klar som avgränsad säkerhetsrättning, 2026-09-07. Full V1 är inte klar.

## Snitt före implementation

listPairingGrantsAsAdmin i packages/application/src/pairing-admin.ts gör
idag auth-preflight följd av separata läsningar. Skydda auth, granturval och
samtliga metadatauppslag med en gemensam READ COMMITTED-transaktion och
ADR-0059:s protected-read-helper som första databassteg.

Behåll PAIR_STATION, listans 1000-gräns, befintlig sortering och statusprioritet.
Inga nya race/grant-lås, ändringar av utfärdning/inlösen/spärrning, nya
kontraktsfält, schemaändringar eller resultateffekter ingår. Ingen dependency,
teknik- eller domängräns ändras. Accepterad ADR-0059 tillämpas; ingen extern
licensbelagd källa används. N+1-uppslagen optimeras inte i detta säkerhetssnitt.

## Acceptans och arbetsfördelning

- Verkliga PostgreSQL-prov reproducerar läsning efter committad credential-
  respektive sessionsspärr innan fix. Testet pausar grantläsningen med
  tabellås på station_pairing_redemption i metadatauppslaget och observerar
  pg_blocking_pids; ingen timinggissning.
- Spärr som vinner authgrinden avvisar läsning. Auktoriserad läsare behåller
  authlås genom sista metadatauppslaget och commit; nästa request avvisas.
- Race/capability/expiry och skrivfri minimal metadata verifieras.
- Lint, typecheck, enhetstest, full PostgreSQL-svit och build körs och redovisas.

Befintlig agent skriver enbart nytt integrationstest. Main äger dokument,
produktionsändring och sekventiella DB-körningar. Isolerad testdatabas används;
privat tävling, demodatabaser, hemligheter och kartfiler lämnas orörda.
Ingen browser-/Android-omkörning för denna rena servertransaktionsändring;
befintliga HTTP-prov körs i enhetssviten. Fysisk hårdvara och produktionslast
är inte verifierade av detta snitt.

## Reproduktion och verifiering

Före fix: två reader-gap-prov gav exit 1, 2 failed/3 bortvalda. Lås på
station_pairing_redemption pausade metadatajoinen efter granturvalet.
Credential-/sessionsspärr committade då före upplåsningen och gammal kod gav
privat OK i stället för unauthorized. Logg: /private/tmp/otid-012-red.log.

Efter fix: riktad helfil gav exit 0, 5/5, 1,92 s. Logg:
/private/tmp/otid-012-targeted.log. Ingen assertion försvagades efter rött.
Agentens fixture använde initialt fel CSRF-värde under framtagningen; detta
rättades till login.csrfToken före någon testkörning. Slutgranskning read-only
bekräftade samma transaktion genom alla metadatauppslag.

Kommandon körs med CI=true. PostgreSQL-kommandona använder
TEST_DATABASE_URL=postgresql://joelberring@127.0.0.1:55432/otid_006w_review_schema.

```bash
pnpm --filter @o-tid/application exec vitest run test/integration/task-012-pairing-list.test.ts -t 'already authorized'
pnpm --filter @o-tid/application exec vitest run test/integration/task-012-pairing-list.test.ts
pnpm lint
pnpm typecheck
pnpm --filter @o-tid/application test:integration
pnpm test
pnpm build
```

Slutresultat: lint, typecheck, test och build gav samtliga exit 0.
Enhetssvit: 220 filer / 1 432 tester. Full PostgreSQL: exit 0,
22 filer / 248 tester, 74,79 s. Loggar för workspacekommandona
är /private/tmp/otid-012-{lint,typecheck,integration,unit,build}.log.

Driftantaganden: migration 0037 krävs före deploy. Listan kan fortfarande
göra upp till 1000 metadatauppslag, nu med authlås under hela läsningen;
produktionslast och väntetider måste verifieras separat. READ COMMITTED ger
inte en fryst gemensam grantstatus-snapshot. Detta ändrar inte den befintliga
statussemantiken och är inte en fullständig prestanda- eller säkerhetsaudit.
