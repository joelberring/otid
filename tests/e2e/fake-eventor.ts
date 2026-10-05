import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";

/**
 * Falsk Eventor för webbläsartesterna (ADR-0170 beslut 4). Svarar med konstruerade svar ur
 * `fixtures/eventor` – aldrig den riktiga Eventor. Webben pekas hit med OTID_EVENTOR_BASE_URL,
 * som bara driften (här testkonfigurationen) kan sätta. Testet byter anmälningslistan med
 * `POST /__fixture/entries/<namn>` för att simulera att anmälningarna ändrats i Eventor.
 */
export const FAKE_EVENTOR_PORT = Number(process.env.E2E_EVENTOR_PORT ?? 4319);
/** Klubbnyckeln som den falska Eventor godtar (påhittad, används bara mot den här servern). */
export const FAKE_EVENTOR_API_KEY = "e2e0fake0eventor0club0key0000001";

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/eventor/${name}.xml`, import.meta.url), "utf8");
const routes: Record<string, string> = {
  "/api/organisation/apiKey": "organisation", "/api/events": "events", "/api/event/47110": "event", "/api/eventclasses": "classes"
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
