import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { daysFromToday, today } from "./helpers";

/**
 * Falsk Eventor för webbläsartesterna (ADR-0170 beslut 4). Svarar med konstruerade svar ur
 * `fixtures/eventor` – aldrig den riktiga Eventor. Webben pekas hit med OTID_EVENTOR_BASE_URL,
 * som bara driften (här testkonfigurationen) kan sätta. Testet byter anmälningslistan med
 * `POST /__fixture/entries/<namn>` för att simulera att anmälningarna ändrats i Eventor.
 */
export const FAKE_EVENTOR_PORT = Number(process.env.E2E_EVENTOR_PORT ?? 4319);
/** Klubbnyckeln som den falska Eventor godtar (påhittad, används bara mot den här servern). */
export const FAKE_EVENTOR_API_KEY = "e2e0fake0eventor0club0key0000001";

/**
 * ADR-0209: en andra klubbnyckel som tillhör OK Älvsjö-Örby (9901) i klubblistan `organisations-directory.xml`, med
 * medlemslistan `persons-organisation.xml` (påhittade personer).
 */
export const FAKE_EVENTOR_OKAO_KEY = "e2e0fake0eventor0okao0key0000002";
const OKAO_ORGANISATION = `<?xml version="1.0" encoding="utf-8"?><Organisation><OrganisationId>9901</OrganisationId><Name>OK Älvsjö-Örby</Name>
  <ShortName>OKÄÖ</ShortName><OrganisationTypeId>3</OrganisationTypeId></Organisation>`;

/** Fixturernas tävlingsdatum. Den falska Eventor byter dem vid varje svar mot datum räknade från i dag. */
const FIXTURE_EVENT_DATE = "2026-10-18";
const FIXTURE_RELAY_DATE = "2026-11-08";
/** Höstsprintens datum som den falska Eventor svarar med: i dag, så att den importerade tävlingen har tävlingsdag nu. */
export const fakeEventorEventDate = () => today();

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/eventor/${name}.xml`, import.meta.url), "utf8")
  .replaceAll(FIXTURE_EVENT_DATE, fakeEventorEventDate()).replaceAll(FIXTURE_RELAY_DATE, daysFromToday(21));
const routes: Record<string, string> = {
  "/api/organisation/apiKey": "organisation", "/api/events": "events", "/api/event/47110": "event", "/api/eventclasses": "classes",
  // Löpardatabasen (PLAN.md steg 29): påhittade löpare i Eventors struktur. Hela landet (utan organisationIds) svarar likadant.
  "/api/export/cachedcompetitors": "competitors", "/api/organisations": "organisations"
};

export function startFakeEventor(port = FAKE_EVENTOR_PORT): Promise<Server> {
  let entries = "entries-1";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fake-eventor");
    const control = /^\/__fixture\/entries\/(entries-[12])$/.exec(url.pathname);
    if (request.method === "POST" && control) {
      entries = control[1]!;
      response.writeHead(204).end();
      return;
    }
    if (request.headers.apikey === FAKE_EVENTOR_OKAO_KEY) {
      const body = url.pathname === "/api/organisation/apiKey" ? OKAO_ORGANISATION
        : url.pathname === "/api/persons/organisations/9901" ? fixture("persons-organisation")
          : url.pathname === "/api/organisations" ? fixture("organisations-directory") : undefined;
      if (!body) { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "text/xml; charset=utf-8" }).end(body);
      return;
    }
    if (request.headers.apikey !== FAKE_EVENTOR_API_KEY) { response.writeHead(401).end(); return; }
    const name = url.pathname === "/api/entries" ? entries : routes[url.pathname];
    if (!name) { response.writeHead(404).end(); return; }
    response.writeHead(200, { "content-type": "text/xml; charset=utf-8" }).end(fixture(name));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}
