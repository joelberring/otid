# TASK102: utfärda operativ administratörsåtkomst från tävlingsvyn

Påbörjad 2026-09-20.

## Användarvärde

Tävlingsledaren kan ge startpersonalen, målpersonalen eller en till
tävlingsadministratör en kortlivad, racebunden access utan att be någon med
server-CLI om hjälp. Full administratör kan därmed exempelvis ändra klass,
starttid och bricka i den etablerade arbetsvyn, medan start- och målpersonal
behåller sina avgränsade arbetslägen.

## Avgränsning

- Följ ADR-0117 och återanvänd befintliga `MANAGE_RACE`, `START_CHECKIN` och
  `FINISH_FOREST_WATCH` credentials, sessioner, spärrar och livslängder.
- Den nya webbytan får utfärda, visa hemlighetsfri metadata och spärra. Den
  får inte skapa konton, lagra eller återvisa en hemlighet, skicka e-post eller
  utfärda specialbehörigheter.
- Tappat utfärdandesvar får inte autoåterförsökas. Panelen ska i stället visa
  säker operativ återhämtning: spärra den eventuellt skapade raden och skapa en
  ny credential.
- Utfärdande/spärr måste vara race-scoped, `MANAGE_RACE`-skyddat, CSRF-skyddat
  och auditera vem som utförde åtgärden.
- Ingen schemaändring, Eventor, PM, GPS, riktig USB, ny resultatregel eller
  offline-credentialutfärdande ingår.

## Berörda delar

- ADR-0117, status och denna uppgift,
- strikt contracts/application-projektion för den lilla accesslistan och
  utfärdande/spärr,
- tunna befintliga administratörsroutes samt kompakt svensk panel i `/manage`,
- ett riktat application-/routeprov och ett 390 px browserfall. Ingen bred
  regression när resultat- och synklogik är oförändrad.

## Acceptans

1. En verklig `MANAGE_RACE`-session kan utfärda exakt en av de tre tillåtna
   rollerna med label och giltig kort utgångstid; fel roll, race eller CSRF
   avvisas utan credential.
2. Credentialens hemlighet returneras endast vid utfärdande och syns aldrig i
   listsvaret, URL:en eller persistens i browsern.
3. Listan visar roll, label, tider och spärrstatus utan persondata utöver
   arrangörens label. Utfärdare och spärrning kan spåras i audit.
4. Spärrning gör både credential och eventuell session obrukbar. Start/mål kan
   inte utfärda nya credentials eller läsa administratörslistan.
5. Vid tappat svar gör browsern ingen automatisk extra utfärdning och visar den
   säkra ersättningsvägen. Layouten fungerar på 390 px utan sidscroll.

## Utfört och verifierat 2026-09-20

- `MANAGE_RACE` kan via den befintliga skyddade administratörsroutern utfärda,
  lista och spärra enbart de tre befintliga operativa rollerna. Start- och
  målbehörighet kan inte använda denna route.
- Hemligheten returneras endast från `POST`; listprojektionen och browserns
  local-/sessionStorage saknar den. UI:t visar koden tills administratören
  uttryckligen stänger den och försöker aldrig automatiskt igen efter ett
  oklart nätverkssvar.
- Utfärdande och spärr ligger i samma transaktion som respektive befintliga
  credentialoperation. De har dessutom egna auditposter med den verkliga
  utfärdande administratörens credential-id.
- Inget schema, inget konto-/kontaktregister, ingen Eventortrafik, GPS, PM,
  hårdvara eller offlineutfärdande har tillkommit.

Riktade kontroller med enbart syntetiska data:

```text
CI=true pnpm --filter @o-tid/contracts lint                                      exit 0
CI=true pnpm --filter @o-tid/contracts typecheck                                 exit 0
CI=true pnpm --filter @o-tid/contracts exec vitest run test/race-operator-access.test.ts
                                                                              1 fil / 1 test passerat
CI=true pnpm --filter @o-tid/application lint                                    exit 0
CI=true pnpm --filter @o-tid/application typecheck                               exit 0
TEST_DATABASE_URL=<isolerad PostgreSQL17> CI=true pnpm --filter @o-tid/application exec vitest run test/integration/task-102-race-operator-access.test.ts
                                                                              1 fil / 1 test passerat
CI=true pnpm --filter @o-tid/web lint                                            exit 0
CI=true pnpm --filter @o-tid/web typecheck                                       exit 0
CI=true pnpm --filter @o-tid/web build                                           exit 0
CI=true pnpm --filter @o-tid/web exec vitest run src/lib/race-administrator-route-handlers.test.ts
                                                                              1 fil / 32 test passerat
CI=true pnpm exec tsc --noEmit -p tests/e2e/tsconfig.race-administrator.json     exit 0
CI=true pnpm exec eslint tests/e2e/task-029-race-administrator.spec.ts tests/e2e/playwright.race-administrator.config.ts ...
                                                                              exit 0
CI=true pnpm exec playwright test --config tests/e2e/playwright.race-administrator.config.ts --grep TASK102
                                                                              1 passerat (8,9 s)
```

Browserfallet använder en lokal Next-server och en isolerad PostgreSQL17-
instans med syntetiskt event. Det verifierar 390 px utan sidscroll, inloggad
utfärdare, engångskod utan browserpersistens, metadata-lista, spärr,
omedelbart avvisad startinloggning samt båda auditposterna. Ingen riktig
tävlings- eller persondata och inga externa anrop används.
