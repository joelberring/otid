import { createServer, type Server } from "node:http";
import { crc32, deflateSync } from "node:zlib";
import { writeArrayBuffer } from "geotiff";
import { wgs84ToProjected } from "../../packages/map-file/src";

/**
 * Falska geodatatjänster för kartprojektets hämtning (ADR-0219, K4c). Overpass (`POST /api/interpreter`) svarar med en byggnad,
 * ett staket och en stig mitt i den efterfrågade rutan, så att kandidaterna hamnar på kartan oavsett var den ligger. Webben
 * pekas hit med OTID_OVERPASS_URL, som bara driften (här testkonfigurationen) kan sätta.
 *
 * Lantmäteriets STAC (`POST /stac-bild/v1/search`, OTID_LM_STAC_BILD_URL) svarar med ett ortofoto för rutan; bilden
 * (`GET /orto/<v>,<s>,<ö>,<n>.tif`) är en GeoTIFF i SWEREF 99 TM som täcker rutan, och delar av den lämnas med Range. Utan
 * inloggning (Authorization) svarar båda 401.
 *
 * K5: laserdata (`/stac-hojd/v1/collections` och `/search`, OTID_LM_STAC_HOJD_URL) svarar med en ruta för rutan; "laserfilen"
 * (`GET /laser/<v>,<s>,<ö>,<n>.laz`) är JSON med rutan i SWEREF 99 TM, som den falska Karttapullautin (fake-pullauta.mjs) läser.
 * K5c: SLU:s markfuktighet (`GET /slu-wms`, OTID_SLU_MOISTURE_WMS_URL) svarar på GetCapabilities och GetMap (en blå PNG).
 */
export const FAKE_GEODATA_PORT = Number(process.env.E2E_GEODATA_PORT ?? 4343);
/** Geo-arbetarens nyckel i webbläsartesterna (OTID_GEO_WORKER_TOKEN i testkonfigurationen och CI). */
export const E2E_GEO_WORKER_TOKEN = "e2e-geo-arbetare-0123456789abcdefghijklmnopqrstuv";

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

/** En GeoTIFF (RGB, 400 × 400 px, SWEREF 99 TM) som täcker rutan i WGS 84 med marginal: rutor i rött och grönt. */
export function fakeOrtho(west: number, south: number, east: number, north: number): Uint8Array {
  const corners = [[south, west], [south, east], [north, west], [north, east]].map(([lat, lon]) => wgs84ToProjected({ kind: "EPSG", code: 3006 }, lat!, lon!));
  const minE = Math.min(...corners.map(c => c.easting)) - 50, maxE = Math.max(...corners.map(c => c.easting)) + 50;
  const minN = Math.min(...corners.map(c => c.northing)) - 50, maxN = Math.max(...corners.map(c => c.northing)) + 50;
  const size = 400;
  const values: number[] = [];
  for (let row = 0; row < size; row += 1) for (let col = 0; col < size; col += 1) {
    const even = (Math.floor(row / 50) + Math.floor(col / 50)) % 2 === 0;
    values.push(even ? 200 : 40, even ? 40 : 200, 60);
  }
  const tiff: ArrayBuffer = writeArrayBuffer(values, { width: size, height: size, BitsPerSample: [8, 8, 8], SamplesPerPixel: [3], PhotometricInterpretation: 2,
    ModelPixelScale: [(maxE - minE) / size, (maxN - minN) / size, 0], ModelTiepoint: [0, 0, 0, minE, maxN, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: 3006 }) as ArrayBuffer;
  return new Uint8Array(tiff);
}

/** En PNG i en färg (RGBA). */
export function solidPng(width: number, height: number, rgba: readonly [number, number, number, number]): Buffer {
  const row = Buffer.alloc(1 + width * 4);
  for (let x = 0; x < width; x += 1) row.set(rgba, 1 + x * 4);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))]);
}

/** Rutan (WGS 84) i SWEREF 99 TM. */
function sweref(west: number, south: number, east: number, north: number) {
  const corners = [[south, west], [south, east], [north, west], [north, east]].map(([lat, lon]) => wgs84ToProjected({ kind: "EPSG", code: 3006 }, lat!, lon!));
  return { minE: Math.min(...corners.map(c => c.easting)), maxE: Math.max(...corners.map(c => c.easting)),
    minN: Math.min(...corners.map(c => c.northing)), maxN: Math.max(...corners.map(c => c.northing)) };
}

export function startFakeGeodata(port = FAKE_GEODATA_PORT): Promise<Server> {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fake-geodata");
    const authorized = typeof request.headers.authorization === "string" && /^(Basic|Bearer) /.test(request.headers.authorization);
    if (url.pathname === "/slu-wms") {
      if (url.searchParams.get("REQUEST") === "GetCapabilities") {
        response.writeHead(200, { "content-type": "application/xml" }).end("<WMT_MS_Capabilities><Capability><Layer><Title>SLU</Title>"
          + "<Layer><Name>Markfuktighet_SLU_2_0</Name></Layer></Layer></Capability></WMT_MS_Capabilities>");
        return;
      }
      const width = Number(url.searchParams.get("WIDTH")), height = Number(url.searchParams.get("HEIGHT"));
      if (!(width > 0 && width <= 4000 && height > 0 && height <= 4000) || url.searchParams.get("SRS") !== "EPSG:3006") { response.writeHead(400).end(); return; }
      response.writeHead(200, { "content-type": "image/png" }).end(solidPng(width, height, [30, 80, 220, 160]));
      return;
    }
    if (url.pathname.startsWith("/stac-hojd/") || url.pathname.startsWith("/laser/")) {
      if (!authorized) { response.writeHead(401).end(); return; }
      if (url.pathname === "/stac-hojd/v1/collections") {
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ collections: [{ id: "markhojdmodell", title: "Markhöjdmodell" },
          { id: "laserdata-skog", title: "Laserdata skog" }] }));
        return;
      }
      const laser = /^\/laser\/(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\.laz$/.exec(url.pathname);
      if (laser && request.method === "GET") {
        const body = JSON.stringify(sweref(...laser.slice(1).map(Number) as [number, number, number, number]));
        response.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(Buffer.byteLength(body)) }).end(body);
        return;
      }
      if (url.pathname !== "/stac-hojd/v1/search" || request.method !== "POST") { response.writeHead(404).end(); return; }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        const search = JSON.parse(body) as { bbox: number[]; collections?: string[] };
        if (search.collections?.[0] !== "laserdata-skog") { response.writeHead(400).end(); return; }
        const bbox = search.bbox.map(value => value.toFixed(6)).join(",");
        response.writeHead(200, { "content-type": "application/geo+json" }).end(JSON.stringify({ type: "FeatureCollection", features: [
          { type: "Feature", id: "24E001_658_67_2550", collection: "laserdata-skog", bbox: search.bbox,
            properties: { datetime: "2024-05-20T00:00:00Z", "proj:epsg": 3006 },
            assets: { data: { href: `http://${request.headers.host}/laser/${bbox}.laz`, type: "application/vnd.laszip", "file:size": 123_000_000 } } }
        ] }));
      });
      return;
    }
    if (url.pathname === "/stac-bild/v1/search" || url.pathname.startsWith("/orto/")) {
      if (!authorized) { response.writeHead(401).end(); return; }
      if (request.method === "GET") {
        const box = /^\/orto\/(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\.tif$/.exec(url.pathname);
        const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
        if (!box || !range) { response.writeHead(400).end(); return; }
        const tiff = fakeOrtho(...box.slice(1).map(Number) as [number, number, number, number]);
        const start = Number(range[1]), end = Math.min(Number(range[2]), tiff.length - 1);
        response.writeHead(206, { "content-type": "image/tiff", "content-range": `bytes ${start}-${end}/${tiff.length}`, "accept-ranges": "bytes",
          "content-length": String(end - start + 1) }).end(Buffer.from(tiff.subarray(start, end + 1)));
        return;
      }
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => { body += chunk; });
      request.on("end", () => {
        const bbox = (JSON.parse(body) as { bbox: number[] }).bbox.map(value => value.toFixed(6)).join(",");
        const href = `http://${request.headers.host}/orto/${bbox}.tif`;
        response.writeHead(200, { "content-type": "application/geo+json" }).end(JSON.stringify({ type: "FeatureCollection", features: [
          { type: "Feature", id: "64_6_2025", collection: "orto-2025", properties: { datetime: "2025-06-15T00:00:00Z" },
            assets: { data: { href, type: "image/tiff; application=geotiff; profile=cloud-optimized" } } }
        ] }));
      });
      return;
    }
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
