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
import { assignedCourseVariant, courseVariantsOf, entryCourseVersionId } from "./course-variants";
import { rogainingControlSet, scoreRogaining } from "./rogaining";
import { officialStartTime } from "./start-punch";
import { withMaxTime } from "./max-time";
import { controlCodesOutOfOrder, prepareReadoutForEvaluation } from "./station-corrections";
import { teamSprintReadoutPart } from "./relay-parallel";

/**
 * Versionen sparas på varje resultatrevision. 0.3.0 (PLAN.md steg 22): kontrollföljden matchas som ordnad
 * delföljd, så att extra- och dubbelstämplingar ger godkänt. 0.4.0 (PLAN.md steg 25): fast start utan lottad tid
 * räknas från startstämplingen, och klassens maxtid ger `OVERTIME`. 0.5.0 (PLAN.md steg 31): tävlingens tidsjusteringar
 * per station och kontroller ur funktion, och gamla stämplingar på en oröjd bricka räknas inte (`prepareReadoutForEvaluation`).
 * 0.6.0 (steg 45): vid lika många matchade kontroller väljs stämplingar mellan start och mål.
 */
export const RESULT_ENGINE_VERSION = "0.6.0";

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
  readonly controlCode: number;
  /** En kontroll ur funktion (PLAN.md steg 31) står kvar i följden men är frivillig och får ingen sträcktid. */
  readonly neutralized: boolean;
}

/** Starten och målet som sträcktiderna måste ligga mellan. */
interface TimeWindow { readonly startMs: number; readonly finishMs: number }
/** Variantvalet bryr sig inte om tiderna; sträcktiderna räknas när utfallet byggs. */
const ANY_TIME: TimeWindow = { startMs: -Infinity, finishMs: Infinity };

interface AlignmentScore {
  readonly required: number;
  readonly neutralized: number;
  /** Steg 45: matchade stämplingar mellan start och mål. Avgör bara mellan lika många matchade kontroller. */
  readonly inWindow: number;
}

function compareAlignment(left: AlignmentScore, right: AlignmentScore): number {
  return left.required - right.required || left.neutralized - right.neutralized || left.inWindow - right.inWindow;
}

function sameAlignment(left: AlignmentScore, right: AlignmentScore): boolean {
  return compareAlignment(left, right) === 0;
}

/**
 * Matchar kontrollföljden mot stämplingarna som ordnad delföljd (docs/domain-rules.md regel 4–7): så många
 * obligatoriska kontroller som möjligt i banans ordning, därefter så många strukna. Stämplingar som inte behövs
 * (dubbelstämpling, en kontroll stämplad en extra gång, en kontroll från en annan bana) hoppas över och redovisas
 * som extra. Vid lika många matchningar väljs den tidigaste stämplingen för varje kontroll, så att sträcktiderna
 * blir desamma vid dubbelstämpling. Det gör att en kontroll som återkommer (fjärilsslinga) och en extra stämpling
 * före rätt följd ger godkänt, medan en obligatorisk kontroll som bara finns på fel plats blir saknad.
 */
function alignControls(expected: readonly ExpectedControl[], punches: readonly Punch[], window: TimeWindow = ANY_TIME) {
  // Steg 45: vid lika många matchade kontroller väljs stämplingar mellan start och mål (oröjd bricka med ett fullt varv
  // från tidigare samma dag). Antalet matchade kontroller avgör först, så ingen blir felstämplad av regeln.
  const inside = punches.map((punch) => {
    const ms = Date.parse(punch.punchedAt);
    return Number.isFinite(ms) && ms >= window.startMs && ms <= window.finishMs ? 1 : 0;
  });
  const scores: AlignmentScore[][] = Array.from({ length: expected.length + 1 }, () =>
    Array.from({ length: punches.length + 1 }, () => ({ required: 0, neutralized: 0, inWindow: 0 })));
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
          neutralized: next.neutralized + (control.neutralized ? 1 : 0),
          inWindow: next.inWindow + inside[punchIndex]!
        };
        if (compareAlignment(matched, best) >= 0) best = matched;
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
    const matched = control.controlCode === punches[punchIndex]!.code && sameAlignment(current, {
      required: next.required + (control.neutralized ? 0 : 1), neutralized: next.neutralized + (control.neutralized ? 1 : 0),
      inWindow: next.inWindow + inside[punchIndex]! });
    if (matched) { matches.push({ expectedIndex, punchIndex }); expectedIndex += 1; punchIndex += 1; continue; }
    const skipPunch = scores[expectedIndex]![punchIndex + 1]!;
    if (sameAlignment(skipPunch, current)) { punchIndex += 1; continue; }
    expectedIndex += 1;
  }
  return matches;
}


interface ControlMatch {
  readonly missingControls: readonly number[];
  readonly extraPunches: readonly number[];
  readonly splits: readonly SplitTime[];
  readonly wrongOrder: boolean;
}

/**
 * Bedömer stämplingarna mot kontrollföljden. Saknad = en obligatorisk kontroll utan stämpling på sin plats i
 * följden. Fel ordning (regel 6) = en saknad kontroll som ändå är stämplad, fast bara utanför sin plats (före
 * föregående matchade kontroll eller efter nästa). Extra stämplingar påverkar inte bedömningen.
 */
function matchControls(expectedControls: readonly ExpectedControl[], punches: readonly Punch[], window: TimeWindow): ControlMatch {
  const expected = expectedControls.map((control) => control.controlCode);
  const aligned = alignControls(expectedControls, punches, window);
  const matchedByExpected = new Map(aligned.map((match) => [match.expectedIndex, match.punchIndex]));
  const matchedPunchIndexes = new Set(aligned.map((match) => match.punchIndex));
  const matched: Punch[] = [];
  const matchedExpectedIndexes: number[] = [];
  const missingControls: number[] = [];
  for (const [index, control] of expectedControls.entries()) {
    const punchIndex = matchedByExpected.get(index);
    if (punchIndex === undefined) { if (!control.neutralized) missingControls.push(control.controlCode); continue; }
    // Kontroll ur funktion: stämplingen behövs inte och ger ingen sträcktid; sträckan räknas från kontrollen före.
    if (control.neutralized) continue;
    matched.push(punches[punchIndex]!);
    matchedExpectedIndexes.push(index);
  }
  const extraPunches = punches.flatMap((punch, index) => matchedPunchIndexes.has(index) ? [] : [punch.code]);
  const wrongOrder = missingControls.some((code) => extraPunches.includes(code));
  return { missingControls, extraPunches, wrongOrder, splits: splitTimes(matched, matchedExpectedIndexes, expected, window) };
}

/** Kontrollkoder i banans ordning som kontrollföljd; en kontroll ur funktion är frivillig. */
function expectedOf(codes: readonly number[], outOfOrder: ReadonlySet<number>): ExpectedControl[] {
  return codes.map((controlCode) => ({ controlCode, neutralized: outOfOrder.has(controlCode) }));
}

/** Banversionens (ogafflade) kontrollkoder i ordning. */
function courseCodes(courseVersion: CourseVersion): number[] {
  return [...courseVersion.controls].sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode);
}

/**
 * Sträcktider från start. En stämplingstid räknas bara när den ligger mellan föregående kända tid (först starten)
 * och målet. En kontroll stämplad före starten (fel klocka i en enhet, fel starttid eller tjuvstart) eller efter målet
 * får ingen sträcktid: den utelämnas precis som en saknad stämpling och nästa sträcka räknas från föregående kontroll
 * med känd tid. Kontrollen räknas ändå som stämplad, så statusen följer de vanliga reglerna och löptiden är mål minus
 * start. Arbetsytan visar en notis i deltagarkortet så att arbetsledningen kan kontrollera starttiden (PLAN.md steg 13).
 */
function splitTimes(matched: readonly Punch[], matchedExpectedIndexes: readonly number[], expected: readonly number[],
  window: TimeWindow): SplitTime[] {
  const splits: SplitTime[] = [];
  let previousMs = window.startMs;
  matched.forEach((punch, index) => {
    const punchMs = Date.parse(punch.punchedAt);
    if (!Number.isFinite(punchMs) || punchMs < previousMs || punchMs > window.finishMs) return;
    splits.push({
      controlCode: punch.code,
      occurrence: occurrenceAt(expected, matchedExpectedIndexes[index] ?? index),
      elapsedMs: punchMs - window.startMs,
      legMs: punchMs - previousMs
    });
    previousMs = punchMs;
  });
  return splits;
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
  const courseVersion = activeVersion(snapshot, entryCourseVersionId(entry, raceClass));
  if (!courseVersion) return undefined;
  return { entry, raceClass, courseVersion };
}

/**
 * Gafflad bana: löparens tilldelade variant. Saknar löparen en giltig variant prövas
 * avläsningen mot varje variant och den som passar bäst gäller (godkänd före
 * felstämplad, sedan färst saknade kontroller, sedan variantordningen).
 */
function chooseVariant(resolved: ResolvedEntry, punches: readonly Punch[], outOfOrder: ReadonlySet<number>):
  { code: string; assigned: boolean; match: ControlMatch } | undefined {
  const variants = courseVariantsOf(resolved.courseVersion);
  if (variants.length === 0) return undefined;
  const codesOf = (variant: (typeof variants)[number]) => [...variant.controls]
    .sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode);
  const assigned = assignedCourseVariant(resolved.courseVersion, resolved.entry.courseVariantCode);
  // Tiderna påverkar inte vilken variant som passar; sträcktiderna räknas om när utfallet byggs.
  if (assigned) return { code: assigned.code, assigned: true, match: matchControls(expectedOf(codesOf(assigned), outOfOrder), punches, ANY_TIME) };
  let best: { code: string; assigned: boolean; match: ControlMatch } | undefined;
  for (const variant of variants) {
    const match = matchControls(expectedOf(codesOf(variant), outOfOrder), punches, ANY_TIME);
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
  const chosen = chooseVariant(resolved, prepareReadoutForEvaluation(readout, snapshot).readout.punches, controlCodesOutOfOrder(snapshot));
  return chosen && { code: chosen.code, assigned: chosen.assigned };
}

/**
 * Brickans stämplingar mot en deltagares bana, utan hänsyn till tider (deltagarkortets stämplingslista): vilka
 * stämplingar som hör till banan (index i `punches`) och vilka obligatoriska kontroller som saknas. Samma matchning
 * som bedömningen (gaffling, neutralisering, rogainingens kontrollmängd), men deltagaren anges med id i stället för
 * via brickan, så att även en avläsning som bedömdes som felstämplad redan vid starten kan visas mot banan.
 * `undefined` när deltagaren, klassen eller banan saknas i paketet.
 */
export function alignReadoutToCourse(punches: readonly Punch[], snapshot: RaceSnapshot, entryId: string):
  { readonly onCourse: ReadonlySet<number>; readonly missingControls: readonly number[] } | undefined {
  const entry = snapshot.entries.find((candidate) => candidate.id === entryId);
  const raceClass = entry && snapshot.classes.find((candidate) => candidate.id === entry.classId);
  const courseVersion = entry && raceClass && activeVersion(snapshot, entryCourseVersionId(entry, raceClass));
  if (!entry || !raceClass || !courseVersion) return undefined;
  if (raceClass.rogaining) {
    const set = rogainingControlSet(courseVersion);
    return { onCourse: new Set(punches.flatMap((punch, index) => set.has(punch.code) ? [index] : [])), missingControls: [] };
  }
  const outOfOrder = controlCodesOutOfOrder(snapshot);
  const variant = chooseVariant({ entry, raceClass, courseVersion }, punches, outOfOrder);
  let expected: ExpectedControl[];
  if (variant) {
    const chosen = courseVariantsOf(courseVersion).find((candidate) => candidate.code === variant.code)!;
    expected = expectedOf([...chosen.controls].sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode), outOfOrder);
  } else {
    expected = expectedOf(courseCodes(courseVersion), outOfOrder);
  }
  const aligned = alignControls(expected, punches);
  const matchedExpected = new Set(aligned.map((match) => match.expectedIndex));
  return { onCourse: new Set(aligned.map((match) => match.punchIndex)),
    missingControls: expected.flatMap((control, index) => matchedExpected.has(index) || control.neutralized ? [] : [control.controlCode]) };
}

export function evaluateCardReadout(
  input: EvaluationReadout,
  snapshot: RaceSnapshot
): EvaluationResult {
  // Tävlingens rättningar (tidsjustering per station, PLAN.md steg 31) läggs på brickans tider här och bara här.
  const prepared = prepareReadoutForEvaluation(input, snapshot).readout;
  const resolved = resolveEntry(prepared, snapshot);
  if (!resolved) return invalid("UNKNOWN_CARD");
  const { entry, raceClass, courseVersion } = resolved;
  // Steg 48: teamsprint – sträckan bedöms mot sin del av löparens bricka (ADR-0174 beslut 7).
  const readout = entry.teamSprint ? teamSprintReadoutPart(prepared, entry.teamSprint) : prepared;

  const common = {
    entryId: entry.id,
    classId: raceClass.id,
    courseVersionId: courseVersion.id
  };
  // Fast start: lottad tid, med startstämplingen som reserv när löparen saknar lottad tid (PLAN.md steg 25).
  const startTime = officialStartTime({ startRule: raceClass.startRule, fixedStartTime: entry.fixedStartTime,
    startPunchedAt: readout.startPunchedAt });
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

  const window: TimeWindow = { startMs, finishMs };
  const timing = { ...common, startTime, finishTime: readout.finishPunchedAt, elapsedMs: finishMs - startMs };
  if (raceClass.rogaining) {
    // Rogaining (ADR-0170 beslut 5): valfria kontroller i valfri ordning; poäng i stället för saknade kontroller.
    const scored = scoreRogaining(readout.punches, rogainingControlSet(courseVersion), raceClass.rogaining, window);
    return { status: "OK", reason: "COMPLETE", ...timing, missingControls: [], extraPunches: [...scored.extraPunches],
      splits: [...scored.splits], rogaining: scored.score };
  }
  let match: ControlMatch;
  const outOfOrder = controlCodesOutOfOrder(snapshot);
  const variant = chooseVariant(resolved, readout.punches, outOfOrder);
  if (variant) {
    const chosen = courseVariantsOf(courseVersion).find((candidate) => candidate.code === variant.code)!;
    const codes = [...chosen.controls].sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode);
    match = matchControls(expectedOf(codes, outOfOrder), readout.punches, window);
  } else {
    match = matchControls(expectedOf(courseCodes(courseVersion), outOfOrder), readout.punches, window);
  }

  const timed = {
    ...timing,
    missingControls: [...match.missingControls],
    extraPunches: [...match.extraPunches],
    splits: [...match.splits]
  };

  if (match.wrongOrder) return { status: "MP", reason: "WRONG_ORDER", ...timed };
  if (match.missingControls.length > 0) return { status: "MP", reason: "MISSING_CONTROL", ...timed };
  // Maxtid (PLAN.md steg 25): ett fullständigt resultat över klassens maxtid blir OVERTIME.
  return withMaxTime({ status: "OK", reason: "COMPLETE", ...timed }, raceClass.maxTimeMinutes);
}

/** Hur väl en okänd brickas stämplingar passar en klass bana (PLAN.md steg 29 punkt 4). */
export interface ClassCourseFit {
  readonly classId: string;
  readonly courseVersionId: string;
  /** Gafflad bana: varianten som passar bäst. */
  readonly variantCode?: string;
  /** Alla obligatoriska kontroller stämplade i banans ordning. */
  readonly ok: boolean;
  readonly missingControls: readonly number[];
  /** Stämplingar som inte hör till banan. */
  readonly extraPunches: number;
}

/**
 * Jämför stämplingarna mot varje klass bana med samma bästa-passning som gafflingar (godkänd först, sedan färst saknade
 * kontroller) och ger klasserna i den ordningen; vid lika passar den bana bäst som förklarar flest stämplingar, sedan
 * klassnamnet. Rogainingklasser (ingen kontrollföljd) och banor utan kontroller ingår inte. Bara ett förslag: arrangören
 * väljer alltid själv.
 */
export function rankClassesByCourseFit(punches: readonly Punch[], snapshot: RaceSnapshot,
  classIds?: ReadonlySet<string>): ClassCourseFit[] {
  const fits: { readonly fit: ClassCourseFit; readonly name: string }[] = [];
  const outOfOrder = controlCodesOutOfOrder(snapshot);
  for (const raceClass of snapshot.classes) {
    if (raceClass.rogaining || (classIds && !classIds.has(raceClass.id))) continue;
    const courseVersion = activeVersion(snapshot, raceClass.courseVersionId);
    if (!courseVersion) continue;
    const variants = courseVariantsOf(courseVersion);
    let best: { match: ControlMatch; code?: string } | undefined;
    if (variants.length > 0) {
      for (const variant of variants) {
        const codes = [...variant.controls].sort((left, right) => left.sequence - right.sequence).map((control) => control.controlCode);
        if (codes.length === 0) continue;
        const match = matchControls(expectedOf(codes, outOfOrder), punches, ANY_TIME);
        if (!best || betterMatch(match, best.match)) best = { match, code: variant.code };
      }
    } else {
      const expected = expectedOf(courseCodes(courseVersion), outOfOrder);
      if (expected.some((control) => !control.neutralized)) best = { match: matchControls(expected, punches, ANY_TIME) };
    }
    if (!best) continue;
    fits.push({ name: raceClass.name, fit: { classId: raceClass.id, courseVersionId: courseVersion.id,
      ...(best.code ? { variantCode: best.code } : {}), ok: !best.match.wrongOrder && best.match.missingControls.length === 0,
      missingControls: best.match.missingControls, extraPunches: best.match.extraPunches.length } });
  }
  return fits.sort(({ fit: left, name: leftName }, { fit: right, name: rightName }) => Number(right.ok) - Number(left.ok) ||
    left.missingControls.length - right.missingControls.length || left.extraPunches - right.extraPunches ||
    leftName.localeCompare(rightName, "sv") || (left.classId < right.classId ? -1 : left.classId > right.classId ? 1 : 0))
    .map((row) => row.fit);
}
