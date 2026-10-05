import { FINISH_KEY, START_KEY } from "@o-tid/domain";
import { splitAnalysisSv as text } from "../i18n/split-analysis-sv";
import type { ResultListModel } from "./lists/result-list-model";

/**
 * Sträcktidsanalysen (PLAN.md steg 16) på webben: vilka klasser som har en analys och hur sträckor skrivs.
 * Beräkningarna (sträcktider, placeringar, förluster, sortering) finns i domänens `split-table.ts`.
 */

/** Individuella klasser med sträcktider. Rogaining har inga sträckor och stafetten stöds inte än. */
export function analysisClassNames(model: ResultListModel): string[] {
  return model.classes.filter(raceClass => !raceClass.scored && raceClass.rows.some(row => row.splits.length > 0)).map(raceClass => raceClass.name);
}

/** En punkt i en sträcka: "S" start, "F" mål, annars "kod.förekomst". */
export function pointLabel(key: string): string {
  if (key === START_KEY) return text.start;
  if (key === FINISH_KEY) return text.finish;
  const [code, occurrence] = key.split(".");
  return text.control(Number(code), Number(occurrence ?? 1));
}

/** Sträckans namn, t.ex. "Start–31", "31–32" eller "33–Mål". */
export function legLabel(leg: string): string {
  const [from = "", to = ""] = leg.split("-");
  return text.legName(pointLabel(from), pointLabel(to));
}

export function splitsHref(raceId: string, className?: string): string {
  return `/results/${raceId}/splits${className ? `?class=${encodeURIComponent(className)}` : ""}`;
}

export function routeHref(raceId: string, publicResultId: string, leg: string): string {
  return `/results/${raceId}/routes?runner=${encodeURIComponent(publicResultId)}&leg=${encodeURIComponent(leg)}`;
}
