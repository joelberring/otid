import { createServer, type Server } from "node:http";

/**
 * Falska geodatatjänster för kartprojektets hämtning (ADR-0219, K4c). Overpass (`POST /api/interpreter`) svarar med en byggnad,
 * ett staket och en stig mitt i den efterfrågade rutan, så att kandidaterna hamnar på kartan oavsett var den ligger. Webben
 * pekas hit med OTID_OVERPASS_URL, som bara driften (här testkonfigurationen) kan sätta.
 */
export const FAKE_GEODATA_PORT = Number(process.env.E2E_GEODATA_PORT ?? 4343);

/** Svaret för rutan (söder, väster, norr, öster). */
export function fakeOverpass(south: number, west: number, north: number, east: number): unknown {
  const lat = (south + north) / 2, lon = (west + east) / 2;
  const dLat = (north - south) / 20, dLon = (east - west) / 20;
  const at = (x: number, y: number) => ({ lat: lat + y * dLat, lon: lon + x * dLon });
  return { version: 0.6, elements: [
    { type: "way", id: 1, tags: { building: "yes" }, geometry: [at(0, 0), at(1, 0), at(1, 1), at(0, 1), at(0, 0)] },
    { type: "way", id: 2, tags: { barrier: "fence" }, geometry: [at(-2, -2), at(2, -2)] },
    { type: "way", id: 3, tags: { highway: "footway" }, geometry: [at(-3, 2), at(0, 3), at(3, 2)] }
  ] };
}

export function startFakeGeodata(port = FAKE_GEODATA_PORT): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fake-geodata");
    if (request.method !== "POST" || url.pathname !== "/api/interpreter") { response.writeHead(404).end(); return; }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const query = new URLSearchParams(body).get("data") ?? "";
      const box = /\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/.exec(query);
      if (!box) { response.writeHead(400).end(); return; }
      const [south, west, north, east] = box.slice(1).map(Number) as [number, number, number, number];
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(fakeOverpass(south, west, north, east)));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}
