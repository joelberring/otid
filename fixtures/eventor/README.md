# Eventor-fixtures

Konstruerade svar i Eventors API-format (inte inspelade från Eventor). Personer,
klubbar och id:n är påhittade. Används av adaptertesterna (`packages/eventor`),
integrationstestet `adr-0170-eventor-sync` och den falska Eventor-servern i
Playwright (`tests/e2e/fake-eventor.ts`).

- `organisation.xml` – `GET /api/organisation/apiKey`
- `events.xml` – `GET /api/events?organisationIds=…&fromDate=…&toDate=…`
- `event.xml` – `GET /api/event/47110`
- `classes.xml` – `GET /api/eventclasses?eventId=47110`
- `entries-1.xml` – `GET /api/entries?eventIds=47110&…` vid första importen
- `entries-2.xml` – samma anrop senare: nytt bricknummer, klassbyte, struken och ny löpare
- `relay-*.xml` – stafett (`RelaySingleDay`) med lag och sträcklöpare
- `competitors.xml` – `GET /api/export/cachedcompetitors?organisationIds=…&includePreselectedClasses=false` (löpardatabasen,
  PLAN.md steg 29): IOF 3.0 `CompetitorList` med samma struktur som det riktiga svaret (provat 2026-10-19, värdena
  borttagna av ägaren), påhittade löpare: flera brickor, Emit-bricka, löpare utan klubb, utan bricka och med tomt namn
- `organisations.xml` – `GET /api/organisations` i Eventors äldre format (`OrganisationTypeId`); strukturen är inte
  provad mot riktiga Eventor
