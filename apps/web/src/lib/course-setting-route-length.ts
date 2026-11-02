import { courseControlOrder, variations, type CourseSettingDocument } from "@o-tid/course-setting";
import type { LegInput } from "@o-tid/route-choice";
import { legInput } from "./course-setting-text";

/**
 * ADR-0190 beslut 6: banans längd längs föreslagna vägval, som extra uppgift bredvid fågelvägen. Sträckorna räknas av
 * vägvalens Worker (samma indata som vald sträcka, så att en sträcka som redan räknats inte räknas igen). En gafflad bana
 * räknas för vald variant, annars den första. Poängbanor har inga sträckor. Ren logik.
 */
export interface RouteLengthLegs {
  /** Varianten som räknas ("" = ogafflad). */
  readonly variant: string;
  readonly legs: readonly LegInput[];
}

/** Sträckorna i banan (eller varianten); undefined för Alla kontroller och poängbanor. */
export function routeLengthLegs(document: CourseSettingDocument, course: string, variant: string | undefined): RouteLengthLegs | undefined {
  const found = document.courses.find(row => row.id === course);
  if (!found || found.kind === "SCORE") return undefined;
  const code = variant ?? variations(document, course)[0]?.code ?? "";
  const order = courseControlOrder(document, course, code === "" ? undefined : code);
  const legs: LegInput[] = [];
  for (let index = 1; index < order.length; index++) {
    const from = document.courseControls[order[index - 1]!]?.control, to = document.courseControls[order[index]!]?.control;
    if (from === undefined || to === undefined || from === to) continue;
    const input = legInput(document, from, to, order, course);
    if (input) legs.push(input);
  }
  return { variant: code, legs };
}

export interface LegLength { readonly best: number | undefined; readonly straight: number }

export type RouteLengthSummary =
  | { readonly kind: "done"; readonly best: number; readonly straight: number; readonly percent: number }
  /** Någon sträcka saknar väg (t.ex. kontrollen i ett ej passerbart område). */
  | { readonly kind: "no-route"; readonly legs: number }
  | { readonly kind: "partial"; readonly done: number; readonly total: number };

/** Summan när alla sträckor är räknade. */
export function routeLengthSummary(legs: readonly LegInput[], results: ReadonlyMap<string, LegLength>): RouteLengthSummary {
  let best = 0, straight = 0, done = 0, missing = 0;
  for (const leg of legs) {
    const result = results.get(leg.key);
    if (!result) continue;
    done += 1;
    straight += result.straight;
    if (result.best === undefined) missing += 1; else best += result.best;
  }
  if (done < legs.length) return { kind: "partial", done, total: legs.length };
  if (missing > 0) return { kind: "no-route", legs: missing };
  return { kind: "done", best, straight, percent: straight > 0 ? Math.round((best / straight - 1) * 100) : 0 };
}
