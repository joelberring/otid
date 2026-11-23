import { nestRings } from "./ring-nesting";

/**
 * ADR-0219 K6b-tillägget 2026-11-23 (ägaren: «hus kommer fel» i Stockholms baskarta som DXF): bågar, buktiga polylinjer och
 * HATCH-ytor i DXF. Stadens byggnader och sjöar är HATCH (en fyllning med gränsvägar), inte slutna polylinjer, och lästes inte
 * alls. Bågarna plattas ut till punkter med högst 10° per steg.
 */
type Position = readonly [number, number];
type DxfPairs = readonly (readonly [number, string])[];

const STEP = Math.PI / 18;
const DEG = Math.PI / 180;

/** Punkterna på en cirkelbåge från vinkeln `start` med svepet `sweep` (radianer, positivt moturs), båda ändarna med. */
function arcPoints(cx: number, cy: number, radius: number, start: number, sweep: number): Position[] {
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / STEP));
  const points: Position[] = [];
  for (let at = 0; at <= steps; at += 1) {
    const angle = start + sweep * at / steps;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

/** Svepet (grader) från `start` till `end` moturs; lika vinklar på olika varv är en hel cirkel. */
const sweepOf = (start: number, end: number) => {
  const sweep = ((end - start) % 360 + 360) % 360;
  return sweep === 0 && end !== start ? 360 : sweep;
};

/** ARC: medelpunkt, radie och vinklarna i grader (alltid moturs). */
export function arcEntity(body: DxfPairs): Position[] | undefined {
  const value = (code: number) => { const found = body.find(([at]) => at === code); return found ? Number(found[1]) : undefined; };
  const cx = value(10), cy = value(20), radius = value(40), start = value(50) ?? 0, end = value(51) ?? 360;
  if (cx === undefined || cy === undefined || !radius || ![cx, cy, radius, start, end].every(Number.isFinite)) return undefined;
  return arcPoints(cx, cy, radius, start * DEG, sweepOf(start, end) * DEG);
}

/**
 * Hörnen med buktighet (DXF:s bulge, tan av en fjärdedel av bågens vinkel, positiv moturs) som punkter: varje buktig sträcka
 * blir en utplattad båge. `closed`: sträckan från sista hörnet tillbaka till det första räknas också.
 */
export function bulgedPoints(vertices: readonly { readonly at: Position; readonly bulge: number }[], closed: boolean): Position[] {
  if (!vertices.some(vertex => vertex.bulge !== 0)) return vertices.map(vertex => vertex.at);
  const points: Position[] = [];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let index = 0; index < count; index += 1) {
    const { at: a, bulge } = vertices[index]!, b = vertices[(index + 1) % vertices.length]!.at;
    points.push(a);
    const dx = b[0] - a[0], dy = b[1] - a[1], chord = Math.hypot(dx, dy);
    if (bulge === 0 || chord === 0 || !Number.isFinite(bulge)) continue;
    // Medelpunkten ligger på kordans mittnormal, h från mitten (till vänster om a→b när bågen går moturs).
    const h = chord * (1 - bulge * bulge) / (4 * bulge);
    const cx = (a[0] + b[0]) / 2 - h * dy / chord, cy = (a[1] + b[1]) / 2 + h * dx / chord;
    const arc = arcPoints(cx, cy, Math.hypot(a[0] - cx, a[1] - cy), Math.atan2(a[1] - cy, a[0] - cx), 4 * Math.atan(bulge));
    points.push(...arc.slice(1, -1));
  }
  if (!closed) points.push(vertices[vertices.length - 1]!.at);
  return points;
}

/** En läsare över parens koder i tur och ordning (HATCH:s gränsvägar har en bestämd ordning, och 10/20 betyder olika saker). */
class Reader {
  at = 0;
  constructor(readonly pairs: DxfPairs) {}
  peek(): number | undefined { return this.pairs[this.at]?.[0]; }
  /** Värdet för koden om den kommer härnäst (och flytta förbi den), annars inget. */
  take(code: number): number | undefined {
    const pair = this.pairs[this.at];
    if (!pair || pair[0] !== code) return undefined;
    this.at += 1;
    return Number(pair[1]);
  }
  point(xCode: number, yCode: number): Position | undefined {
    const x = this.take(xCode), y = this.take(yCode);
    return x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
  }
}

/** En polylinjeväg (vägtyp med bit 2): 72 buktighet, 73 sluten, 93 antal hörn och hörnen 10/20 (42). */
function polylinePath(read: Reader): Position[] {
  const hasBulge = read.take(72) === 1;
  read.take(73);
  const count = read.take(93) ?? 0;
  const vertices: { at: Position; bulge: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = read.point(10, 20);
    const bulge = hasBulge ? read.take(42) ?? 0 : 0;
    if (at) vertices.push({ at, bulge });
    else break;
  }
  return bulgedPoints(vertices, true);
}

/** Bågens punkter för en kantväg (cirkelbåge eller ellipsbåge); medurs bågar har vinklarna som 360 − vinkeln. */
function edgeArc(start: number, end: number, ccw: boolean, at: (angle: number) => Position): Position[] {
  const sweep = sweepOf(start, end) * DEG;
  const from = ccw ? start * DEG : -start * DEG;
  const steps = Math.max(1, Math.ceil(sweep / STEP));
  const points: Position[] = [];
  for (let step = 0; step <= steps; step += 1) points.push(at(from + (ccw ? 1 : -1) * sweep * step / steps));
  return points;
}

/** En kantväg: 93 antal kanter och kanterna efter typ (1 linje, 2 cirkelbåge, 3 ellipsbåge, 4 spline). */
function edgePath(read: Reader): Position[] {
  const count = read.take(93) ?? 0;
  const points: Position[] = [];
  const add = (part: readonly Position[]) => {
    for (const point of part) {
      const last = points[points.length - 1];
      if (!last || Math.hypot(last[0] - point[0], last[1] - point[1]) > 1e-9) points.push(point);
    }
  };
  for (let index = 0; index < count; index += 1) {
    const type = read.take(72);
    if (type === 1) {
      const a = read.point(10, 20), b = read.point(11, 21);
      if (a && b) add([a, b]);
    } else if (type === 2) {
      const center = read.point(10, 20), radius = read.take(40) ?? 0, start = read.take(50) ?? 0, end = read.take(51) ?? 360;
      const ccw = (read.take(73) ?? 1) !== 0;
      if (center && radius > 0) add(edgeArc(start, end, ccw, angle => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)]));
    } else if (type === 3) {
      const center = read.point(10, 20), major = read.point(11, 21), ratio = read.take(40) ?? 1, start = read.take(50) ?? 0, end = read.take(51) ?? 360;
      const ccw = (read.take(73) ?? 1) !== 0;
      if (center && major) add(edgeArc(start, end, ccw, angle => [
        center[0] + major[0] * Math.cos(angle) - major[1] * ratio * Math.sin(angle),
        center[1] + major[1] * Math.cos(angle) + major[0] * ratio * Math.sin(angle)]));
    } else if (type === 4) add(splineEdge(read));
    else break;
  }
  return points;
}

/** Splinekant: grad, flaggor, knutar, styrpunkter och (R2010+) anpassningspunkter; som SPLINE blir den anpassningspunkterna, annars styrpunkterna. */
function splineEdge(read: Reader): Position[] {
  read.take(94);
  const rational = read.take(73) === 1;
  read.take(74);
  const knots = read.take(95) ?? 0, controls = read.take(96) ?? 0;
  for (let index = 0; index < knots && read.peek() === 40; index += 1) read.take(40);
  const control: Position[] = [];
  for (let index = 0; index < controls; index += 1) {
    const at = read.point(10, 20);
    if (rational) read.take(42);
    if (at) control.push(at); else break;
  }
  const fit: Position[] = [];
  // 97 är antalet anpassningspunkter bara om punkterna följer (eller ett nytt 97, vägens källobjekt); annars är det vägens 97.
  const next = read.pairs[read.at + 1]?.[0];
  if (read.peek() === 97 && (next === 11 || next === 97 || next === 12)) {
    const count = read.take(97) ?? 0;
    for (let index = 0; index < count; index += 1) { const at = read.point(11, 21); if (at) fit.push(at); else break; }
    read.point(12, 22); read.point(13, 23);
  }
  return fit.length >= 2 ? fit : control;
}

/**
 * HATCH: gränsvägarna (91 antal, för varje väg 92 vägtyp, sedan polylinje eller kanter och 97 källobjekt med 330) som ytor.
 * Vägarna läggs i varandra som fyllningens udda-jämna regel: en väg inuti en annan är ett hål, en väg inuti ett hål en egen
 * yta. Flaggorna för yttre väg (1, 16) behövs därför inte (Stockholms baskarta sätter dem inte). Ger ringarna per yta, tomt
 * om ingen väg har minst tre punkter.
 */
export function hatchAreas(body: DxfPairs): Position[][][] {
  const start = body.findIndex(([code]) => code === 91);
  if (start < 0) return [];
  const read = new Reader(body);
  read.at = start;
  const paths = read.take(91) ?? 0;
  const rings: Position[][] = [];
  for (let index = 0; index < paths; index += 1) {
    const type = read.take(92);
    if (type === undefined) break;
    const ring = (type & 2) === 2 ? polylinePath(read) : edgePath(read);
    const sources = read.take(97) ?? 0;
    for (let source = 0; source < sources && read.peek() === 330; source += 1) read.at += 1;
    const first = ring[0], last = ring[ring.length - 1];
    const open = first && last && ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
    if (open.length >= 3) rings.push(open);
  }
  if (rings.length <= 1) return rings.length ? [rings] : [];
  return nestRings(rings.map(ring => ring.map(([x, y]) => ({ x, y })))).map(area => area.map(ring => ring.map(({ x, y }) => [x, y] as const)));
}
