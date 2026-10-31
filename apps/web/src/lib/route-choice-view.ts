import type { AdminRouteChoice, ControlMapResponse, RouteChoiceCalibrationRoutes } from "@o-tid/contracts";
import type { Point } from "@o-tid/map-file";
import type { LegAnalysis, LegInput, LegWarning } from "@o-tid/route-choice";
import { routeChoiceSv as text } from "../i18n/route-choice-sv";
import type { CalibrationSample } from "./route-choice-worker-protocol";

/**
 * Steg 60 (ADR-0179): vägvalsanalysens vy utan React. Banor och varianter att välja, sträckorna som indata till motorn
 * (kartfilens mm), tabellens rader och texter, summan för banan, varningarna i klartext, linjer och stråk som kartbildens
 * pixlar och förenklingen av de linjer som publiceras.
 */
export type Render = NonNullable<AdminRouteChoice["mapFile"]>["render"];

export interface RouteChoiceOption {
  /** "courseId" eller "courseId:variant". */
  readonly id: string;
  readonly courseId: string;
  readonly variantCode: string | null;
  readonly label: string;
  readonly controlCodes: readonly number[];
}

/** Banor och varianter i kontrollkartans ordning; en gafflad bana ger en rad per variant. */
export function routeChoiceOptions(courses: ControlMapResponse["courses"]): RouteChoiceOption[] {
  return courses.flatMap(course => course.variants.map(variant => ({
    id: variant.code ? `${course.courseId}:${variant.code}` : course.courseId, courseId: course.courseId, variantCode: variant.code,
    label: text.courseOption(course.name, variant.code), controlCodes: variant.controlCodes })));
}

/** Sträckornas nycklar som i sträcktidstabellen: S-31.1, 31.1-32.1 … 36.1-F. */
export function legKeys(controlCodes: readonly number[]): string[] {
  const seen = new Map<number, number>();
  const points = ["S", ...controlCodes.map(code => { const count = (seen.get(code) ?? 0) + 1; seen.set(code, count); return `${code}.${count}`; }), "F"];
  return points.slice(1).map((to, index) => `${points[index]}-${to}`);
}

export interface PlannedLeg {
  readonly key: string;
  /** Saknas när en ände saknar läge på kartfilen (sträckan räknas inte). */
  readonly input?: LegInput | undefined;
}

/** Sträckorna för en bana eller variant med lägena i kartfilens mm och banans övriga kontroller (för ringvarningen). */
export function plannedLegs(option: RouteChoiceOption, state: AdminRouteChoice): PlannedLeg[] {
  const at = new Map(state.controls.flatMap(control => control.at ? [[control.code, control.at] as const] : []));
  const ends = state.courses.find(course => course.courseId === option.courseId);
  const points: (Point | null)[] = [ends?.start ?? null, ...option.controlCodes.map(code => at.get(code) ?? null), ends?.finish ?? null];
  const codes: (number | null)[] = [null, ...option.controlCodes, null];
  return legKeys(option.controlCodes).map((key, index) => {
    const from = points[index], to = points[index + 1];
    if (!from || !to) return { key };
    const ends = new Set([codes[index], codes[index + 1]]);
    const otherControls = [...new Set(option.controlCodes)].filter(code => !ends.has(code) && at.has(code))
      .map(code => ({ code: String(code), at: at.get(code)! }));
    return { key, input: { key, from, to, otherControls } };
  });
}

export const legName = (key: string) => { const [from = "", to = ""] = key.split("-"); return text.legName(from, to); };

export interface LegRow {
  readonly key: string;
  readonly name: string;
  readonly straight: string;
  readonly best: string;
  readonly climb: string;
  readonly time: string;
  readonly choices: string;
  readonly verdict: string;
  readonly verdictKind: LegAnalysis["verdict"] | "PENDING" | "NO_ROUTE" | "NO_PLACE";
}

const minutes = (seconds: number) => {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** En rad per sträcka: fågelväg, bästa väg, stigning, uppskattad tid, antal vägval och bedömningen. */
export function legRows(legs: readonly PlannedLeg[], analyses: ReadonlyMap<string, LegAnalysis>): LegRow[] {
  return legs.map(leg => {
    const name = legName(leg.key), analysis = analyses.get(leg.key);
    const empty = { key: leg.key, name, straight: "–", best: "–", climb: "–", time: "–", choices: "–" };
    if (!leg.input) return { ...empty, verdict: text.noPlaces, verdictKind: "NO_PLACE" };
    if (!analysis) return { ...empty, straight: text.meters(Math.hypot(leg.input.to.x - leg.input.from.x, leg.input.to.y - leg.input.from.y)),
      verdict: text.pending, verdictKind: "PENDING" };
    const straight = text.meters(analysis.straightMeters);
    if (!analysis.best) return { ...empty, straight, verdict: text.noRoute, verdictKind: "NO_ROUTE" };
    return { key: leg.key, name, straight, best: text.meters(analysis.best.meters), climb: text.climb(analysis.best.climbMeters),
      time: minutes(analysis.best.seconds), choices: text.choices(1 + analysis.alternatives.length),
      verdict: text.verdicts[analysis.verdict], verdictKind: analysis.verdict };
  });
}

/** Summan för banan: bästa vägens längd mot fågelvägen, när alla sträckor har en väg. */
export function courseTotal(legs: readonly PlannedLeg[], analyses: ReadonlyMap<string, LegAnalysis>): string | undefined {
  let best = 0, straight = 0;
  for (const leg of legs) {
    const analysis = analyses.get(leg.key);
    if (!analysis?.best) return undefined;
    best += analysis.best.meters; straight += analysis.straightMeters;
  }
  return legs.length > 0 ? text.total(best, straight) : undefined;
}

/** Varningen i klartext. Ändarna är sträckans från- och till-punkt ("31.1" → kontroll 31). */
export function warningText(key: string, warning: LegWarning): string {
  const [from = "", to = ""] = key.split("-");
  const end = (value: string) => value === "S" || value === "F" ? value : value.split(".")[0]!;
  switch (warning.kind) {
    case "THROUGH_OTHER_CONTROL": return text.warnings.THROUGH_OTHER_CONTROL(warning.code);
    case "CONTROL_IN_IMPASSABLE": return text.warnings.CONTROL_IN_IMPASSABLE(end(warning.end === "from" ? from : to));
    case "NO_ROUTE": return text.warnings.NO_ROUTE(from, to);
  }
}

/** Alla varningar för banan, i sträckornas ordning, utan dubbletter (en kontroll i ej passerbar mark nämns en gång). */
export function courseWarnings(legs: readonly PlannedLeg[], analyses: ReadonlyMap<string, LegAnalysis>): { key: string; text: string }[] {
  const seen = new Set<string>();
  return legs.flatMap(leg => (analyses.get(leg.key)?.warnings ?? []).flatMap(warning => {
    const message = warningText(leg.key, warning);
    if (seen.has(message)) return [];
    seen.add(message);
    return [{ key: leg.key, text: message }];
  }));
}

/** Kartfilens mm (y uppåt) → kartbildens pixlar (y nedåt). */
export function mmToPixel(render: Render, point: Point): { x: number; y: number } {
  return { x: Math.round((point.x - render.originX) * render.pxPerMm * 10) / 10, y: Math.round((render.originY - point.y) * render.pxPerMm * 10) / 10 };
}

export const polyline = (render: Render, points: readonly Point[]) =>
  points.map(point => { const pixel = mmToPixel(render, point); return `${pixel.x},${pixel.y}`; }).join(" ");

/**
 * Stråket som en SVG-väg i kartbildens pixlar: varje rad i rutnätet blir rektanglar för sammanhängande celler i stråket.
 * Rutnätets `origin` är det nedre vänstra hörnet i mm; första raden ligger överst.
 */
export function corridorPath(render: Render, corridor: NonNullable<LegAnalysis["corridor"]>): string {
  const { origin, cellMm, width, height, mask } = corridor;
  const scale = render.pxPerMm, cell = cellMm * scale;
  const round = (value: number) => Math.round(value * 10) / 10;
  const parts: string[] = [];
  for (let row = 0; row < height; row += 1) {
    const top = (render.originY - (origin.y + (height - row) * cellMm)) * scale;
    let column = 0;
    while (column < width) {
      if (mask[row * width + column] !== 1) { column += 1; continue; }
      const start = column;
      while (column < width && mask[row * width + column] === 1) column += 1;
      const left = (origin.x + start * cellMm - render.originX) * scale;
      parts.push(`M${round(left)} ${round(top)}h${round((column - start) * cell)}v${round(cell)}h${round(-(column - start) * cell)}z`);
    }
  }
  return parts.join("");
}

/** Ytan som sträckans linjer och stråk täcker, i kartbildens pixlar. */
export function legBounds(render: Render, leg: PlannedLeg, analysis: LegAnalysis | undefined) {
  const points: Point[] = [];
  if (leg.input) points.push(leg.input.from, leg.input.to);
  if (analysis?.best) points.push(...analysis.best.points);
  for (const alternative of analysis?.alternatives ?? []) points.push(...alternative.points);
  if (points.length === 0) return null;
  const pixels = points.map(point => mmToPixel(render, point));
  return { minX: Math.min(...pixels.map(p => p.x)), minY: Math.min(...pixels.map(p => p.y)),
    maxX: Math.max(...pixels.map(p => p.x)), maxY: Math.max(...pixels.map(p => p.y)) };
}

/** Avståndet från en punkt till en sträcka. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y, length = dx * dx + dy * dy;
  const share = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + share * dx), point.y - (from.y + share * dy));
}

/**
 * Förenklar en linje (Douglas–Peucker) med toleransen i mm och avrundar till 0,01 mm, för det som publiceras. Ändpunkterna
 * behålls alltid. Högst `maxPoints` punkter (toleransen ökas tills det räcker).
 */
export function simplifyLine(points: readonly Point[], toleranceMm = 0.25, maxPoints = 2000): [number, number][] {
  if (points.length <= 2) return points.map(point => [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100]);
  let tolerance = toleranceMm;
  for (;;) {
    const keep = new Uint8Array(points.length);
    keep[0] = 1; keep[points.length - 1] = 1;
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length > 0) {
      const [first, last] = stack.pop()!;
      let index = -1, max = 0;
      for (let i = first + 1; i < last; i += 1) {
        const distance = distanceToSegment(points[i]!, points[first]!, points[last]!);
        if (distance > max) { max = distance; index = i; }
      }
      if (index >= 0 && max > tolerance) { keep[index] = 1; stack.push([first, index], [index, last]); }
    }
    const kept = points.filter((_point, index) => keep[index] === 1);
    if (kept.length <= maxPoints) return kept.map(point => [Math.round(point.x * 100) / 100, Math.round(point.y * 100) / 100]);
    tolerance *= 2;
  }
}

/**
 * Kalibreringen: rutternas delar (WGS 84) som kartfilens mm med kartfilens georeferens. Delar som hamnar utanför kartan
 * (eller inte kan räknas om) hoppas över. Allt sker i webbläsaren.
 */
export function calibrationSamples(routes: RouteChoiceCalibrationRoutes, toMap: (latitude: number, longitude: number) => Point | undefined)
  : CalibrationSample[] {
  return routes.runners.flatMap(runner => runner.legs.flatMap(leg => {
    const points = leg.points.flatMap(([latitude, longitude]) => { const point = toMap(latitude, longitude); return point ? [point] : []; });
    return points.length >= 2 && points.length === leg.points.length ? [{ key: leg.key, points, seconds: leg.milliseconds / 1000 }] : [];
  }));
}

/** Bästa vägen per sträcka att publicera (sträckor utan väg hoppas över). */
export function publishableLegs(legs: readonly PlannedLeg[], analyses: ReadonlyMap<string, LegAnalysis>): { key: string; points: [number, number][] }[] {
  return legs.flatMap(leg => {
    const best = analyses.get(leg.key)?.best;
    return best && best.points.length >= 2 ? [{ key: leg.key, points: simplifyLine(best.points) }] : [];
  });
}
