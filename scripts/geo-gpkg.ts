/**
 * Grundkartan G8 (ägaren 2026-11-10: underlaget kommer också från Lantmäteriets öppna data): Lantmäteriets kommunvisa
 * vektorprodukter (Marktäcke, Byggnad) är GeoPackage-filer i en zip. Här packas filen upp, objekten inom kartans ruta läses
 * (GeoPackage är en SQLite-databas med geometrin som WKB) och blir GeoJSON med lagernamn som importen känner igen.
 *
 * Marktäcke (tabellerna `mark` och `sankmark`, kolumnen `objekttyp`): sjö och anlagt vatten → `vatten` (301), öppen mark →
 * `oppen_mark` (401), åker → `aker` (412), fruktodling → `fruktodling` (413), sankmark våt → `sankmark_vat` (308), sankmark fast →
 * `sankmark_fast` (310); bebyggelseytorna → `bebyggelse`, utom låg bebyggelse → `bebyggelse_lag` (villor; blir tomtmark i grundkartan). Skog tas inte med.
 * Byggnad: alla ytor → `byggnad` (521).
 *
 * Bara Nodes egna moduler (filen körs direkt av Node i avbildningen `otid-geo`; `node:sqlite` finns från Node 22.5).
 */
import { inflateRawSync } from "node:zlib";

export type Box = { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };
type Ring = [number, number][];
export type Geometry = { kind: "point"; at: [number, number] } | { kind: "line"; points: Ring } | { kind: "area"; rings: Ring[] };
export interface GpkgFeature { readonly table: string; readonly type: string; readonly geometry: Geometry }

/** Den första filen i zip-arkivet vars namn passar (lagrad eller deflate; inget zip64). */
export function unzipFirst(zip: Uint8Array, name: RegExp): { name: string; bytes: Uint8Array } | undefined {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 66_000); i -= 1) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Filen är inte ett zip-arkiv");
  let at = view.getUint32(end + 16, true);
  for (let entry = 0, entries = view.getUint16(end + 10, true); entry < entries; entry += 1) {
    if (at + 46 > zip.length || view.getUint32(at, true) !== 0x02014b50) throw new Error("Zip-arkivets innehållsförteckning är trasig");
    const method = view.getUint16(at + 10, true), packed = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true), fileName = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    if (name.test(fileName)) {
      if (packed === 0xffffffff || local === 0xffffffff) throw new Error("Zip-arkivet är för stort (zip64)");
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true), data = zip.subarray(start, start + packed);
      if (method !== 0 && method !== 8) throw new Error("Zip-arkivet använder en okänd packning");
      return { name: fileName, bytes: method === 0 ? data : new Uint8Array(inflateRawSync(data)) };
    }
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return undefined;
}

/** GeoPackage-geometri (huvud «GP» och sedan WKB, med eller utan Z/M) som punkt, linje eller yta; flerdelade ger flera. */
export function readGpkgGeometry(blob: Uint8Array): Geometry[] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  if (blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) return [];
  const flags = blob[3]!, envelope = [0, 32, 48, 48, 64][(flags >> 1) & 7];
  if (envelope === undefined || flags & 0x10) return [];
  let at = 8 + envelope;
  const out: Geometry[] = [];
  const read = (): void => {
    const little = view.getUint8(at) === 1; at += 1;
    let type = view.getUint32(at, little); at += 4;
    // ISO-WKB (1000-tal för Z, M, ZM) och EWKB (flaggor i de höga bitarna, ev. SRID).
    let extra = 0;
    if (type & 0x20000000) at += 4;
    if (type & 0x80000000) extra += 1;
    if (type & 0x40000000) extra += 1;
    type &= 0x0fffffff;
    if (type >= 3000) { extra = 2; type -= 3000; } else if (type >= 2000) { extra = 1; type -= 2000; } else if (type >= 1000) { extra = 1; type -= 1000; }
    const point = (): [number, number] => { const x = view.getFloat64(at, little), y = view.getFloat64(at + 8, little); at += 16 + extra * 8; return [x, y]; };
    const ring = (): Ring => { const count = view.getUint32(at, little); at += 4; return Array.from({ length: count }, point); };
    if (type === 1) out.push({ kind: "point", at: point() });
    else if (type === 2) out.push({ kind: "line", points: ring() });
    else if (type === 3) { const count = view.getUint32(at, little); at += 4; out.push({ kind: "area", rings: Array.from({ length: count }, ring) }); }
    else if (type >= 4 && type <= 7) { const count = view.getUint32(at, little); at += 4; for (let i = 0; i < count; i += 1) read(); }
    else throw new Error(`Okänd geometrityp ${type}`);
  };
  try { read(); } catch { return []; }
  return out;
}

const boxOf = (geometry: Geometry): Box => {
  const points = geometry.kind === "point" ? [geometry.at] : geometry.kind === "line" ? geometry.points : geometry.rings.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  return { minX, minY, maxX, maxY };
};
const overlaps = (a: Box, b: Box) => a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Objekten i GeoPackage-filen som rör rutan (med tabellens R-träd när det finns), med tabellens namn och `objekttyp`. */
export async function readGpkgFeatures(path: string, box: Box, limit = 200_000): Promise<GpkgFeature[]> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = db.prepare("select c.table_name as name, g.column_name as geom from gpkg_contents c join gpkg_geometry_columns g on g.table_name = c.table_name "
      + "where c.data_type = 'features'").all() as { name: string; geom: string }[];
    const out: GpkgFeature[] = [];
    for (const table of tables) {
      const columns = (db.prepare(`pragma table_info(${quoted(table.name)})`).all() as { name: string; pk: number }[]);
      const key = columns.find(column => column.pk === 1)?.name ?? "fid", type = columns.find(column => column.name.toLowerCase() === "objekttyp")?.name;
      const tree = `rtree_${table.name}_${table.geom}`;
      const indexed = (db.prepare("select count(*) as n from sqlite_master where name = ?").get(tree) as { n: number }).n > 0;
      const select = `select t.${quoted(table.geom)} as geom${type ? `, t.${quoted(type)} as type` : ""} from ${quoted(table.name)} t`;
      const rows = (indexed
        ? db.prepare(`${select} join ${quoted(tree)} r on r.id = t.${quoted(key)} where r.maxx >= ? and r.minx <= ? and r.maxy >= ? and r.miny <= ?`).all(box.minX, box.maxX, box.minY, box.maxY)
        : db.prepare(select).all()) as { geom: Uint8Array | null; type?: unknown }[];
      for (const row of rows) {
        if (!row.geom) continue;
        for (const geometry of readGpkgGeometry(row.geom)) {
          if (!overlaps(boxOf(geometry), box)) continue;
          out.push({ table: table.name, type: typeof row.type === "string" ? row.type : "", geometry });
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  } finally { db.close(); }
}

const plain = (text: string) => text.toLowerCase().replace(/[åä]/g, "a").replace(/ö/g, "o");
/** Marktäckets lager för objektet, eller inget (skog och gränslinjer tas inte med). */
export function landCoverLayer(feature: GpkgFeature): string | undefined {
  if (feature.geometry.kind !== "area") return undefined;
  const type = plain(feature.type);
  if (plain(feature.table).includes("sankmark") || type.includes("sankmark")) return type.includes("fast") ? "sankmark_fast" : "sankmark_vat";
  if (/sjo|vatten|hav/.test(type)) return "vatten";
  if (type.includes("oppen mark")) return "oppen_mark";
  if (type.includes("fruktodling")) return "fruktodling";
  if (type === "aker" || type.startsWith("aker")) return "aker";
  if (type.includes("lag bebyggelse")) return "bebyggelse_lag";
  if (type.includes("bebyggelse")) return "bebyggelse";
  return undefined;
}
export const buildingLayer = (feature: GpkgFeature): string | undefined => feature.geometry.kind === "area" ? "byggnad" : undefined;

/** GeoJSON (SWEREF 99 TM som i filen) med lagernamnet i `layer`, och antalet per lager. */
export function featuresGeoJson(features: readonly GpkgFeature[], layerOf: (feature: GpkgFeature) => string | undefined, keep: (layer: string, geometry: Geometry) => boolean = () => true) {
  const round = (value: number) => Math.round(value * 100) / 100, counts: Record<string, number> = {}, out: unknown[] = [];
  for (const feature of features) {
    const layer = layerOf(feature), geometry = feature.geometry;
    if (!layer || !keep(layer, geometry)) continue;
    counts[layer] = (counts[layer] ?? 0) + 1;
    const pair = ([x, y]: [number, number]) => [round(x), round(y)];
    out.push({ type: "Feature", properties: { layer }, geometry: geometry.kind === "point" ? { type: "Point", coordinates: pair(geometry.at) }
      : geometry.kind === "line" ? { type: "LineString", coordinates: geometry.points.map(pair) } : { type: "Polygon", coordinates: geometry.rings.map(ring => ring.map(pair)) } });
  }
  return { geojson: JSON.stringify({ type: "FeatureCollection", features: out }), counts, total: out.length };
}
