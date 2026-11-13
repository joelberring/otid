import { deflateSync } from "node:zlib";
import { mapPointToProjected, type MapObject, type PathCommand, type Point } from "@o-tid/map-file";
import { samplePath } from "@o-tid/map-revision";
import type { LoadedProjectMap } from "./map-project-job-run";

/**
 * Ägaren 2026-11-11 («en mer automatiserad process att lära av denna karta»): kartan som klassraster i kartans plana
 * koordinater (norr upp, t.ex. SWEREF 99 TM), så att geo-arbetarens regler kan trimmas mot en väl ritad karta
 * (scripts/learn). En cell per `cell` meter; kanalerna:
 *
 * - **R, marken** (senare målat går före): 1 ödemark 403, 2 ödemark med träd 404, 3 öppen mark 401, 4 öppen med träd 402,
 *   5 grönt 406, 6 grönt 408, 7 grönt 410, 8 berg i dagen 214, 9 odlat 412–414, 10 stenig mark och block 208–213 (ytor),
 *   11 tomtmark 520, 12 hårdgjort 501, 13 byggnad 521–522, 14 vatten 301–302, 15 opasserbar vegetation 411 (sprintnormen).
 * - **G, linjer och lager ovanpå:** låga fyra bitar 1 höjdkurva 101, 2 stödkurva 102, 3 hjälpkurva 103, 4 opasserbar brant
 *   201, 5 brant 202, 6 vattendrag och dike 304–306, 7 smal sankmark 309, 8 väg och stig 502–508, 9 jordbrant och vall
 *   104–108, 10 passerbar mur och staket 513/516, 11 opasserbar mur och staket 515/518, 12 opasserbar häck 411 (linje);
 *   bit 16 sankmark 307–308, bit 32 otydlig sankmark 310, bit 64 undervegetation 407, bit 128 undervegetation 409.
 * - **B, punkter:** 1 punkthöjd 109, 2 avlång punkthöjd 110, 3 grop 111–112, 4 sten 204, 5 stor sten 205–206, 6 stengrupp
 *   207, 7 stenig mark (punkt) 208–212, 8 liten sankmark 308, 9 träd och buske 417–418, 10 liten otydlig sankmark 310.
 */
export interface LabelsRequest { minE: number; minN: number; maxE: number; maxN: number; cell?: number | undefined }
export const LABELS_MAX_SIDE = 2000;

const GROUND: readonly (readonly [number, readonly number[]])[] = [[1, [403]], [2, [404]], [3, [401]], [4, [402]], [5, [406]], [6, [408]], [7, [410]],
  [8, [214]], [9, [412, 413, 414]], [10, [208, 209, 210, 211, 212, 213]], [11, [520]], [12, [501]], [13, [521, 522]], [14, [301, 302]], [15, [411]]];
const LINES: readonly (readonly [number, readonly number[]])[] = [[1, [101]], [2, [102]], [3, [103]], [4, [201]], [5, [202]], [6, [304, 305, 306]], [7, [309]],
  [8, [502, 503, 504, 505, 506, 507, 508]], [9, [104, 105, 106, 107, 108]], [10, [513, 516]], [11, [515, 518]], [12, [411]]];
const OVERLAY: readonly (readonly [number, readonly number[]])[] = [[16, [307, 308]], [32, [310]], [64, [407]], [128, [409]]];
const POINTS: readonly (readonly [number, readonly number[]])[] = [[1, [109]], [2, [110]], [3, [111, 112]], [4, [204]], [5, [205, 206]], [6, [207]],
  [7, [208, 209, 210, 211, 212]], [8, [308]], [9, [417, 418]], [10, [310]]];
/**
 * Äldre kartor (ägarens testkartor 2026-11-11, t.ex. Lida) har ISOM 2000-nummer: 112 är punkthöjd, 310 sankmark, 526 byggnad.
 * De räknas om till ISOM 2017-2 innan klasserna slås upp. Nummer som saknas här behålls.
 */
const ISOM_2000: Readonly<Record<number, number>> = { 104: 0, 106: 104, 107: 105, 108: 106, 109: 107, 110: 108, 112: 109, 113: 110, 114: 111, 115: 111,
  116: 112, 117: 113, 118: 115, 202: 206, 203: 202, 204: 203, 205: 203, 206: 204, 207: 205, 208: 208, 209: 207, 211: 213, 212: 214,
  302: 301, 304: 301, 305: 304, 306: 305, 307: 306, 308: 309, 309: 307, 310: 308, 311: 310, 312: 311, 313: 312,
  411: 406, 421: 411, 412: 413, 413: 414, 414: 415, 415: 412, 418: 417, 419: 418, 420: 419,
  501: 502, 503: 502, 504: 503, 505: 504, 506: 505, 507: 506, 508: 507, 509: 508, 515: 509, 516: 510, 517: 511,
  // Murar och staket (ägarens sprintkartor 2026-11-13 i den äldre sprintnormen ISSOM 2007, som följer ISOM 2000:s nummer):
  // 519 mur, 521 hög mur, 522 staket, 524 högt staket, 525 passage; 421 är sprintnormens opasserbara vegetation.
  519: 513, 520: 514, 521: 515, 522: 516, 523: 517, 524: 518, 525: 519,
  526: 521, 527: 520, 528: 520, 529: 501 };
export const isom2000To2017 = (main: number): number => ISOM_2000[main] ?? main;
/** ISOM 2000 känns igen på ytor med 526 (byggnad), 527 (tomtmark) eller 529 (hårdgjort): i ISOM 2017-2 är de punkter och linjer. */
export const usesIsom2000 = (areaCodes: Iterable<number>): boolean => { for (const main of areaCodes) if (main === 526 || main === 527 || main === 529) return true; return false; };
const classOf = (table: readonly (readonly [number, readonly number[]])[], main: number) => table.find(([, codes]) => codes.includes(main))?.[0];

const CRC = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i += 1) crc = CRC[(crc ^ out[i]!) & 255]! ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length);
  return out;
}
/** PNG (RGBA, 8 bitar) av råa bildpunkter radvis uppifrån. */
export function rgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row += 1) raw.set(rgba.subarray(row * width * 4, (row + 1) * width * 4), row * (1 + width * 4) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

export function runLabels(loaded: LoadedProjectMap, request: LabelsRequest): { png: Uint8Array; meta: Record<string, unknown> } | { error: string } {
  const georef = loaded.base.georeference;
  if (!georef) return { error: "Kartan saknar georeferens" };
  const cell = Math.min(10, Math.max(0.5, request.cell ?? 2));
  const width = Math.round((request.maxE - request.minE) / cell), height = Math.round((request.maxN - request.minN) / cell);
  if (!(width >= 1 && height >= 1) || width > LABELS_MAX_SIDE || height > LABELS_MAX_SIDE) return { error: `Området ger ${width} × ${height} celler (högst ${LABELS_MAX_SIDE} per sida)` };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  const mmPerCell = cell * 1000 / loaded.base.scale;
  /** Kartans mm till bildens kolumn och rad (decimaler). */
  const toPixel = (point: Point): [number, number] => {
    const at = mapPointToProjected(georef, point);
    return [(at.easting - request.minE) / cell, (request.maxN - at.northing) / cell];
  };
  const pointsOf = (path: readonly PathCommand[]) => samplePath(path, mmPerCell / 2).map(toPixel);
  const mainOf = (object: MapObject) => loaded.base.symbols.get(object.symbol)?.code.main ?? 0;
  const old = usesIsom2000(loaded.objects.filter(object => object.kind === "area").map(mainOf));
  const codeOf = (object: MapObject) => old ? isom2000To2017(mainOf(object)) : mainOf(object);
  const set = (column: number, row: number, channel: 0 | 1 | 2, write: (old: number) => number) => {
    if (column < 0 || row < 0 || column >= width || row >= height) return;
    const i = (row * width + column) * 4 + channel;
    rgba[i] = write(rgba[i]!);
  };
  /** Jämn–udda-fyllning av ringarna, rad för rad genom cellernas mitt. */
  const fill = (rings: readonly (readonly [number, number][])[], channel: 0 | 1, write: (old: number) => number) => {
    let top = Infinity, bottom = -Infinity;
    for (const ring of rings) for (const [, y] of ring) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    for (let row = Math.max(0, Math.floor(top)); row <= Math.min(height - 1, Math.ceil(bottom)); row += 1) {
      const y = row + 0.5, crossings: number[] = [];
      for (const ring of rings) for (let i = 0; i < ring.length; i += 1) {
        const [ax, ay] = ring[i]!, [bx, by] = ring[(i + 1) % ring.length]!;
        if ((ay <= y) !== (by <= y)) crossings.push(ax + (y - ay) / (by - ay) * (bx - ax));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        for (let column = Math.max(0, Math.ceil(crossings[i]! - 0.5)); column <= Math.min(width - 1, Math.floor(crossings[i + 1]! - 0.5)); column += 1) set(column, row, channel, write);
      }
    }
  };
  const counts: Record<string, number> = {};
  const count = (name: string) => { counts[name] = (counts[name] ?? 0) + 1; };
  // Marken i tabellens ordning (senare går före), sedan lagren ovanpå, linjerna och punkterna.
  for (const [value, codes] of GROUND) for (const object of loaded.objects) {
    if (object.kind !== "area" || !codes.includes(codeOf(object))) continue;
    fill(object.rings.map(pointsOf), 0, () => value); count(`ground${value}`);
  }
  for (const object of loaded.objects) {
    const main = codeOf(object);
    if (object.kind === "area") {
      const bit = classOf(OVERLAY, main);
      if (bit) { fill(object.rings.map(pointsOf), 1, old => old | bit); count(`overlay${bit}`); }
    } else if (object.kind === "line") {
      const value = classOf(LINES, main);
      if (!value) continue;
      for (const [x, y] of pointsOf(object.path)) set(Math.floor(x), Math.floor(y), 1, old => (old & 0xf0) | value);
      count(`line${value}`);
    } else if (object.kind === "point") {
      const value = classOf(POINTS, main);
      if (!value) continue;
      const [x, y] = toPixel(object.at);
      set(Math.floor(x), Math.floor(y), 2, () => value); count(`point${value}`);
    }
  }
  return { png: rgbaPng(width, height, rgba), meta: { cell, width, height, minE: request.minE, maxN: request.maxN, counts, symbolSet: old ? "ISOM 2000" : "ISOM 2017-2",
    crs: georef.crs.kind === "EPSG" ? `EPSG:${georef.crs.code}` : georef.crs.description } };
}
