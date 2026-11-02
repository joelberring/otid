/**
 * Hur kartan sätts ihop för en träningsbana (ADR-0192 beslut 3) och hur passen ritas (beslut 9). Samma funktioner i
 * editorns Worker, förhandsvisningen och serverns PDF.
 */
import { drawMap, type ColorAdjust, type DrawMapOptions, type DrawMapReport, type MapCanvasContext, type ParsedMap } from "@o-tid/map-file";
import type { CourseSettingDocument, MapRect } from "./types";
import type { CourseTraining, SymbolFilter, TrainingArea, TrainingMapPass, TrainingSettings } from "./training-types";
import { sectionRegion, unionRegion, type Region } from "./training-regions";
import { hiddenSymbolIds, isFullFilter } from "./training-symbols";

export const EMPTY_TRAINING: TrainingSettings = { schemaVersion: 1, courses: {}, areas: {}, attackPoints: {} };
export const DEFAULT_TINT = 0.75;

export function trainingOf(document: CourseSettingDocument): TrainingSettings {
  return document.training ?? EMPTY_TRAINING;
}

/** Banans träning, eller en tom (hela kartan, inga avsnitt). */
export function courseTrainingOf(document: CourseSettingDocument, course: string): CourseTraining {
  return trainingOf(document).courses[course] ?? { outside: { kind: "FULL" }, sections: [] };
}

/** Områdena som gäller banan. */
export function areasFor(document: CourseSettingDocument, course: string): TrainingArea[] {
  return Object.values(trainingOf(document).areas).filter(area => area.polygon.length >= 3 &&
    (area.courses.length === 0 || area.courses.includes(course)));
}

function boxOf(region: Region): MapRect | undefined {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of region) for (const p of ring) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : undefined;
}

const meets = (a: MapRect | undefined, b: MapRect | undefined) => !a || !b || (a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY);

interface Cell { within: Region[]; without: Region[]; filters: SymbolFilter[]; white: boolean; lighten?: number }

/**
 * Passen för banan och varianten; `undefined` när banan inte har någon träning för kartan (rita kartan som vanligt).
 * `view` = utsnittet: ytor och områden utanför hoppas över.
 */
export function trainingMapPasses(document: CourseSettingDocument, options: { readonly course: string; readonly variant?: string | undefined;
  readonly view?: MapRect | undefined }): TrainingMapPass[] | undefined {
  if (options.course === "ALL_CONTROLS" || !document.courses.some(course => course.id === options.course)) return undefined;
  const training = trainingOf(document).courses[options.course];
  const areas = areasFor(document, options.course).map(area => ({ area, region: unionRegion([area.polygon]) }))
    .filter(item => meets(boxOf(item.region), options.view));
  const base = training?.filter && !isFullFilter(training.filter) ? [training.filter] : [];
  if (!training && areas.length === 0) return undefined;
  const sections = (training?.sections ?? []).map(section => ({ section, region: sectionRegion(document, options.course, options.variant, section) }))
    .filter(item => item.region.length > 0);
  let cells: Cell[];
  if (sections.length === 0) {
    cells = [{ within: [], without: [], filters: base, white: false }];
  } else {
    cells = [];
    const visible = sections.filter(item => meets(boxOf(item.region), options.view));
    sections.forEach((item, index) => {
      if (!visible.includes(item)) return;
      cells.push({ within: [item.region], without: sections.slice(0, index).map(other => other.region), filters: [...base, item.section.filter],
        white: item.section.form === "NO_MAP" });
    });
    const outside = training!.outside;
    const without = sections.map(item => item.region);
    if (outside.kind === "WHITE") cells.push({ within: [], without, filters: base, white: true });
    else if (outside.kind === "TINT") cells.push({ within: [], without, filters: base, white: false, lighten: outside.lighten });
    else if (outside.kind === "FILTER") cells.push({ within: [], without, filters: [...base, outside.filter], white: false });
    else cells.push({ within: [], without, filters: base, white: false });
  }
  // Områdena: inom varje område (det första gäller där de överlappar) och utanför alla.
  if (areas.length > 0) {
    cells = cells.flatMap(cell => [
      ...areas.map((item, index) => ({ ...cell, within: [...cell.within, item.region], without: [...cell.without, ...areas.slice(0, index).map(other => other.region)],
        filters: [...cell.filters, item.area.filter] })),
      { ...cell, without: [...cell.without, ...areas.map(item => item.region)] }
    ]);
  }
  return cells.map(cell => ({ within: cell.within, without: cell.without, filters: cell.filters.filter(filter => !isFullFilter(filter)),
    ...(cell.white ? { white: true } : {}), ...(cell.lighten !== undefined ? { lighten: cell.lighten } : {}) }));
}

/** Kartans färger ljusare (andel mot vitt), ovanpå utskriftsprofilens justering. */
function lightenAll(map: Pick<ParsedMap, "colors">, adjust: Readonly<Record<number, ColorAdjust>> | undefined, amount: number): Record<number, ColorAdjust> {
  const out: Record<number, ColorAdjust> = {};
  for (const color of map.colors) {
    const own = adjust?.[color.id];
    const l0 = own?.lighten ?? 0;
    out[color.id] = { ...own, lighten: 1 - (1 - Math.max(0, l0)) * (1 - Math.max(0, Math.min(1, amount))) + Math.min(0, l0) };
  }
  return out;
}

/**
 * Kartan med passen: varje pass ritas med klippning och dolda symboler (papperets vitt bara först). Utan pass som vanligt.
 * Passen som är vita ritas inte (papperet syns).
 */
export function drawTrainingMap(ctx: MapCanvasContext, map: ParsedMap, options: DrawMapOptions, passes: readonly TrainingMapPass[] | undefined): DrawMapReport {
  if (!passes) return drawMap(ctx, map, options);
  const drawn = passes.filter(pass => !pass.white);
  if (drawn.length === 0) return drawMap(ctx, map, { ...options, clip: { within: [[]] } });
  let report: DrawMapReport = { parts: 0, simplifications: [] };
  const hidden = new Map<string, Set<string>>();
  drawn.forEach((pass, index) => {
    const key = JSON.stringify(pass.filters);
    let hiddenSymbols = hidden.get(key);
    if (!hiddenSymbols) { hiddenSymbols = hiddenSymbolIds(map, pass.filters); hidden.set(key, hiddenSymbols); }
    const colorAdjust = pass.lighten !== undefined && pass.lighten > 0 ? lightenAll(map, options.colorAdjust, pass.lighten) : options.colorAdjust;
    const next = drawMap(ctx, map, { ...options, ...(colorAdjust ? { colorAdjust } : {}), ...(index > 0 ? { background: false } : {}),
      clip: { within: pass.within, without: pass.without }, ...(hiddenSymbols.size > 0 ? { hiddenSymbols } : {}) });
    report = { parts: report.parts + next.parts, simplifications: [...new Set([...report.simplifications, ...next.simplifications])] };
  });
  return report;
}

/** En nyckel för passen (bildernas cache och PDF:ens utsnitt). */
export function passesKey(passes: readonly TrainingMapPass[] | undefined): string {
  if (!passes) return "";
  let hash = 0;
  const text = JSON.stringify(passes);
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0;
  return `${passes.length}:${(hash >>> 0).toString(36)}:${text.length}`;
}
