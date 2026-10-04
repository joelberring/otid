import type {
  CourseVersion,
  Entry,
  EvaluationReadout,
  EvaluationResult,
  Punch,
  RaceClass,
  RaceSnapshot,
  SplitTime
} from "./types";
import { assignedCourseVariant, courseVariantsOf } from "./course-variants";

export const RESULT_ENGINE_VERSION = "0.1.1";

function invalid(reason: EvaluationResult["reason"], base: Partial<EvaluationResult> = {}): EvaluationResult {
  return {
    status: reason === "UNKNOWN_CARD" ? "UNKNOWN_CARD" : "MP",
    reason,
    missingControls: [],
    extraPunches: [],
    splits: [],
    ...base
  };
}

function activeVersion(snapshot: RaceSnapshot, courseVersionId: string): CourseVersion | undefined {
  for (const course of snapshot.courses) {
    const version = course.versions.find((candidate) => candidate.id === courseVersionId);
    if (version) return version;
  }
  return undefined;
}

function occurrenceAt(codes: readonly number[], index: number): number {
  const code = codes[index];
  if (code === undefined) return 0;
  return codes.slice(0, index + 1).filter((candidate) => candidate === code).length;
}

interface ExpectedControl {
  readonly id: string;
  readonly controlCode: number;
  readonly neutralized: boolean;
}

interface AlignmentScore {
  readonly required: number;
  readonly neutralized: number;
}

function compareAlignment(left: AlignmentScore, right: AlignmentScore): number {
  return left.required - right.required || left.neutralized - right.neutralized;
}

/**
 * Match the readout against the original control sequence. A neutralized
 * occurrence remains in that sequence but is optional. Maximising required
 * matches before neutralized matches makes repeated control codes deterministic:
 * one punch can still satisfy the later required occurrence.
 */
function alignWithNeutralization(expected: readonly ExpectedControl[], punches: readonly Punch[]) {
  const scores: AlignmentScore[][] = Array.from({ length: expected.length + 1 }, () =>
    Array.from({ length: punches.length + 1 }, () => ({ required: 0, neutralized: 0 })));
  for (let expectedIndex = expected.length - 1; expectedIndex >= 0; expectedIndex -= 1) {
    for (let punchIndex = punches.length - 1; punchIndex >= 0; punchIndex -= 1) {
      const control = expected[expectedIndex]!;
      let best = scores[expectedIndex + 1]![punchIndex]!;
      const skipPunch = scores[expectedIndex]![punchIndex + 1]!;
      if (compareAlignment(skipPunch, best) > 0) best = skipPunch;
      if (control.controlCode === punches[punchIndex]!.code) {
        const next = scores[expectedIndex + 1]![punchIndex + 1]!;
        const matched = {
          required: next.required + (control.neutralized ? 0 : 1),
          neutralized: next.neutralized + (control.neutralized ? 1 : 0)
        };
        if (compareAlignment(matched, best) > 0) best = matched;
      }
      scores[expectedIndex]![punchIndex] = best;
    }
  }
  const matches: Array<{ expectedIndex: number; punchIndex: number }> = [];
  let expectedIndex = 0, punchIndex = 0;
  while (expectedIndex < expected.length && punchIndex < punches.length) {
    const current = scores[expectedIndex]![punchIndex]!;
    const control = expected[expectedIndex]!;
    const next = scores[expectedIndex + 1]![punchIndex + 1]!;
    const matched = control.controlCode === punches[punchIndex]!.code &&
      current.required === next.required + (control.neutralized ? 0 : 1) &&
      current.neutralized === next.neutralized + (control.neutralized ? 1 : 0);
    if (matched) { matches.push({ expectedIndex, punchIndex }); expectedIndex += 1; punchIndex += 1; continue; }
    const skipExpected = scores[expectedIndex + 1]![punchIndex]!;
    if (compareAlignment(skipExpected, current) === 0) { expectedIndex += 1; continue; }
    punchIndex += 1;
  }
  return matches;
}

interface ControlMatch {
  readonly missingControls: readonly number[];
  readonly extraPunches: readonly number[];
  readonly splits: readonly SplitTime[];
  readonly wrongOrder: boolean;
}

/** Matchar stämplingarna mot en kontrollföljd där en förekomst kan vara struken (neutraliserad). */
function matchNeutralized(orderedControls: readonly ExpectedControl[], neutralizedId: string, punches: readonly Punch[],
  startMs: number, startTime: string): ControlMatch {
  const expected = orderedControls.map((control) => control.controlCode);
  const aligned = alignWithNeutralization(orderedControls, punches);
  const matchedByExpected = new Map(aligned.map((match) => [match.expectedIndex, match.punchIndex]));
  const matchedPunchIndexes = new Set(aligned.map((match) => match.punchIndex));
  const matched: Punch[] = [];
  const matchedExpectedIndexes: number[] = [];
  const missingControls: number[] = [];
  for (const [index, control] of orderedControls.entries()) {
    const punchIndex = matchedByExpected.get(index);
    if (control.id === neutralizedId) continue;
    if (punchIndex === undefined) missingControls.push(control.controlCode);
    else { matched.push(punches[punchIndex]!); matchedExpectedIndexes.push(index); }
  }
  const extraPunches = punches.flatMap((punch, index) => matchedPunchIndexes.has(index) ? [] : [punch.code]);
  const greatestMatchedIndex = matchedExpectedIndexes.length === 0 ? -1 : Math.max(...matchedExpectedIndexes);
  const wrongOrder = punches.some((punch, index) => !matchedPunchIndexes.has(index) &&
    orderedControls.some((control, controlIndex) => controlIndex < greatestMatchedIndex &&
      control.id !== neutralizedId && control.controlCode === punch.code));
  return { missingControls, extraPunches, wrongOrder,
    splits: splitTimes(matched, matchedExpectedIndexes, expected, startMs, startTime) };
}

function splitTimes(matched: readonly Punch[], matchedExpectedIndexes: readonly number[], expected: readonly number[],
  startMs: number, startTime: string): SplitTime[] {
  return matched.map((punch, index) => {
    const punchMs = Date.parse(punch.punchedAt);
    const previousMs = index === 0 ? startMs : Date.parse(matched[index - 1]?.punchedAt ?? startTime);
    return {
      controlCode: punch.code,
      occurrence: occurrenceAt(expected, matchedExpectedIndexes[index] ?? index),
      elapsedMs: punchMs - startMs,
      legMs: punchMs - previousMs
    };
  });
}

/** Matchar stämplingarna mot kontrollföljden i ordning. */
function matchControls(expected: readonly number[], punches: readonly Punch[], startMs: number, startTime: string): ControlMatch {
  const matched: Punch[] = [];
  const matchedExpectedIndexes: number[] = [];
  const missingControls: number[] = [];
  const extraPunches: number[] = [];
  let expectedIndex = 0;
  let wrongOrder = false;

  for (const punch of punches) {
    if (punch.code === expected[expectedIndex]) {
      matched.push(punch);
      matchedExpectedIndexes.push(expectedIndex);
      expectedIndex += 1;
      continue;
    }

    const laterOffset = expected.slice(expectedIndex + 1).indexOf(punch.code);
    if (laterOffset >= 0) {
      const matchedIndex = expectedIndex + laterOffset + 1;
      missingControls.push(...expected.slice(expectedIndex, matchedIndex));
      matched.push(punch);
      matchedExpectedIndexes.push(matchedIndex);
      expectedIndex = matchedIndex + 1;
      continue;
    }

    if (expected.slice(0, expectedIndex).includes(punch.code)) wrongOrder = true;
    extraPunches.push(punch.code);
  }

  missingControls.push(...expected.slice(expectedIndex));
  return { missingControls, extraPunches, wrongOrder, splits: splitTimes(matched, matchedExpectedIndexes, expected, startMs, startTime) };
}

/** Ett utfall är bättre om det är godkänt, annars om färre kontroller saknas. */
function betterMatch(candidate: ControlMatch, best: ControlMatch): boolean {
  const ok = (match: ControlMatch) => !match.wrongOrder && match.missingControls.length === 0;
  if (ok(candidate) !== ok(best)) return ok(candidate);
  return candidate.missingControls.length < best.missingControls.length;
}

interface ResolvedEntry {
  readonly entry: Entry;
  readonly raceClass: RaceClass;
  readonly courseVersion: CourseVersion;
}

function resolveEntry(readout: EvaluationReadout, snapshot: RaceSnapshot): ResolvedEntry | undefined {
  const assignment = snapshot.cardAssignments.find(
    (candidate) => candidate.active && candidate.cardNumber === readout.cardNumber
  );
  if (!assignment) return undefined;
  const entry = snapshot.entries.find((candidate) => candidate.id === assignment.entryId);
  if (!entry) return undefined;
  const raceClass = snapshot.classes.find((candidate) => candidate.id === entry.classId);
  if (!raceClass) return undefined;
  const courseVersion = activeVersion(snapshot, raceClass.courseVersionId);
  if (!courseVersion) return undefined;
  return { entry, raceClass, courseVersion };
}

/**
 * Gafflad bana: löparens tilldelade variant. Saknar löparen en giltig variant prövas
 * avläsningen mot varje variant och den som passar bäst gäller (godkänd före
 * felstämplad, sedan färst saknade kontroller, sedan variantordningen).
 */
function chooseVariant(resolved: ResolvedEntry, punches: readonly Punch[]): { code: string; assigned: boolean; match: ControlMatch } | undefined {
  const variants = courseVariantsOf(resolved.courseVersion);
  if (variants.length === 0) return undefined;
  const codesOf = (variant: (typeof variants)[number]) => [...variant.controls]
    .sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode);
  const assigned = assignedCourseVariant(resolved.courseVersion, resolved.entry.courseVariantCode);
  // Tiderna påverkar inte vilken variant som passar; sträcktiderna räknas om när utfallet byggs.
  if (assigned) return { code: assigned.code, assigned: true, match: matchControls(codesOf(assigned), punches, 0, new Date(0).toISOString()) };
  let best: { code: string; assigned: boolean; match: ControlMatch } | undefined;
  for (const variant of variants) {
    const match = matchControls(codesOf(variant), punches, 0, new Date(0).toISOString());
    if (!best || betterMatch(match, best.match)) best = { code: variant.code, assigned: false, match };
  }
  return best;
}

/**
 * Varianten som avläsningen bedöms mot, för att visa den i avläsningens besked.
 * `assigned` är falskt när löparen saknar variant och varianten valts efter stämplingarna.
 */
export function courseVariantForReadout(readout: EvaluationReadout, snapshot: RaceSnapshot):
  { readonly code: string; readonly assigned: boolean } | undefined {
  const resolved = resolveEntry(readout, snapshot);
  if (!resolved) return undefined;
  const chosen = chooseVariant(resolved, readout.punches);
  return chosen && { code: chosen.code, assigned: chosen.assigned };
}

export function evaluateCardReadout(
  readout: EvaluationReadout,
  snapshot: RaceSnapshot
): EvaluationResult {
  const resolved = resolveEntry(readout, snapshot);
  if (!resolved) return invalid("UNKNOWN_CARD");
  const { entry, raceClass, courseVersion } = resolved;

  const common = {
    entryId: entry.id,
    classId: raceClass.id,
    courseVersionId: courseVersion.id
  };
  const startTime = raceClass.startRule === "PUNCH" ? readout.startPunchedAt : entry.fixedStartTime;
  if (!startTime) return invalid("MISSING_START", common);
  if (!readout.finishPunchedAt) return invalid("MISSING_FINISH", { ...common, startTime });

  const startMs = Date.parse(startTime);
  const finishMs = Date.parse(readout.finishPunchedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(finishMs) || finishMs < startMs) {
    return invalid("INVALID_TIME_ORDER", {
      ...common,
      startTime,
      finishTime: readout.finishPunchedAt
    });
  }

  let match: ControlMatch;
  const variant = chooseVariant(resolved, readout.punches);
  if (variant) {
    const chosen = courseVariantsOf(courseVersion).find((candidate) => candidate.code === variant.code)!;
    const codes = [...chosen.controls].sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode);
    match = matchControls(codes, readout.punches, startMs, startTime);
  } else {
    const orderedControls = [...courseVersion.controls].sort((left, right) => left.sequence - right.sequence);
    const neutralizations = snapshot.classControlNeutralizations.filter((candidate) =>
      candidate.classId === raceClass.id && candidate.courseVersionId === courseVersion.id);
    if (neutralizations.length > 1) throw new Error("Flera neutraliseringar för samma klass och banversion");
    const neutralization = neutralizations[0];
    if (neutralization && !orderedControls.some((control) => control.id === neutralization.courseControlId &&
        control.sequence === neutralization.sequence && control.controlCode === neutralization.controlCode)) {
      throw new Error("Neutraliseringen matchar inte bankontrollen");
    }
    match = neutralization
      ? matchNeutralized(orderedControls.map((control) => ({ id: control.id, controlCode: control.controlCode,
        neutralized: control.id === neutralization.courseControlId })), neutralization.courseControlId, readout.punches, startMs, startTime)
      : matchControls(orderedControls.map((control) => control.controlCode), readout.punches, startMs, startTime);
  }

  const timed = {
    ...common,
    startTime,
    finishTime: readout.finishPunchedAt,
    elapsedMs: finishMs - startMs,
    missingControls: [...match.missingControls],
    extraPunches: [...match.extraPunches],
    splits: [...match.splits]
  };

  if (match.wrongOrder) return { status: "MP", reason: "WRONG_ORDER", ...timed };
  if (match.missingControls.length > 0) return { status: "MP", reason: "MISSING_CONTROL", ...timed };
  return { status: "OK", reason: "COMPLETE", ...timed };
}
