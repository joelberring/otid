import { createServer, type Server } from "node:http";

/**
 * Falsk ROC/OResults för webbläsartesterna (ADR-0172 beslut 5). Svarar på båda tjänsternas sökvägar
 * (`/ver7.1/getpunches.php` och `/roc`) med stämplingsraderna för `unitId` vars id är större än `lastId`,
 * som den riktiga tjänsten. Webben pekas hit med OTID_ROC_BASE_URL, som bara driften (här testkonfigurationen)
 * kan sätta. Testet lägger till rader med `POST /__fixture/units/<unitId>` (en rad per textrad).
 */
export const FAKE_ROC_PORT = Number(process.env.E2E_ROC_PORT ?? 4331);

export function startFakeRoc(port = FAKE_ROC_PORT): Promise<Server> {
  const units = new Map<string, string[]>();
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fake-roc");
    const control = /^\/__fixture\/units\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
    if (request.method === "POST" && control) {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        const lines = body.split(/\r?\n/).filter(line => line.trim() !== "");
        units.set(control[1]!, [...(units.get(control[1]!) ?? []), ...lines]);
        response.writeHead(204).end();
      });
      return;
    }
    if (request.method !== "GET" || (url.pathname !== "/roc" && url.pathname !== "/ver7.1/getpunches.php")) {
      response.writeHead(404).end();
      return;
    }
    const lastId = Number(url.searchParams.get("lastId") ?? "0");
    const lines = (units.get(url.searchParams.get("unitId") ?? "") ?? []).filter(line => Number(line.split(";")[0]) > lastId);
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(lines.map(line => `${line}\r\n`).join(""));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}
