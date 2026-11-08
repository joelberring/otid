import { flattenPath, type MapObject, type Point } from "@o-tid/map-file";
import { pointInPolygon, type AreaPolygon } from "./areas";
import type { ObjectKey } from "./state";

/**
 * ADR-0219 tillägget om rekningen (K3): vad som är rekat. Varje objekt i kartan har en rekningsstatus som räknas här ur
 * GPS-spåren och de bekräftade objekten:
 *
 * - `UNSEEN` (ej rekat): ingen har varit nära och ingen har bekräftat objektet;
 * - `PASSED` (passerat): ett spår har varit inom siktavståndet (punkter), längs en del av linjen (`lineShare`) eller över en
 *   del av ytan (`areaShare`). Att ha gått förbi är inte att ha sett objektet, så statusen är märkt automatisk;
 * - `CHECKED` (kollat): en person har bekräftat objektet och det har inte ändrats sedan (sidan avgör det, `checked`).
 *
 * Siktavståndet ställs per symbolgrupp (meter i terrängen) och krymps i tät vegetation (406–411 på kartan där punkten
 * ligger). GPS-felet räknas med: halva den rapporterade noggrannheten (högst 5 m) läggs till. En lucka i spåret längre än
 * `MAX_SEGMENT_M` (tappad signal) räknas inte som gången. Tekniska symboler, banpåtryck och texter har ingen status.
 */
export type ReconGroup = "LANDFORMS" | "ROCK" | "STONES" | "WATER" | "VEGETATION" | "MANMADE";
export const RECON_GROUPS: readonly ReconGroup[] = ["LANDFORMS", "ROCK", "STONES", "WATER", "VEGETATION", "MANMADE"];
export type ReconStatus = "UNSEEN" | "PASSED" | "CHECKED";

export interface ReconSettings {
  /** Siktavståndet per grupp i meter. */
  readonly sightM: Readonly<Record<ReconGroup, number>>;
  /** Andelen av en linje som ska ha varit inom siktavståndet (0–1). */
  readonly lineShare: number;
  /** Andelen av en yta som ska ha varit inom siktavståndet (0–1). */
  readonly areaShare: number;
  /** Täckningslagrets avstånd i meter (spåret med det runt sig). */
  readonly coverM: number;
}

export const DEFAULT_RECON: ReconSettings = {
  sightM: { LANDFORMS: 25, ROCK: 25, STONES: 15, WATER: 20, VEGETATION: 20, MANMADE: 25 }, lineShare: 0.8, areaShare: 0.5, coverM: 20
};
/** Gränserna för inställningarna (servern och formuläret). */
export const RECON_LIMITS = { sightM: { min: 2, max: 200 }, share: { min: 0.1, max: 1 }, coverM: { min: 2, max: 200 } } as const;
/** En lucka längre än så (meter) i spåret är tappad signal, inte en sträcka man gått. */
export const MAX_SEGMENT_M = 150;
const MAX_SLACK_M = 5;
const MAX_SAMPLES = 400;

/** Inställningarna är giltiga: ger felet som text, eller undefined. */
export function reconSettingsProblem(value: unknown): string | undefined {
  const settings = value as Partial<ReconSettings> | null;
  if (!settings || typeof settings !== "object") return "settings";
  const between = (number: unknown, range: { min: number; max: number }) => typeof number === "number" && Number.isFinite(number)
    && number >= range.min && number <= range.max;
  if (!settings.sightM || typeof settings.sightM !== "object" || Object.keys(settings.sightM).length !== RECON_GROUPS.length) return "sightM";
  for (const group of RECON_GROUPS) if (!between(settings.sightM[group], RECON_LIMITS.sightM)) return "sightM";
  if (!between(settings.lineShare, RECON_LIMITS.share) || !between(settings.areaShare, RECON_LIMITS.share)) return "share";
  if (!between(settings.coverM, RECON_LIMITS.coverM)) return "coverM";
  return Object.keys(settings).length === 4 ? undefined : "settings";
}

/** Symbolens huvudnummer ur koden ("204", "204.1", "520.1"), annars undefined. */
export function symbolMain(code: string): number | undefined {
  const match = /^\s*(\d{3})(?:\D|$)/.exec(code);
  return match ? Number(match[1]) : undefined;
}

/** Rekningsgruppen efter ISOM/ISSprOM-numret; null för tekniska symboler, banpåtryck och okända. Stenar (204–210) för sig. */
export function reconGroup(code: string): ReconGroup | null {
  const main = symbolMain(code);
  if (main === undefined) return null;
  if (main >= 100 && main < 200) return "LANDFORMS";
  if (main >= 204 && main <= 210) return "STONES";
  if (main >= 200 && main < 300) return "ROCK";
  if (main >= 300 && main < 400) return "WATER";
  if (main >= 400 && main < 500) return "VEGETATION";
  if (main >= 500 && main < 600) return "MANMADE";
  return null;
}

/** Siktavståndets faktor i en vegetationsyta: löpbar men långsam (406, 407) 0,75, svår (408, 409) 0,5, mycket svår (410, 411) 0,35. */
export function vegetationFactor(code: string): number | undefined {
  const main = symbolMain(code);
  if (main === 406 || main === 407) return 0.75;
  if (main === 408 || main === 409) return 0.5;
  if (main === 410 || main === 411) return 0.35;
  return undefined;
}

/** En spårpunkt i kartans mm (y uppåt) med noggrannheten i meter. */
export interface TrackPoint { readonly x: number; readonly y: number; readonly accuracyM: number }

/** Ett objekt att bedöma: nyckeln, symbolens kod och objektet. */
export interface ReconObject { readonly key: ObjectKey; readonly code: string; readonly object: MapObject }

/** Objektets markör på kartan: status och var den ritas. */
export interface ReconMarker { readonly key: ObjectKey; readonly status: ReconStatus; readonly at: Point; readonly group: ReconGroup }

interface Segment { readonly a: Point; readonly b: Point; readonly slackMm: number }

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Meter i terrängen till mm på kartan. */
export const metersToMm = (meters: number, scale: number) => meters * 1000 / scale;

/** Spårens sträckor (utan luckor) i ett rutnät för sökningen. */
class SegmentIndex {
  private readonly cells = new Map<string, Segment[]>();
  constructor(private readonly cell: number) {}
  static build(tracks: readonly (readonly TrackPoint[])[], scale: number, cell: number): SegmentIndex {
    const index = new SegmentIndex(cell);
    const gap = metersToMm(MAX_SEGMENT_M, scale);
    for (const track of tracks) {
      for (let i = 0; i < track.length; i += 1) {
        const a = track[i]!, b = track[i + 1] ?? (track.length === 1 ? a : undefined);
        if (!b) continue;
        if (Math.hypot(b.x - a.x, b.y - a.y) > gap) continue;
        const slackMm = metersToMm(Math.min(MAX_SLACK_M, Math.max(a.accuracyM, b.accuracyM) / 2), scale);
        index.add({ a, b, slackMm });
      }
    }
    return index;
  }
  private add(segment: Segment) {
    const x0 = Math.floor(Math.min(segment.a.x, segment.b.x) / this.cell), x1 = Math.floor(Math.max(segment.a.x, segment.b.x) / this.cell);
    const y0 = Math.floor(Math.min(segment.a.y, segment.b.y) / this.cell), y1 = Math.floor(Math.max(segment.a.y, segment.b.y) / this.cell);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) {
      const key = `${x},${y}`;
      const list = this.cells.get(key);
      if (list) list.push(segment); else this.cells.set(key, [segment]);
    }
  }
  get empty() { return this.cells.size === 0; }
  /** Ligger punkten inom `radiusMm` (plus sträckans GPS-tillägg) från något spår? Radien får inte vara större än rutan. */
  near(point: Point, radiusMm: number): boolean {
    const cx = Math.floor(point.x / this.cell), cy = Math.floor(point.y / this.cell);
    for (let x = cx - 1; x <= cx + 1; x += 1) for (let y = cy - 1; y <= cy + 1; y += 1) {
      for (const segment of this.cells.get(`${x},${y}`) ?? []) {
        if (segmentDistance(point, segment.a, segment.b) <= radiusMm + segment.slackMm) return true;
      }
    }
    return false;
  }
}

/** Täta vegetationsytor: faktorn för siktavståndet där en punkt ligger (den minsta om ytor överlappar). */
class DensityIndex {
  private readonly areas: { box: { minX: number; minY: number; maxX: number; maxY: number }; polygon: AreaPolygon; factor: number }[] = [];
  constructor(objects: readonly ReconObject[]) {
    for (const { code, object } of objects) {
      if (object.kind !== "area") continue;
      const factor = vegetationFactor(code);
      if (factor === undefined) continue;
      const polygon = object.rings.flatMap(ring => flattenPath(ring));
      const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const point of polygon[0] ?? []) {
        box.minX = Math.min(box.minX, point.x); box.maxX = Math.max(box.maxX, point.x);
        box.minY = Math.min(box.minY, point.y); box.maxY = Math.max(box.maxY, point.y);
      }
      this.areas.push({ box, polygon, factor });
    }
  }
  factorAt(point: Point): number {
    let factor = 1;
    for (const area of this.areas) {
      if (area.factor >= factor) continue;
      const box = area.box;
      if (point.x < box.minX || point.x > box.maxX || point.y < box.minY || point.y > box.maxY) continue;
      if (pointInPolygon(point, area.polygon)) factor = area.factor;
    }
    return factor;
  }
}

/** Punkter längs en linje med högst `step` mellan (brytpunkterna och mellan dem), högst MAX_SAMPLES. */
function alongLine(line: readonly Point[], step: number): Point[] {
  let length = 0;
  for (let i = 1; i < line.length; i += 1) length += Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y);
  const spacing = Math.max(step, length / MAX_SAMPLES);
  const out: Point[] = line.length > 0 ? [line[0]!] : [];
  let carry = 0;
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]!, b = line[i]!;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    let at = spacing - carry;
    while (at < d) { out.push({ x: a.x + (b.x - a.x) * at / d, y: a.y + (b.y - a.y) * at / d }); at += spacing; }
    carry = d - (at - spacing);
  }
  if (line.length > 1) out.push(line[line.length - 1]!);
  return out.slice(0, MAX_SAMPLES + 2);
}

/** Punkter i ett rutnät inne i ytan (högst ungefär MAX_SAMPLES); en liten yta får sina hörn. */
function insideArea(rings: readonly (readonly Point[])[], step: number): Point[] {
  const outer = rings[0] ?? [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of outer) { minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y); }
  if (!Number.isFinite(minX)) return [];
  const spacing = Math.max(step, Math.sqrt(((maxX - minX) * (maxY - minY)) / MAX_SAMPLES));
  const out: Point[] = [];
  for (let x = minX + spacing / 2; x < maxX; x += spacing) for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    if (pointInPolygon({ x, y }, rings)) out.push({ x, y });
  }
  return out.length > 0 ? out : outer.slice(0, MAX_SAMPLES);
}

/** Objektets provpunkter och var markören står. */
function samplesOf(object: MapObject, step: number): { samples: Point[]; at: Point } | undefined {
  if (object.kind === "point" || object.kind === "text") return { samples: [object.at], at: object.at };
  if (object.kind === "line") {
    const lines = flattenPath(object.path);
    const samples = lines.flatMap(line => alongLine(line, step));
    const at = samples[Math.floor(samples.length / 2)];
    return at ? { samples, at } : undefined;
  }
  const rings = object.rings.flatMap(ring => flattenPath(ring));
  const samples = insideArea(rings, step);
  if (samples.length === 0) return undefined;
  const at = samples.reduce((sum, point) => ({ x: sum.x + point.x / samples.length, y: sum.y + point.y / samples.length }), { x: 0, y: 0 });
  return { samples, at: pointInPolygon(at, rings) ? at : samples[Math.floor(samples.length / 2)]! };
}

/**
 * Status och markör för alla objekt med en rekningsgrupp. `checked` är de objekt som är bekräftade och inte ändrade sedan;
 * `scale` är kartans skala (1:`scale`).
 */
export function reconMarkers(objects: readonly ReconObject[], tracks: readonly (readonly TrackPoint[])[], checked: ReadonlySet<ObjectKey>,
  settings: ReconSettings, scale: number): ReconMarker[] {
  const maxSight = Math.max(...RECON_GROUPS.map(group => settings.sightM[group]));
  const cell = metersToMm(maxSight + MAX_SLACK_M, scale);
  const segments = SegmentIndex.build(tracks, scale, cell);
  const density = segments.empty ? undefined : new DensityIndex(objects);
  const out: ReconMarker[] = [];
  for (const { key, code, object } of objects) {
    if (object.kind === "text") continue;
    const group = reconGroup(code);
    if (!group) continue;
    const sight = metersToMm(settings.sightM[group], scale);
    const sampled = samplesOf(object, sight / 2);
    if (!sampled) continue;
    let status: ReconStatus = "UNSEEN";
    if (checked.has(key)) status = "CHECKED";
    else if (density) {
      const seen = (point: Point) => segments.near(point, sight * density.factorAt(point));
      if (object.kind === "point") status = seen(object.at) ? "PASSED" : "UNSEEN";
      else {
        const share = object.kind === "line" ? settings.lineShare : settings.areaShare;
        const needed = Math.ceil(sampled.samples.length * share - 1e-9);
        let hits = 0, left = sampled.samples.length;
        for (const sample of sampled.samples) {
          if (seen(sample)) hits += 1;
          left -= 1;
          if (hits >= needed || hits + left < needed) break;
        }
        status = hits >= needed ? "PASSED" : "UNSEEN";
      }
    }
    out.push({ key, status, at: sampled.at, group });
  }
  return out;
}

/** Täckningen: ett rutnät över `bounds` där en ruta är täckt när dess mitt ligger inom `coverM` från ett spår. */
export interface Coverage {
  readonly origin: Point;
  /** Rutans sida i kartans mm. */
  readonly cellMm: number;
  readonly columns: number;
  readonly rows: number;
  /** 1 = täckt; rad för rad nerifrån (y uppåt). */
  readonly cells: Uint8Array;
}

/** Så många rutor får täckningen ha (rutan görs större för stora kartor). */
export const MAX_COVERAGE_CELLS = 1_000_000;

export function coverageGrid(tracks: readonly (readonly TrackPoint[])[], bounds: { minX: number; minY: number; maxX: number; maxY: number },
  settings: Pick<ReconSettings, "coverM">, scale: number, cellM = 5): Coverage {
  const width = Math.max(0, bounds.maxX - bounds.minX), height = Math.max(0, bounds.maxY - bounds.minY);
  let cellMm = metersToMm(cellM, scale);
  if ((width / cellMm) * (height / cellMm) > MAX_COVERAGE_CELLS) cellMm = Math.sqrt((width * height) / MAX_COVERAGE_CELLS);
  const columns = Math.max(1, Math.ceil(width / cellMm)), rows = Math.max(1, Math.ceil(height / cellMm));
  const cells = new Uint8Array(columns * rows);
  const radius = metersToMm(settings.coverM, scale);
  const gap = metersToMm(MAX_SEGMENT_M, scale);
  const mark = (a: Point, b: Point) => {
    const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - radius - bounds.minX) / cellMm));
    const c1 = Math.min(columns - 1, Math.floor((Math.max(a.x, b.x) + radius - bounds.minX) / cellMm));
    const r0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - radius - bounds.minY) / cellMm));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(a.y, b.y) + radius - bounds.minY) / cellMm));
    for (let r = r0; r <= r1; r += 1) for (let c = c0; c <= c1; c += 1) {
      const index = r * columns + c;
      if (cells[index]) continue;
      const center = { x: bounds.minX + (c + 0.5) * cellMm, y: bounds.minY + (r + 0.5) * cellMm };
      if (segmentDistance(center, a, b) <= radius) cells[index] = 1;
    }
  };
  for (const track of tracks) {
    if (track.length === 1) mark(track[0]!, track[0]!);
    for (let i = 1; i < track.length; i += 1) {
      const a = track[i - 1]!, b = track[i]!;
      if (Math.hypot(b.x - a.x, b.y - a.y) <= gap) mark(a, b);
    }
  }
  return { origin: { x: bounds.minX, y: bounds.minY }, cellMm, columns, rows, cells };
}

/** Ett delområdes framsteg: täckt andel av ytan, och andelen objekt som passerats eller kollats och som kollats. */
export interface AreaProgress { readonly coveredShare: number; readonly objects: number; readonly seenShare: number; readonly checkedShare: number }

export function areaProgress(polygon: AreaPolygon, coverage: Coverage | undefined, markers: readonly ReconMarker[]): AreaProgress {
  let inside = 0, covered = 0;
  if (coverage) {
    for (let r = 0; r < coverage.rows; r += 1) for (let c = 0; c < coverage.columns; c += 1) {
      const center = { x: coverage.origin.x + (c + 0.5) * coverage.cellMm, y: coverage.origin.y + (r + 0.5) * coverage.cellMm };
      if (!pointInPolygon(center, polygon)) continue;
      inside += 1;
      if (coverage.cells[r * coverage.columns + c]) covered += 1;
    }
  }
  let objects = 0, seen = 0, checkedCount = 0;
  for (const marker of markers) {
    if (!pointInPolygon(marker.at, polygon)) continue;
    objects += 1;
    if (marker.status !== "UNSEEN") seen += 1;
    if (marker.status === "CHECKED") checkedCount += 1;
  }
  return { coveredShare: inside > 0 ? covered / inside : 0, objects, seenShare: objects > 0 ? seen / objects : 0,
    checkedShare: objects > 0 ? checkedCount / objects : 0 };
}

/**
 * Är bekräftelsen fortfarande giltig? Den gjordes på objektets dåvarande senaste ändring (`basis`; null = grundfilens objekt)
 * och gäller så länge objektet inte ändrats sedan, på servern eller i klientens kö.
 */
export function checkStillValid(basis: string | null, serverLastEditId: string | null, pendingLocally: boolean): boolean {
  return !pendingLocally && basis === serverLastEditId;
}
