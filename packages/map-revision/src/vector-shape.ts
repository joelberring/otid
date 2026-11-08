import { layerOf, VectorParseError, type SourceData, type SourceFeature } from "./vector-parse";

/**
 * ADR-0219 tillägget om vektorunderlagen (K4b): Shapefile (.shp med .dbf för egenskaperna, .prj för koordinatsystemet och .cpg
 * för teckenkodningen). Punkter, multipunkter, linjer och ytor, med och utan Z/M. Lagret ur egenskaperna (som för GeoJSON),
 * annars filens namn.
 */
export interface ShapeFiles {
  readonly name: string; readonly shp: ArrayBuffer;
  readonly dbf?: ArrayBuffer | undefined; readonly prj?: string | undefined; readonly cpg?: string | undefined;
}

type Position = readonly [number, number];
const SWEREF_LOCAL: Readonly<Record<string, number>> = { "12_00": 3007, "13_30": 3008, "15_00": 3009, "16_30": 3010, "18_00": 3011,
  "14_15": 3012, "15_45": 3013, "17_15": 3014, "18_45": 3015, "20_15": 3016, "21_45": 3017, "23_15": 3018 };

/** EPSG-koden ur en .prj (WKT): kodens AUTHORITY, annars namnet (SWEREF 99, RT 90, UTM, WGS 84). Undefined om den inte känns igen. */
export function crsFromPrj(wkt: string): number | undefined {
  const text = wkt.trim();
  const authorities = [...text.matchAll(/AUTHORITY\["EPSG",\s*"?(\d{4,5})"?\]/gi)];
  if (/^(PROJCS|GEOGCS)/i.test(text) && authorities.length > 0 && text.endsWith("]]")) {
    const last = authorities[authorities.length - 1]!;
    // Den sista gäller hela systemet bara om den står allra sist.
    if (text.slice(last.index + last[0].length).replace(/[\]\s]/g, "") === "") return Number(last[1]);
  }
  const name = text.replace(/[\s.]+/g, "_").toUpperCase();
  if (/^GEOGCS/.test(name)) return 4326;
  if (/SWEREF_?99_?TM/.test(name)) return 3006;
  const local = /SWEREF_?99_(\d{2})_?(\d{2})/.exec(name);
  if (local) return SWEREF_LOCAL[`${local[1]}_${local[2]}`];
  if (/RT_?90_2_?5_GON_V/.test(name)) return 3021;
  const utm = /UTM_ZONE_(\d{1,2})([NS])?/.exec(name);
  if (utm) {
    const zone = Number(utm[1]);
    if (/ETRS/.test(name)) return 25800 + zone;
    return (utm[2] === "S" ? 32700 : 32600) + zone;
  }
  return undefined;
}

/** Egenskaperna i .dbf, en post per objekt. */
function readDbf(buffer: ArrayBuffer, encoding: string): Record<string, string>[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < 32) return [];
  const count = view.getUint32(4, true), headerLength = view.getUint16(8, true), recordLength = view.getUint16(10, true);
  const decoder = new TextDecoder(encoding);
  const fields: { name: string; length: number }[] = [];
  for (let offset = 32; offset + 32 <= headerLength && view.getUint8(offset) !== 0x0d; offset += 32) {
    const raw = new Uint8Array(buffer, offset, 11);
    const end = raw.indexOf(0);
    fields.push({ name: decoder.decode(raw.subarray(0, end < 0 ? 11 : end)).trim(), length: view.getUint8(offset + 16) });
  }
  const records: Record<string, string>[] = [];
  for (let index = 0; index < count; index += 1) {
    let offset = headerLength + index * recordLength + 1;
    if (offset + recordLength - 1 > buffer.byteLength) break;
    const record: Record<string, string> = {};
    for (const field of fields) {
      record[field.name] = decoder.decode(new Uint8Array(buffer, offset, field.length)).trim();
      offset += field.length;
    }
    records.push(record);
  }
  return records;
}

/** Ringens yta med tecken (positiv moturs med y uppåt). */
const signedArea = (ring: readonly Position[]) => ring.reduce((sum, [x, y], index) => {
  const [nx, ny] = ring[(index + 1) % ring.length]!;
  return sum + x * ny - nx * y;
}, 0) / 2;

export function parseShapefile(files: ShapeFiles): SourceData {
  const view = new DataView(files.shp);
  if (files.shp.byteLength < 100 || view.getInt32(0, false) !== 9994) throw new VectorParseError("Filen är inte en Shapefile (.shp).");
  const encoding = /utf-?8/i.test(files.cpg ?? "") ? "utf-8" : "windows-1252";
  const records = files.dbf ? readDbf(files.dbf, encoding) : [];
  const fallback = files.name.replace(/\.[^.]+$/, "");
  const features: SourceFeature[] = [];
  let skipped = 0, offset = 100, index = 0;
  const point = (at: number): Position => [view.getFloat64(at, true), view.getFloat64(at + 8, true)];
  while (offset + 12 <= files.shp.byteLength) {
    const length = view.getInt32(offset + 4, false) * 2;
    const start = offset + 8;
    offset = start + length;
    if (offset > files.shp.byteLength) break;
    const layer = layerOf(records[index], fallback);
    index += 1;
    const type = view.getInt32(start, true);
    if (type === 0) continue;
    if (type === 1 || type === 11 || type === 21) { features.push({ layer, geometry: { kind: "point", at: point(start + 4) } }); continue; }
    if (type === 8 || type === 18 || type === 28) {
      const count = view.getInt32(start + 36, true);
      for (let at = 0; at < count; at += 1) features.push({ layer, geometry: { kind: "point", at: point(start + 40 + at * 16) } });
      continue;
    }
    if (![3, 13, 23, 5, 15, 25].includes(type)) { skipped += 1; continue; }
    const parts = view.getInt32(start + 36, true), total = view.getInt32(start + 40, true);
    const pointsAt = start + 44 + parts * 4;
    const rings: Position[][] = [];
    for (let part = 0; part < parts; part += 1) {
      const from = view.getInt32(start + 44 + part * 4, true);
      const to = part + 1 < parts ? view.getInt32(start + 44 + (part + 1) * 4, true) : total;
      const ring: Position[] = [];
      for (let at = from; at < to; at += 1) ring.push(point(pointsAt + at * 16));
      rings.push(ring);
    }
    if (type === 3 || type === 13 || type === 23) {
      for (const ring of rings) {
        if (ring.length < 2) { skipped += 1; continue; }
        const first = ring[0]!, last = ring[ring.length - 1]!;
        const closed = ring.length > 3 && first[0] === last[0] && first[1] === last[1];
        features.push({ layer, geometry: { kind: "line", points: closed ? ring.slice(0, -1) : ring, closed } });
      }
      continue;
    }
    // Ytor: medurs ring är en ytterkant (en ny yta), moturs ett hål i den förra.
    let current: Position[][] | undefined;
    for (const raw of rings) {
      const first = raw[0], last = raw[raw.length - 1];
      const ring = first && last && raw.length > 1 && first[0] === last[0] && first[1] === last[1] ? raw.slice(0, -1) : raw;
      if (ring.length < 3) continue;
      if (signedArea(ring) < 0 || !current) {
        if (current) features.push({ layer, geometry: { kind: "area", rings: current } });
        current = [ring];
      } else current.push(ring);
    }
    if (current) features.push({ layer, geometry: { kind: "area", rings: current } }); else skipped += 1;
  }
  return { features, crs: files.prj ? crsFromPrj(files.prj) : undefined, skipped };
}
