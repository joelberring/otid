import { allCourseVariants, type CourseSettingDocument, type ExcludedVariant } from "@o-tid/course-setting";
import { pruneVariants, type PrunableVariant, type PruningOptions, type VariantPruning } from "@o-tid/domain";
import type { LegInput } from "@o-tid/route-choice";
import { routeLengthLegs, type LegLength } from "./course-setting-route-length";

/**
 * ADR-0198: tabellen över en gafflad banas varianter i banläggningen (fågelväg, längs vägval när den är räknad, antal
 * kontroller, skillnad mot den kortaste) och underlaget till domänens `pruneVariants`. Ren logik; webbens panel visar den.
 */
export interface VariantRow {
  readonly code: string;
  readonly excluded: boolean;
  readonly straightMeters: number;
  /** Längs vägval: tal = räknad; "NO_ROUTE" = någon sträcka saknar väg; undefined = inte räknad än. */
  readonly route: number | "NO_ROUTE" | undefined;
  readonly controlCount: number;
  /** Mot den kortaste varianten, i det mått som jämförs (längs vägval när det finns för alla, annars fågelväg). */
  readonly differenceMeters: number;
  readonly differencePercent: number;
  readonly controlCodes: readonly string[];
}

export interface VariantTable {
  readonly rows: readonly VariantRow[];
  /** Alla varianters sträckor utan dubbletter (för vägvalens Worker). */
  readonly legs: readonly LegInput[];
  readonly routeDone: number;
  /** Längs vägval finns för alla varianter. */
  readonly routeComplete: boolean;
  readonly prunable: readonly PrunableVariant[];
  /** Kontrollens id → det som visas (kod, "start", "mål"). */
  readonly label: (control: string) => string;
}

export function variantTable(document: CourseSettingDocument, course: string, results: ReadonlyMap<string, LegLength>): VariantTable | undefined {
  const found = document.courses.find(row => row.id === course);
  if (!found || found.kind === "SCORE") return undefined;
  const variants = allCourseVariants(document, course);
  if (variants.length < 2 && !variants.some(row => row.excluded)) return undefined;
  const legs = new Map<string, LegInput>();
  const controlOf = (courseControl: string) => document.courseControls[courseControl]?.control;
  const measured = variants.map(variant => {
    const own = routeLengthLegs(document, course, variant.code)?.legs ?? [];
    for (const leg of own) if (!legs.has(leg.key)) legs.set(leg.key, leg);
    let sum = 0, missing = false, noRoute = false;
    for (const leg of own) {
      const result = results.get(leg.key);
      if (!result) missing = true; else if (result.best === undefined) noRoute = true; else sum += result.best;
    }
    const route: VariantRow["route"] = noRoute ? "NO_ROUTE" : missing || own.length === 0 ? undefined : Math.round(sum);
    const controls = variant.courseControls.map(controlOf).filter((id): id is string => id !== undefined);
    const steps = controls.slice(1).map((to, index) => `${controls[index]}>${to}`).filter((_key, index) => controls[index] !== controls[index + 1]);
    const prunable: PrunableVariant = { code: variant.code, controls, legs: steps, straightMeters: variant.lengthMeters,
      ...(typeof route === "number" ? { routeMeters: route } : {}) };
    return { variant, route, prunable };
  });
  const routeComplete = measured.every(row => typeof row.route === "number");
  const length = (row: (typeof measured)[number]) => routeComplete ? row.route as number : row.variant.lengthMeters;
  const shortest = Math.min(...measured.map(length));
  const rows = measured.map(row => ({
    code: row.variant.code, excluded: row.variant.excluded === true, straightMeters: Math.round(row.variant.lengthMeters), route: row.route,
    controlCount: row.variant.controlCodes.length, controlCodes: row.variant.controlCodes,
    differenceMeters: Math.round(length(row) - shortest),
    differencePercent: shortest > 0 ? Math.round((length(row) / shortest - 1) * 100) : 0
  }));
  const label = (control: string) => {
    const point = document.controls[control];
    return point?.kind === "START" ? "start" : point?.kind === "FINISH" ? "mål" : point?.code ?? "?";
  };
  return { rows, legs: [...legs.values()], routeDone: [...legs.keys()].filter(key => results.has(key)).length, routeComplete,
    prunable: measured.map(row => row.prunable), label };
}

/**
 * Förslaget med banläggarens val bland de varianter som används nu. Redan bortvalda (för hand, tidigare förslag eller
 * en banfil där varianten saknas) står kvar som bortvalda; förslaget lägger till.
 */
export function pruningPlan(table: VariantTable, options: PruningOptions, excluded: ReadonlySet<string> = new Set()): VariantPruning {
  return pruneVariants(table.prunable.filter(variant => !excluded.has(variant.code)), options);
}

/** Bortvalen för `UPDATE_COURSE` ur koderna (koden och kontrollkoderna, så att bortvalet slutar gälla om varianten ändras). */
export function excludedRows(table: VariantTable, codes: ReadonlySet<string>): ExcludedVariant[] {
  return table.rows.filter(row => codes.has(row.code)).map(row => ({ code: row.code, controls: [...row.controlCodes] }));
}

/** Ett tak i fältet: tomt = inget, annars ett heltal ≥ 0 (procent) eller ≥ 1 (antal); "invalid" annars. */
export function parseLimit(text: string, min: number): number | undefined | "invalid" {
  const value = text.trim();
  if (value === "") return undefined;
  if (!/^\d{1,4}$/.test(value) || Number(value) < min) return "invalid";
  return Number(value);
}
