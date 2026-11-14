/**
 * Ägaren 2026-11-14 («det verkade som den andra tråden inte gjorde ihopläsningen på servern. jag skulle vilja att det var så»):
 * en laserkörning som servern delat i etapper läggs ihop till en körning på geo-servern, så att webbläsaren hämtar en bild
 * och en fil i stället för en per etapp. Reglerna är desamma som när webbläsaren läste ihop etapperna
 * (`packages/map-revision/src/base-map/stages.ts`): varje etapp bearbetas med marginal, så etapperna överlappar; varje etapps
 * objekt klipps till etappens egen klippruta och bilderna läggs kant i kant efter samma rutor.
 *
 * Bara Nodes egna moduler (filen körs direkt av geo-arbetaren).
 */
import { deflateSync, inflateSync } from "node:zlib";

export interface Box { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }
type Pair = readonly [number, number];

// --- Klippning ------------------------------------------------------------------------------------------------------------

const within = (box: Box, [x, y]: Pair) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;

/**
 * Punkter hör till en etapp: halvöppet mot grannen (en punkt på snittet hamnar i en etapp), slutet mot körningens ytterkant.
 */
export function ownsPoint(box: Box, union: Box, [x, y]: Pair): boolean {
  return x >= box.minX && y >= box.minY && (x < box.maxX || (box.maxX >= union.maxX && x <= box.maxX)) && (y < box.maxY || (box.maxY >= union.maxY && y <= box.maxY));
}

/** Linjens bitar inom rutan (Liang–Barsky per sträcka; sträckor som hänger ihop inne i rutan blir en bit). */
export function clipLine(points: readonly Pair[], box: Box): [number, number][][] {
  const pieces: [number, number][][] = [];
  let piece: [number, number][] = [];
  const end = () => { if (piece.length >= 2) pieces.push(piece); piece = []; };
  for (let i = 0; i + 1 < points.length; i += 1) {
    const [x0, y0] = points[i]!, [x1, y1] = points[i + 1]!, dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1, outside = false;
    for (const [p, q] of [[-dx, x0 - box.minX], [dx, box.maxX - x0], [-dy, y0 - box.minY], [dy, box.maxY - y0]] as const) {
      if (p === 0) { if (q < 0) { outside = true; break; } continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) { outside = true; break; } if (t > t0) t0 = t; }
      else { if (t < t0) { outside = true; break; } if (t < t1) t1 = t; }
    }
    if (outside) { end(); continue; }
    const a: [number, number] = t0 === 0 ? [x0, y0] : [x0 + dx * t0, y0 + dy * t0], b: [number, number] = t1 === 1 ? [x1, y1] : [x0 + dx * t1, y0 + dy * t1];
    if (piece.length === 0) piece.push(a);
    else if (t0 > 0) { end(); piece.push(a); }
    piece.push(b);
    if (t1 < 1) end();
  }
  end();
  return pieces;
}

/** Ringen klippt till rutan (Sutherland–Hodgman); ringen anges utan upprepad första punkt. */
export function clipRing(ring: readonly Pair[], box: Box): [number, number][] {
  let out: [number, number][] = ring.map(([x, y]) => [x, y]);
  const edges: readonly [(p: Pair) => boolean, (a: Pair, b: Pair) => [number, number]][] = [
    [p => p[0] >= box.minX, (a, b) => [box.minX, a[1] + (b[1] - a[1]) * (box.minX - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= box.maxX, (a, b) => [box.maxX, a[1] + (b[1] - a[1]) * (box.maxX - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= box.minY, (a, b) => [a[0] + (b[0] - a[0]) * (box.minY - a[1]) / (b[1] - a[1]), box.minY]],
    [p => p[1] <= box.maxY, (a, b) => [a[0] + (b[0] - a[0]) * (box.maxY - a[1]) / (b[1] - a[1]), box.maxY]]
  ];
  for (const [inside, cross] of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i]!, previous = input[(i + input.length - 1) % input.length]!;
      if (inside(current)) { if (!inside(previous)) out.push(cross(previous, current)); out.push(current); }
      else if (inside(previous)) out.push(cross(previous, current));
    }
    if (out.length === 0) break;
  }
  return out;
}

// --- DXF ------------------------------------------------------------------------------------------------------------------

type Group = readonly [string, string];
const fixed = (value: number) => value.toFixed(2);

function groupsOf(text: string): Group[] {
  const lines = text.split(/\r?\n/), groups: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) groups.push([lines[i]!.trim(), lines[i + 1]!.trim()]);
  return groups;
}
const write = (out: string[], groups: readonly Group[]) => { for (const [code, value] of groups) out.push(code, value); };

/** Filens delar: allt före objekten (till och med «ENTITIES»), objekten och allt efter (från «ENDSEC»). */
function sections(groups: readonly Group[]): { head: Group[]; entities: Group[]; tail: Group[] } {
  const start = groups.findIndex(([code, value], i) => code === "2" && value === "ENTITIES" && groups[i - 1]?.[1] === "SECTION");
  if (start < 0) return { head: [["0", "SECTION"], ["2", "ENTITIES"]], entities: [], tail: [["0", "ENDSEC"], ["0", "EOF"]] };
  let end = groups.findIndex(([code, value], i) => i > start && code === "0" && value === "ENDSEC");
  if (end < 0) end = groups.length;
  return { head: groups.slice(0, start + 1), entities: groups.slice(start + 1, end), tail: end < groups.length ? groups.slice(end) : [["0", "ENDSEC"], ["0", "EOF"]] };
}

const numberOf = (groups: readonly Group[], code: string) => { const found = groups.find(group => group[0] === code); return found ? Number(found[1]) : Number.NaN; };

/**
 * Objekten i en etapps DXF klippta till etappens ruta, som rader att skriva i den sammanlagda filen. Linjer delas vid kanten;
 * slutna linjer som går över kanten blir öppna bitar, eller klippta ytor när filen är en ytfil (`areas`). Punkter hör till
 * den etapp som äger dem. Objekt utan läge tas bara med ur den första etappen.
 */
export function clipDxfEntities(text: string, box: Box, union: Box, options: { readonly areas?: boolean; readonly first?: boolean } = {}): string[] {
  const { entities } = sections(groupsOf(text)), out: string[] = [];
  let i = 0;
  const body = () => { const from = i; i += 1; while (i < entities.length && entities[i]![0] !== "0") i += 1; return entities.slice(from, i); };
  const polyline = (header: readonly Group[], points: readonly Pair[], closed: boolean, emit: (points: readonly Pair[], closed: boolean) => void, verbatim: () => void) => {
    if (points.length === 0) return;
    if (points.every(point => within(box, point))) { verbatim(); return; }
    if (closed && options.areas) { const ring = clipRing(points, box); if (ring.length >= 3) emit(ring, true); return; }
    for (const piece of clipLine(closed ? [...points, points[0]!] : points, box)) emit(piece, false);
  };
  while (i < entities.length) {
    const type = entities[i]![1], header = body();
    if (type === "POLYLINE") {
      const vertices: Group[][] = [];
      while (i < entities.length && entities[i]![1] === "VERTEX") vertices.push(body());
      const seqend = i < entities.length && entities[i]![1] === "SEQEND" ? body() : [["0", "SEQEND"] as Group];
      const points = vertices.map(vertex => [numberOf(vertex, "10"), numberOf(vertex, "20")] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      const flags = numberOf(header, "70"), closed = Number.isFinite(flags) && (flags & 1) === 1;
      // Nya punkter får första punktens övriga uppgifter (lagret, höjden).
      const extra = (vertices[0] ?? []).filter(([code]) => code !== "0" && code !== "10" && code !== "20");
      polyline(header, points, closed, (piece, pieceClosed) => {
        write(out, header.filter(([code]) => code !== "70"));
        out.push("70", String(((Number.isFinite(flags) ? flags : 0) & ~1) | (pieceClosed ? 1 : 0)));
        for (const [x, y] of piece) { out.push("0", "VERTEX"); write(out, extra); out.push("10", fixed(x), "20", fixed(y)); }
        write(out, seqend);
      }, () => { write(out, header); for (const vertex of vertices) write(out, vertex); write(out, seqend); });
    } else if (type === "LWPOLYLINE") {
      const points: [number, number][] = [];
      for (let k = 0; k < header.length; k += 1) if (header[k]![0] === "10" && header[k + 1]?.[0] === "20") points.push([Number(header[k]![1]), Number(header[k + 1]![1])]);
      const flags = numberOf(header, "70"), closed = Number.isFinite(flags) && (flags & 1) === 1;
      const rest = header.filter(([code]) => !["10", "20", "40", "41", "42", "70", "90"].includes(code));
      polyline(header, points, closed, (piece, pieceClosed) => {
        write(out, rest);
        out.push("90", String(piece.length), "70", String(((Number.isFinite(flags) ? flags : 0) & ~1) | (pieceClosed ? 1 : 0)));
        for (const [x, y] of piece) out.push("10", fixed(x), "20", fixed(y));
      }, () => write(out, header));
    } else if (type === "LINE") {
      const a = [numberOf(header, "10"), numberOf(header, "20")] as const, b = [numberOf(header, "11"), numberOf(header, "21")] as const;
      if (within(box, a) && within(box, b)) { write(out, header); continue; }
      const [piece] = clipLine([a, b], box);
      if (!piece) continue;
      write(out, header.filter(([code]) => !["10", "20", "11", "21"].includes(code)));
      out.push("10", fixed(piece[0]![0]), "20", fixed(piece[0]![1]), "11", fixed(piece[1]![0]), "21", fixed(piece[1]![1]));
    } else {
      const at = [numberOf(header, "10"), numberOf(header, "20")] as const;
      if (Number.isFinite(at[0]) && Number.isFinite(at[1]) ? ownsPoint(box, union, at) : options.first) write(out, header);
    }
  }
  return out;
}

/** Den sammanlagda filens början (ur den första etappens fil) och slut. */
export function dxfFrame(text: string): { head: string; tail: string } {
  // Bara början behövs: objekten kan vara många miljoner rader.
  const at = text.search(/(^|\n)\s*2\s*\r?\n\s*ENTITIES\s*(\r?\n|$)/);
  if (at < 0) return { head: "0\nSECTION\n2\nENTITIES\n", tail: "0\nENDSEC\n0\nEOF\n" };
  const head = groupsOf(text.slice(0, text.indexOf("ENTITIES", at) + "ENTITIES".length));
  return { head: `${head.flat().join("\n")}\n`, tail: "0\nENDSEC\n0\nEOF\n" };
}

/** DXF-filer vars slutna linjer är ytor (klipps som ytor, inte till öppna bitar). */
export const AREA_DXF: ReadonlySet<string> = new Set(["vegetation.dxf", "fukt.dxf", "berg.dxf", "belagt.dxf"]);

// --- GeoJSON --------------------------------------------------------------------------------------------------------------

interface Feature { type: "Feature"; geometry: { type: string; coordinates: unknown } | null; properties?: unknown; [key: string]: unknown }
const pairOf = (value: unknown): Pair => [Number((value as number[])[0]), Number((value as number[])[1])];
const round = ([x, y]: Pair): [number, number] => [Math.round(x * 100) / 100, Math.round(y * 100) / 100];

/** En ring (med upprepad första punkt, som i GeoJSON) klippt till rutan; `undefined` när inget blir kvar. */
function clipGeoRing(ring: readonly unknown[], box: Box): [number, number][] | undefined {
  const points = ring.map(pairOf);
  if (points.every(point => within(box, point))) return points.map(([x, y]) => [x, y]);
  const open = points.length > 1 && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1] ? points.slice(0, -1) : points;
  const clipped = clipRing(open, box).map(round);
  return clipped.length >= 3 ? [...clipped, clipped[0]!] : undefined;
}
function clipGeoPolygon(rings: readonly (readonly unknown[])[], box: Box): [number, number][][] | undefined {
  const outer = rings[0] ? clipGeoRing(rings[0], box) : undefined;
  if (!outer) return undefined;
  return [outer, ...rings.slice(1).flatMap(ring => { const hole = clipGeoRing(ring, box); return hole ? [hole] : []; })];
}

/** Objekten i en etapps GeoJSON klippta till etappens ruta (samma regler som för DXF; ytor klipps som ytor). */
export function clipGeoJsonFeatures(features: readonly Feature[], box: Box, union: Box): Feature[] {
  const out: Feature[] = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const coordinates = geometry.coordinates as unknown[];
    const withGeometry = (type: string, value: unknown) => out.push({ ...feature, geometry: { ...geometry, type, coordinates: value } });
    if (geometry.type === "Point") { if (ownsPoint(box, union, pairOf(coordinates))) out.push(feature); }
    else if (geometry.type === "MultiPoint") {
      const kept = coordinates.filter(point => ownsPoint(box, union, pairOf(point)));
      if (kept.length) withGeometry("MultiPoint", kept);
    } else if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
      const lines = (geometry.type === "LineString" ? [coordinates] : coordinates as unknown[][]).map(line => line.map(pairOf));
      if (lines.every(line => line.every(point => within(box, point)))) { out.push(feature); continue; }
      for (const piece of lines.flatMap(line => clipLine(line, box))) withGeometry("LineString", piece.map(round));
    } else if (geometry.type === "Polygon") {
      const polygon = clipGeoPolygon(coordinates as unknown[][], box);
      if (polygon) withGeometry("Polygon", polygon);
    } else if (geometry.type === "MultiPolygon") {
      const polygons = (coordinates as unknown[][][]).flatMap(rings => { const polygon = clipGeoPolygon(rings, box); return polygon ? [polygon] : []; });
      if (polygons.length) withGeometry("MultiPolygon", polygons);
    }
  }
  return out;
}

/** Etappernas GeoJSON som en fil; övriga uppgifter (koordinatsystemet) tas ur den första. */
export function mergeGeoJson(stages: readonly { readonly text: string; readonly box: Box }[], union: Box): string {
  let frame: Record<string, unknown> | undefined;
  const features: Feature[] = [];
  for (const stage of stages) {
    const parsed = JSON.parse(stage.text) as { features?: Feature[] } & Record<string, unknown>;
    frame ??= parsed;
    features.push(...clipGeoJsonFeatures(Array.isArray(parsed.features) ? parsed.features : [], stage.box, union));
  }
  return JSON.stringify({ ...(frame ?? { type: "FeatureCollection" }), features });
}

// --- PNG ------------------------------------------------------------------------------------------------------------------

export interface RawPng {
  readonly width: number; readonly height: number; readonly bitDepth: 8 | 16; readonly colorType: 0 | 2 | 3 | 4 | 6;
  /** Byte per bildpunkt. */
  readonly bpp: number;
  /** Raderna uppifrån, utan filterbyte. */
  readonly data: Uint8Array;
  readonly palette?: Uint8Array | undefined; readonly transparency?: Uint8Array | undefined;
}
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
export const MERGE_MAX_PIXELS = 400_000_000;

/** En PNG som rader av byte (8 eller 16 bitar; gråskala, färg, palett, med eller utan alfa; inte sammanflätad). */
export function decodePng(bytes: Uint8Array): RawPng {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 33 || view.getUint32(0) !== 0x89504e47) throw new Error("Bilden är ingen PNG");
  let offset = 8, width = 0, height = 0, colorType = -1, bitDepth = 0, interlace = 0, palette: Uint8Array | undefined, transparency: Uint8Array | undefined;
  const parts: Uint8Array[] = [];
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8); height = view.getUint32(offset + 12);
      bitDepth = bytes[offset + 16]!; colorType = bytes[offset + 17]!; interlace = bytes[offset + 20]!;
    } else if (type === "PLTE") palette = data.slice();
    else if (type === "tRNS") transparency = data.slice();
    else if (type === "IDAT") parts.push(data);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if ((bitDepth !== 8 && bitDepth !== 16) || !(colorType in CHANNELS) || (colorType === 3 && bitDepth !== 8) || interlace !== 0) throw new Error("Bilden har ett format som inte kan läggas ihop");
  if (width <= 0 || height <= 0 || width * height > MERGE_MAX_PIXELS) throw new Error("Bilden är för stor");
  const bpp = CHANNELS[colorType]! * bitDepth / 8, stride = width * bpp;
  const raw = inflateSync(Buffer.concat(parts), { maxOutputLength: height * (stride + 1) + 1024 });
  if (raw.byteLength < height * (stride + 1)) throw new Error("Bilden är avkortad");
  const data = new Uint8Array(height * stride);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)]!, source = row * (stride + 1) + 1, target = row * stride;
    if (filter === 0) { data.set(raw.subarray(source, source + stride), target); continue; }
    if (filter > 4) throw new Error("Bilden har ett okänt filter");
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? data[target + i - bpp]! : 0, up = row > 0 ? data[target - stride + i]! : 0;
      let predicted: number;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else {
        const corner = row > 0 && i >= bpp ? data[target - stride + i - bpp]! : 0;
        const p = left + up - corner, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - corner);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      data[target + i] = (raw[source + i]! + predicted) & 0xff;
    }
  }
  return { width, height, bitDepth, colorType: colorType as RawPng["colorType"], bpp, data, palette, transparency };
}

const CRC = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.byteLength);
  out.writeUInt32BE(data.byteLength, 0); out.write(type, 4, "latin1"); out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.byteLength; i += 1) crc = CRC[(crc ^ out[i]!) & 0xff]! ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.byteLength);
  return out;
}

/** Raderna som PNG. Varje rad får filtret «upp» (bra för jämna raster) utom paletter, som skrivs utan filter. */
export function encodeRawPng(image: RawPng): Buffer {
  const stride = image.width * image.bpp, raw = Buffer.alloc(image.height * (stride + 1));
  for (let row = 0; row < image.height; row += 1) {
    const source = row * stride, target = row * (stride + 1);
    if (image.colorType === 3 || row === 0) { raw[target] = 0; raw.set(image.data.subarray(source, source + stride), target + 1); continue; }
    raw[target] = 2;
    for (let i = 0; i < stride; i += 1) raw[target + 1 + i] = (image.data[source + i]! - image.data[source - stride + i]!) & 0xff;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0); header.writeUInt32BE(image.height, 4);
  header[8] = image.bitDepth; header[9] = image.colorType;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    ...(image.palette ? [chunk("PLTE", image.palette)] : []), ...(image.transparency ? [chunk("tRNS", image.transparency)] : []),
    chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))]);
}

/** Bilden som RGBA med 8 bitar (när etapperna har olika format). */
export function toRgba(image: RawPng): RawPng {
  if (image.colorType === 6 && image.bitDepth === 8) return image;
  const pixels = image.width * image.height, data = new Uint8Array(pixels * 4), step = image.bitDepth / 8, source = image.data;
  for (let i = 0; i < pixels; i += 1) {
    const at = i * image.bpp;
    let r: number, g: number, b: number, a = 255;
    if (image.colorType === 3) {
      const index = source[at]!;
      r = image.palette?.[index * 3] ?? 0; g = image.palette?.[index * 3 + 1] ?? 0; b = image.palette?.[index * 3 + 2] ?? 0; a = image.transparency?.[index] ?? 255;
    } else if (image.colorType === 0 || image.colorType === 4) {
      r = g = b = source[at]!;
      if (image.colorType === 4) a = source[at + step]!;
    } else {
      r = source[at]!; g = source[at + step]!; b = source[at + 2 * step]!;
      if (image.colorType === 6) a = source[at + 3 * step]!;
    }
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = a;
  }
  return { width: image.width, height: image.height, bitDepth: 8, colorType: 6, bpp: 4, data };
}

export interface World { readonly size: number; readonly left: number; readonly top: number }
/** Världsfilen för en bild med norr uppåt: bildpunktens storlek och bildens vänstra och övre kant. */
export function readWorld(text: string): World {
  const [a, d, b, e, c, f] = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(Number);
  if (![a, d, b, e, c, f].every(Number.isFinite) || !(a! > 0) || !(e! < 0) || Math.abs(d!) > 1e-9 || Math.abs(b!) > 1e-9 || Math.abs(a! + e!) > 1e-6 * a!) throw new Error("Bildens världsfil kan inte läggas ihop");
  return { size: a!, left: c! - a! / 2, top: f! + a! / 2 };
}
export const writeWorld = (world: World) => `${world.size}\n0\n0\n${-world.size}\n${world.left + world.size / 2}\n${world.top - world.size / 2}\n`;

const sameBytes = (a: Uint8Array | undefined, b: Uint8Array | undefined) => a === b || (!!a && !!b && a.byteLength === b.byteLength && a.every((value, i) => value === b[i]));

/**
 * Etappernas bilder som en. Först läggs alla bilder ut hela, så att ingen bildpunkt blir tom i skarven; sedan läggs varje
 * etapps egen ruta överst, så att skarven går i snittet och inte i marginalen (där kanten av beräkningen ligger). Rutans
 * sidor mot körningens ytterkant räknas som obegränsade, så att marginalen utanför körningen följer med från sin etapp.
 * Förskjutningen mellan bilderna avrundas till hela bildpunkter.
 */
export function mosaicPng(parts: readonly { readonly image: RawPng; readonly world: World; readonly box: Box }[], union: Box): { image: RawPng; world: World } {
  const first = parts[0];
  if (!first) throw new Error("Inga bilder att lägga ihop");
  const size = first.world.size;
  if (parts.some(part => Math.abs(part.world.size - size) > 1e-6 * size)) throw new Error("Etappernas bilder har olika upplösning");
  const same = parts.every(part => part.image.colorType === first.image.colorType && part.image.bitDepth === first.image.bitDepth
    && sameBytes(part.image.palette, first.image.palette) && sameBytes(part.image.transparency, first.image.transparency));
  const images = same ? parts.map(part => part.image) : parts.map(part => toRgba(part.image));
  const left = Math.min(...parts.map(part => part.world.left)), top = Math.max(...parts.map(part => part.world.top));
  const placed = parts.map((part, i) => ({ image: images[i]!, box: part.box, column: Math.round((part.world.left - left) / size), row: Math.round((top - part.world.top) / size) }));
  const width = Math.max(...placed.map(part => part.column + part.image.width)), height = Math.max(...placed.map(part => part.row + part.image.height));
  if (width * height > MERGE_MAX_PIXELS) throw new Error("Den sammanlagda bilden blir för stor");
  const bpp = images[0]!.bpp, data = new Uint8Array(width * height * bpp);
  const copy = (part: typeof placed[number], row: number, from: number, to: number) => {
    if (to <= from) return;
    const source = ((row - part.row) * part.image.width + from - part.column) * bpp;
    data.set(part.image.data.subarray(source, source + (to - from) * bpp), (row * width + from) * bpp);
  };
  for (const part of placed) for (let row = part.row; row < part.row + part.image.height; row += 1) copy(part, row, part.column, part.column + part.image.width);
  for (const part of placed) {
    const { box } = part;
    // Bildpunktens mitt avgör vem som äger den.
    const minX = box.minX <= union.minX ? -Infinity : box.minX, maxX = box.maxX >= union.maxX ? Infinity : box.maxX;
    const minY = box.minY <= union.minY ? -Infinity : box.minY, maxY = box.maxY >= union.maxY ? Infinity : box.maxY;
    const from = Math.max(part.column, minX === -Infinity ? 0 : Math.ceil((minX - left) / size - 0.5));
    const to = Math.min(part.column + part.image.width, maxX === Infinity ? width : Math.ceil((maxX - left) / size - 0.5));
    const firstRow = Math.max(part.row, maxY === Infinity ? 0 : Math.floor((top - maxY) / size - 0.5) + 1);
    const lastRow = Math.min(part.row + part.image.height, minY === -Infinity ? height : Math.floor((top - minY) / size - 0.5) + 1);
    for (let row = firstRow; row < lastRow; row += 1) copy(part, row, from, to);
  }
  const { bitDepth, colorType, palette, transparency } = images[0]!;
  return { image: { width, height, bitDepth, colorType, bpp, data, palette, transparency }, world: { size, left, top } };
}
