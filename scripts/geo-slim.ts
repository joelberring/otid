/**
 * Ägaren 2026-11-22 («de borde också förenklas lite så att de inte blir superstora»): Tivedens körning gav kurvor.dxf på
 * 41–56 MB och stup.dxf på 77 MB per etapp, och etapp 2:s stup.dxf var över serverns gräns och föll bort. Karttapullautin
 * skriver en punkt per meter med sexton decimaler. Här förenklas varje linje (Douglas–Peucker) och koordinaterna skrivs med
 * centimeter, innan filen skickas. Filens uppbyggnad (lager, höjd, POLYLINE/VERTEX) är densamma.
 *
 * Bara Nodes egna moduler (filen körs direkt av geo-arbetaren). Läser rad för rad, så att stora filer inte delas upp i
 * miljontals par samtidigt.
 */
import { simplify } from "./geo-moisture.ts";

/** Förenklingen (m): 0,2 m är 0,013 mm på en karta i 1:15 000 och 0,05 mm i 1:4 000, under vad någon ser eller ritar. */
export const SLIM_TOLERANCE_M = 0.2;

type Group = [string, string];
const cm = (value: string) => { const number = Number(value); return Number.isFinite(number) ? String(Math.round(number * 100) / 100) : value; };
const XY = new Set(["10", "20", "11", "21"]);

/** DXF-texten med förenklade linjer och koordinater i centimeter. Skannar rader med `indexOf("\n")` utan full-fil-split. */
export function slimDxf(text: string, tolerance = SLIM_TOLERANCE_M): string {
  const out: string[] = [], len = text.length;
  const put = (groups: readonly Group[]) => { for (const [code, value] of groups) out.push(code, value); };
  let pos = 0, done = false;
  const readLine = (): string | undefined => {
    if (done) return undefined;
    const nl = text.indexOf("\n", pos);
    if (nl < 0) {
      done = true;
      const end = len > pos && text.charCodeAt(len - 1) === 13 ? len - 1 : len;
      return text.slice(pos, end).trim();
    }
    const end = nl > pos && text.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
    const line = text.slice(pos, end).trim();
    pos = nl + 1;
    return line;
  };
  const next = (): Group | undefined => {
    const code = readLine();
    if (code === undefined) return undefined;
    const value = readLine();
    if (value === undefined) return undefined;
    return [code, value];
  };
  /** Ett objekt: gruppen «0 TYP» och allt fram till nästa «0». */
  let pending = next();
  const entity = (): Group[] | undefined => {
    if (!pending) return undefined;
    const groups: Group[] = [pending];
    for (pending = next(); pending && pending[0] !== "0"; pending = next()) groups.push(pending);
    return groups;
  };
  const rounded = (groups: Group[]) => groups.map(([code, value]): Group => XY.has(code) ? [code, cm(value)] : [code, value]);
  const at = (groups: readonly Group[], code: string) => Number(groups.find(group => group[0] === code)?.[1]);
  const simplified = (points: [number, number][], closed: boolean): number[] => {
    // Indexen som behålls; en sluten linje förenklas med första punkten upprepad och behåller minst tre punkter.
    const indexed = points.map(([x, y], index) => [x, y, index] as const);
    const kept = simplify((closed ? [...points, points[0]!] : points), tolerance);
    const keep: number[] = [];
    let k = 0;
    for (const [x, y] of kept) {
      while (k < indexed.length && (indexed[k]![0] !== x || indexed[k]![1] !== y)) k += 1;
      if (k < indexed.length) { keep.push(k); k += 1; }
    }
    if (closed && keep.length < 3) return points.map((_, index) => index);
    return keep;
  };
  for (let groups = entity(); groups; groups = entity()) {
    const type = groups[0]![1];
    if (type === "POLYLINE") {
      const vertices: Group[][] = [];
      while (pending && pending[0] === "0" && pending[1] === "VERTEX") vertices.push(entity()!);
      const seqend = pending && pending[0] === "0" && pending[1] === "SEQEND" ? entity()! : [["0", "SEQEND"] as Group];
      const points = vertices.map(vertex => [at(vertex, "10"), at(vertex, "20")] as [number, number]);
      const flags = at(groups, "70"), closed = Number.isFinite(flags) && (flags & 1) === 1;
      const usable = points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) && points.length > 2;
      put(groups);
      for (const index of usable ? simplified(points, closed) : points.map((_, index) => index)) put(rounded(vertices[index]!));
      put(seqend);
    } else if (type === "LWPOLYLINE") {
      const points: [number, number][] = [];
      for (let k = 0; k + 1 < groups.length; k += 1) if (groups[k]![0] === "10" && groups[k + 1]![0] === "20") points.push([Number(groups[k]![1]), Number(groups[k + 1]![1])]);
      const flags = at(groups, "70"), closed = Number.isFinite(flags) && (flags & 1) === 1;
      const usable = points.length > 2 && points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) && !groups.some(([code]) => code === "42" || code === "40" || code === "41");
      if (!usable) { put(rounded(groups)); continue; }
      const keep = simplified(points, closed);
      put(groups.filter(([code]) => !["10", "20", "90"].includes(code)));
      out.push("90", String(keep.length));
      for (const index of keep) out.push("10", cm(String(points[index]![0])), "20", cm(String(points[index]![1])));
    } else {
      put(type === "SECTION" || type === "EOF" ? groups : rounded(groups));
    }
  }
  return `${out.join("\n")}\n`;
}
