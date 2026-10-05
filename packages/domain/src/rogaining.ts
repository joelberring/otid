import type { CourseControl, CourseVersion, Punch, RaceSnapshot, RogainingRules, RogainingScore, SplitTime } from "./types";

/**
 * Rogaining (ADR-0170 beslut 5, PLAN.md steg 15). Löparen stämplar valfria kontroller i valfri ordning.
 * Resultatet är summan av de unika kontrollernas poäng minus straff för varje påbörjad minut över
 * tidsgränsen. Bedömningen är ren; `evaluateCardReadout` använder den för rogainingklasser.
 *
 * Regler:
 * - Kontrollmängden är klassens banversion; ordningen spelar ingen roll.
 * - Poängförval: kontrollkoden delat med tio, avrundat nedåt (31 → 3, 45 → 4, 102 → 10). Arrangören kan ändra
 *   poängen per kontroll; ändringen gäller kontrollkoden i hela tävlingen.
 * - En kontroll räknas en gång även om den stämplats flera gånger. Stämplingar på kontroller utanför mängden
 *   räknas inte (de visas som extra stämplingar).
 * - Straff: varje påbörjad minut över tidsgränsen (60:00 är inom, 60:01 ger en minut, 61:01 två).
 * - Summan blir aldrig negativ: straffet kan som mest ta bort alla kontrollpoäng.
 */

/** Förvalda poäng för en kontrollkod: tiotalet (koden delat med tio, avrundat nedåt), som mest 1000. */
export function defaultRogainingPoints(controlCode: number): number {
  return Math.min(Math.floor(controlCode / 10), 1_000);
}

/** Kontrollens poäng: arrangörens värde om det finns, annars förvalet. */
export function rogainingControlPoints(control: Pick<CourseControl, "controlCode" | "points">): number {
  return control.points ?? defaultRogainingPoints(control.controlCode);
}

/** Kontrollmängden för en rogainingbana: kod → poäng. En kod som förekommer flera gånger räknas som en kontroll. */
export function rogainingControlSet(version: Pick<CourseVersion, "controls">): ReadonlyMap<number, number> {
  const set = new Map<number, number>();
  for (const control of [...version.controls].sort((left, right) => left.sequence - right.sequence)) {
    if (!set.has(control.controlCode)) set.set(control.controlCode, rogainingControlPoints(control));
  }
  return set;
}

/** Påbörjade minuter över tidsgränsen och straffet för dem. */
export function rogainingPenalty(elapsedMs: number, rules: RogainingRules): { overtimeMinutes: number; penalty: number } {
  const overtimeMs = elapsedMs - rules.timeLimitSeconds * 1_000;
  const overtimeMinutes = overtimeMs > 0 ? Math.ceil(overtimeMs / 60_000) : 0;
  return { overtimeMinutes, penalty: overtimeMinutes * rules.penaltyPointsPerMinute };
}

export interface RogainingEvaluation {
  readonly score: RogainingScore;
  readonly splits: readonly SplitTime[];
  readonly extraPunches: readonly number[];
}

/**
 * Poängen för en avläsning med start och mål. Sträcktiderna gäller de räknade kontrollerna i stämplingsordning
 * (första stämplingen). Liksom i den vanliga bedömningen får en stämpling före starten eller efter målet ingen
 * sträcktid men räknas ändå.
 */
export function scoreRogaining(punches: readonly Punch[], controls: ReadonlyMap<number, number>, rules: RogainingRules,
  window: { readonly startMs: number; readonly finishMs: number }): RogainingEvaluation {
  const counted: { controlCode: number; points: number }[] = [];
  const seen = new Set<number>();
  const extraPunches: number[] = [];
  const splits: SplitTime[] = [];
  let previousMs = window.startMs;
  for (const punch of punches) {
    const points = controls.get(punch.code);
    if (points === undefined) { extraPunches.push(punch.code); continue; }
    if (seen.has(punch.code)) continue;
    seen.add(punch.code);
    counted.push({ controlCode: punch.code, points });
    const punchMs = Date.parse(punch.punchedAt);
    if (!Number.isFinite(punchMs) || punchMs < previousMs || punchMs > window.finishMs) continue;
    splits.push({ controlCode: punch.code, occurrence: 1, elapsedMs: punchMs - window.startMs, legMs: punchMs - previousMs });
    previousMs = punchMs;
  }
  const controlPoints = counted.reduce((sum, control) => sum + control.points, 0);
  const { overtimeMinutes, penalty } = rogainingPenalty(window.finishMs - window.startMs, rules);
  return {
    score: { controlPoints, penalty, total: Math.max(0, controlPoints - penalty), timeLimitMs: rules.timeLimitSeconds * 1_000,
      penaltyPointsPerMinute: rules.penaltyPointsPerMinute, overtimeMinutes, controls: counted },
    splits,
    extraPunches
  };
}

/** Ny löptid efter en manuellt rättad mål- eller starttid: samma kontroller, straffet räknas om. */
export function rescoreRogaining(score: RogainingScore, elapsedMs: number): RogainingScore {
  const { overtimeMinutes, penalty } = rogainingPenalty(elapsedMs,
    { timeLimitSeconds: score.timeLimitMs / 1_000, penaltyPointsPerMinute: score.penaltyPointsPerMinute });
  return { ...score, overtimeMinutes, penalty, total: Math.max(0, score.controlPoints - penalty) };
}

/**
 * Ändrade rogaininginställningar som ögonblicksbild, för beskedet före sparande. `points` gäller kontrollkoden i hela
 * tävlingen (null = tillbaka till förvalet); `classRules` gäller klassen (null = inte längre rogaining).
 */
export function withRogainingSettings(snapshot: RaceSnapshot, change: {
  readonly points?: ReadonlyMap<number, number | null>; readonly classRules?: ReadonlyMap<string, RogainingRules | null>;
}): RaceSnapshot {
  const points = change.points ?? new Map<number, number | null>();
  const classRules = change.classRules ?? new Map<string, RogainingRules | null>();
  return {
    ...snapshot,
    classes: snapshot.classes.map((raceClass) => {
      if (!classRules.has(raceClass.id)) return raceClass;
      const rules = classRules.get(raceClass.id);
      const rest = { ...raceClass };
      delete rest.rogaining;
      return rules ? { ...rest, rogaining: rules } : rest;
    }),
    courses: snapshot.courses.map((course) => ({
      ...course,
      versions: course.versions.map((version) => ({
        ...version,
        controls: version.controls.map((control) => {
          if (!points.has(control.controlCode)) return control;
          const value = points.get(control.controlCode);
          const rest = { ...control };
          delete rest.points;
          return value === null || value === undefined ? rest : { ...rest, points: value };
        })
      }))
    }))
  };
}
