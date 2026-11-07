import { mapPointToProjected, type MapGeoreference, type MapObject, type ParsedMap, type Path, type Point } from "@o-tid/map-file";
import { objectRefKey, objectsByKey, type ObjectChange } from "./contract";

/**
 * ADR-0219 beslut 7: "Exportera ändringarna" som en liten egen fil, när skrivaren inte kan skriva en ny kartversion eller när
 * grundfilen har ändrats på annat håll sedan revideringen startade. Kartritaren lägger in ändringarna för hand.
 *
 * - **GeoJSON** (alla kartor): ett objekt per ändring med slag, symbolens nummer och namn; borttagna med grundfilens läge.
 *   Med georeferens i kartans koordinatsystem (`crs` när det är ett EPSG), annars kartans mm. Inga namn på dem som ändrade.
 * - **Mapper (.xmap)** när grundfilen är en Mapper-fil: grundfilens huvud (färger, symboler, georeferens) orört och bara de
 *   ändrade och nya objekten i delen "Ändrade och nya", de borttagna i "Borttagna (ta bort i kartan)". OCAD:s luckor i
 *   linjer följer inte med (Mapper har dem inte som OCAD).
 */
export interface ExportedChange {
  readonly change: ObjectChange["kind"];
  readonly object: MapObject;
}

/** Ändringarna med objektet som ska visas: det nya läget, eller grundfilens för en borttagning. */
export function exportedChanges(base: ParsedMap, changes: readonly ObjectChange[]): ExportedChange[] {
  const byKey = objectsByKey(base);
  return changes.flatMap((change): ExportedChange[] => {
    if (change.kind !== "DELETE") return [{ change: change.kind, object: change.object }];
    const object = byKey.get(objectRefKey(change.ref));
    return object ? [{ change: "DELETE" as const, object }] : [];
  });
}

const flat = (path: Path): number[][] => path.map(command => [command.x, command.y]);

export function changesGeoJson(base: ParsedMap, changes: readonly ObjectChange[], name = "kartrevidering"): object {
  const georeference: MapGeoreference | null = base.georeference;
  const at = (x: number, y: number): [number, number] => {
    if (!georeference) return [round(x, 3), round(y, 3)];
    const projected = mapPointToProjected(georeference, { x, y });
    return [round(projected.easting, 2), round(projected.northing, 2)];
  };
  const line = (path: Path) => flat(path).map(([x, y]) => at(x!, y!));
  const features = exportedChanges(base, changes).map(({ change, object }) => {
    const symbol = base.symbols.get(object.symbol);
    const properties = { change, symbol: symbol?.code.text ?? object.symbol, symbolName: symbol?.name ?? "",
      ...(object.kind === "text" ? { text: object.text } : {}) };
    const geometry = object.kind === "point" || object.kind === "text" ? { type: "Point", coordinates: at(object.at.x, object.at.y) }
      : object.kind === "line" ? { type: "MultiLineString", coordinates: splitParts(object.path).map(line) }
      : { type: "Polygon", coordinates: object.rings.map(ring => { const points = line(ring); return points.length ? [...points, points[0]!] : points; }) };
    return { type: "Feature", properties, geometry };
  });
  const crs = georeference?.crs.kind === "EPSG" ? { type: "name", properties: { name: `urn:ogc:def:crs:EPSG::${georeference.crs.code}` } } : undefined;
  return { type: "FeatureCollection", name, ...(crs ? { crs } : {}), ...(georeference ? {} : { units: "mm på kartan" }), features };
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

function splitParts(path: Path): Path[] {
  const parts: Path[] = [];
  let current: Path[number][] = [];
  for (const command of path) {
    if (command.type === "M" && current.length) { parts.push(current); current = []; }
    current.push(command);
  }
  if (current.length) parts.push(current);
  return parts;
}

// --- Mapper ---------------------------------------------------------------------------------------------------------

const CURVE_START = 1, CLOSE_POINT = 2, HOLE_POINT = 16, DASH_POINT = 32;
const mx = (x: number) => Math.round(x * 1000);
const my = (y: number) => Math.round(-y * 1000);
const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const radians = (degrees: number) => round(degrees * Math.PI / 180, 6);

/** Mappers koordinater för delarna: kurvans start flaggas, varje del slutar med hål-flaggan (utom den sista). */
function mapperCoords(parts: readonly Path[], closed: boolean): string[] {
  const out: { x: number; y: number; flags: number }[] = [];
  parts.forEach((part, partIndex) => {
    const start = out.length;
    for (const command of part) {
      if (command.type === "C") {
        out[out.length - 1]!.flags |= CURVE_START;
        out.push({ x: command.x1, y: command.y1, flags: 0 }, { x: command.x2, y: command.y2, flags: 0 });
      }
      out.push({ x: command.x, y: command.y, flags: command.corner ? DASH_POINT : 0 });
    }
    if (closed) {
      const first = out[start]!, last = out[out.length - 1]!;
      if (Math.abs(first.x - last.x) > 1e-9 || Math.abs(first.y - last.y) > 1e-9) out.push({ x: first.x, y: first.y, flags: 0 });
      out[out.length - 1]!.flags |= CLOSE_POINT;
    }
    if (partIndex < parts.length - 1) out[out.length - 1]!.flags |= HOLE_POINT;
  });
  return out.map(point => `${mx(point.x)} ${my(point.y)}${point.flags ? ` ${point.flags}` : ""};`);
}

export function mapperObject(object: MapObject): string {
  const symbol = xml(object.symbol);
  const one = (point: Point) => `<coords count="1">${mx(point.x)} ${my(point.y)};</coords>`;
  if (object.kind === "point") {
    return `<object type="0" symbol="${symbol}"${object.angle ? ` rotation="${radians(object.angle)}"` : ""}>${one(object.at)}</object>`;
  }
  if (object.kind === "text") {
    return `<object type="4" symbol="${symbol}"${object.angle ? ` rotation="${radians(object.angle)}"` : ""} h_align="1" v_align="1">${one(object.at)}` +
      `<text>${xml(object.text)}</text></object>`;
  }
  const coords = object.kind === "line" ? mapperCoords(splitParts(object.path), false) : mapperCoords(object.rings, true);
  const pattern = object.kind === "area" && object.angle ? `<pattern rotation="${radians(object.angle)}"><coord x="0" y="0"/></pattern>` : "";
  return `<object type="1" symbol="${symbol}"><coords count="${coords.length}">${coords.join("")}</coords>${pattern}</object>`;
}

/**
 * Mapper-filen med bara ändringarna. `baseText` är grundfilens text: allt utom objekten (`<parts>…</parts>`) behålls som det
 * är. Undefined om texten inte är en Mapper-fil med objekt.
 */
export function mapperChangesFile(baseText: string, base: ParsedMap, changes: readonly ObjectChange[]): string | undefined {
  const start = baseText.search(/<parts[\s>]/);
  const end = start < 0 ? -1 : baseText.indexOf("</parts>", start);
  if (start < 0 || end < 0) return undefined;
  const exported = exportedChanges(base, changes);
  const part = (name: string, rows: readonly ExportedChange[]) =>
    `<part name="${xml(name)}"><objects count="${rows.length}">\n${rows.map(row => mapperObject(row.object)).join("\n")}\n</objects></part>`;
  const kept = exported.filter(row => row.change !== "DELETE"), deleted = exported.filter(row => row.change === "DELETE");
  const parts = `<parts count="2" current="0">\n${part("Ändrade och nya", kept)}\n${part("Borttagna (ta bort i kartan)", deleted)}\n</parts>`;
  return baseText.slice(0, start) + parts + baseText.slice(end + "</parts>".length);
}
