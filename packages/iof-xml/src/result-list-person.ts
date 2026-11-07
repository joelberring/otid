/** IOF ResultList: kontrollen och XML:en för en löpares resultat (PersonResult, eller stafettens TeamMemberResult). */
import type {
  IofResultListExpectedControl, IofResultListPersonResult, IofResultListSplit, IofResultListTeamResult
} from "./result-list-types";
import {
  canonicalUuidPattern, escapeXml, iofStatus, key, line, millisecondsToSeconds, normalizedUtcInstant, serializeCourse, validateCourse,
  validateMilliseconds, validateText
} from "./result-list-xml";

const MAX_EXPECTED_CONTROLS = 256;

function validateManualApprovalProof(value: unknown, issues: string[]): boolean {
  const path = "manualApprovalProof";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(`${path} måste vara ett objekt`);
    return false;
  }
  const proof = value as Record<string, unknown>;
  const allowed = new Set(["decisionId", "targetResultRevisionId"]);
  for (const property of Object.keys(proof)) {
    if (!allowed.has(property)) issues.push(`${path}.${property} är inte tillåten`);
  }
  let valid = Object.keys(proof).length === 2;
  if (typeof proof.decisionId !== "string" || !canonicalUuidPattern.test(proof.decisionId)) {
    issues.push(`${path}.decisionId måste vara ett kanoniskt gemener-UUID`);
    valid = false;
  }
  if (typeof proof.targetResultRevisionId !== "string" ||
      !canonicalUuidPattern.test(proof.targetResultRevisionId)) {
    issues.push(`${path}.targetResultRevisionId måste vara ett kanoniskt gemener-UUID`);
    valid = false;
  }
  return valid;
}

export interface ValidatedResult {
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly splitByKey: ReadonlyMap<string, IofResultListSplit>;
  readonly untimedKeys?: ReadonlySet<string>;
}

export function validateResult(
  result: IofResultListPersonResult,
  path: string,
  issues: string[]
): ValidatedResult {
  validateText(result.givenName, `${path}.givenName`, issues);
  validateText(result.familyName, `${path}.familyName`, issues);
  if (result.entryExternalId !== undefined) {
    validateText(result.entryExternalId, `${path}.entryExternalId`, issues);
  }
  if (result.organisationName !== undefined) {
    validateText(result.organisationName, `${path}.organisationName`, issues);
  }
  for (const [field, value] of [["personEventorId", result.personEventorId], ["organisationEventorId", result.organisationEventorId]] as const) {
    if (value !== undefined && !/^[0-9A-Za-z_-]{1,64}$/.test(value)) issues.push(`${path}.${field} är ogiltigt`);
  }
  if (result.cardNumber !== undefined && !/^[1-9][0-9]{0,31}$/.test(result.cardNumber)) {
    issues.push(`${path}.cardNumber måste vara ett bricknummer`);
  }
  if (result.course !== undefined) validateCourse(result.course, `${path}.course`, issues);
  if (result.status !== "OK" && result.status !== "OVERTIME" && result.status !== "MP" &&
      result.status !== "DSQ" && result.status !== "DNF" &&
      result.status !== "OOC" && result.status !== "DNS") {
    issues.push(`${path}.status måste vara OK, OVERTIME, MP, DSQ, DNF, OOC eller DNS`);
  }

  if (result.status === "DNF") {
    const forbidden = ["finishTime", "elapsedMs", "position", "timeBehindMs", "untimedControls", "scores", "manualApprovalProof"];
    for (const property of forbidden) {
      if (Object.prototype.hasOwnProperty.call(result, property)) {
        issues.push(`${path} med status DNF får inte ha ${property}`);
      }
    }
    // Steg 38: sträcktider kräver start och banans kontroller; utan dem är brutit bara status.
    if (result.splits === undefined || result.splits.length === 0) {
      if (result.startTime !== undefined || result.expectedControls !== undefined || result.splits !== undefined) {
        issues.push(`${path} med status DNF utan sträcktider måste vara status-only`);
      }
      return { splitByKey: new Map() };
    }
    if (result.startTime === undefined) issues.push(`${path} med status DNF och sträcktider måste ha startTime`);
  }

  let manualApprovalProofValid = false;
  if (result.manualApprovalProof !== undefined) {
    manualApprovalProofValid = validateManualApprovalProof(result.manualApprovalProof, issues);
    if (result.status !== "OK") {
      issues.push(`${path}.manualApprovalProof får bara anges för status OK`);
      manualApprovalProofValid = false;
    }
  }

  const positionProvided = result.position !== undefined;
  const timeBehindProvided = result.timeBehindMs !== undefined;
  const scored = result.scores !== undefined;
  for (const [index, score] of (result.scores ?? []).entries()) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(score.type) || !Number.isSafeInteger(score.value) || score.value < 0) {
      issues.push(`${path}.scores[${index}] måste ha en typ och ett icke-negativt heltal`);
    }
  }
  // En klass med poäng (rogaining) rangordnas på poäng: placering utan tid efter.
  if (scored ? timeBehindProvided : positionProvided !== timeBehindProvided) {
    issues.push(scored ? `${path}.timeBehindMs anges inte för poängresultat`
      : `${path}.position och ${path}.timeBehindMs måste anges tillsammans`);
  }
  if ((positionProvided || timeBehindProvided) && result.status !== "OK") {
    issues.push(`${path}.position och ${path}.timeBehindMs får bara anges för status OK`);
  }
  if (positionProvided &&
      (!Number.isSafeInteger(result.position) || result.position <= 0)) {
    issues.push(`${path}.position måste vara ett positivt säkert heltal`);
  }
  if (timeBehindProvided &&
      (!Number.isSafeInteger(result.timeBehindMs) || result.timeBehindMs < 0)) {
    issues.push(`${path}.timeBehindMs måste vara ett icke-negativt säkert heltal i millisekunder`);
  }

  let startTime: string | undefined;
  let finishTime: string | undefined;
  if (result.startTime !== undefined) {
    if (validateText(result.startTime, `${path}.startTime`, issues)) {
      startTime = normalizedUtcInstant(result.startTime, `${path}.startTime`, issues);
    }
  }
  if (result.finishTime !== undefined) {
    if (validateText(result.finishTime, `${path}.finishTime`, issues)) {
      finishTime = normalizedUtcInstant(result.finishTime, `${path}.finishTime`, issues);
    }
  }

  const elapsedValid = result.elapsedMs === undefined
    ? false
    : validateMilliseconds(result.elapsedMs, `${path}.elapsedMs`, issues);
  if ((result.status === "OK" || result.status === "OVERTIME") && (!startTime || !finishTime || !elapsedValid)) {
    issues.push(`${path} med status ${result.status} måste ha startTime, finishTime och elapsedMs`);
  }
  if (result.status === "DNS" &&
      (result.startTime !== undefined || result.finishTime !== undefined || result.elapsedMs !== undefined ||
       positionProvided || timeBehindProvided)) {
    issues.push(`${path} med status DNS måste vara status-only utan tider eller ranking`);
  }
  if (elapsedValid && startTime && finishTime) {
    const measured = Date.parse(finishTime) - Date.parse(startTime);
    if (measured !== result.elapsedMs) {
      issues.push(`${path}.elapsedMs motsvarar inte skillnaden mellan startTime och finishTime`);
    }
  } else if (elapsedValid && (!startTime || !finishTime)) {
    issues.push(`${path}.elapsedMs kräver både startTime och finishTime`);
  }

  if (!Array.isArray(result.expectedControls)) {
    issues.push(`${path}.expectedControls måste vara en lista`);
  }
  if (!Array.isArray(result.splits)) issues.push(`${path}.splits måste vara en lista`);
  if (!Array.isArray(result.expectedControls) || !Array.isArray(result.splits)) {
    return {
      ...(startTime ? { startTime } : {}),
      ...(finishTime ? { finishTime } : {}),
      splitByKey: new Map()
    };
  }
  const expectedControls: readonly IofResultListExpectedControl[] = result.expectedControls;
  const splits: readonly IofResultListSplit[] = result.splits;
  if (result.status === "DNS" && (expectedControls.length !== 0 || splits.length !== 0)) {
    issues.push(`${path} med status DNS får inte ha kontroller eller splits`);
  }
  if (result.status === "OOC" && result.finishTime !== undefined && result.startTime === undefined) {
    issues.push(`${path} med status OOC får inte ha finishTime utan startTime`);
  }
  // Steg 38: utom tävlan och "Deltog utan tid" utan mål har sträcktider men ingen tid; de kräver då start.
  if (result.status === "OOC" && result.elapsedMs === undefined && splits.length !== 0 && result.startTime === undefined) {
    issues.push(`${path} med status OOC får inte ha splits utan startTime`);
  }
  if (expectedControls.length > MAX_EXPECTED_CONTROLS) {
    issues.push(`${path}.expectedControls får innehålla högst ${MAX_EXPECTED_CONTROLS} kontroller`);
  }

  const expectedKeys = new Set<string>();
  const nextOccurrence = new Map<number, number>();
  for (const [index, control] of expectedControls.entries()) {
    const controlPath = `${path}.expectedControls[${index}]`;
    if (!Number.isSafeInteger(control.controlCode) || control.controlCode <= 0) {
      issues.push(`${controlPath}.controlCode måste vara ett positivt heltal`);
    }
    const expectedOccurrence = (nextOccurrence.get(control.controlCode) ?? 0) + 1;
    nextOccurrence.set(control.controlCode, expectedOccurrence);
    if (!Number.isSafeInteger(control.occurrence) || control.occurrence !== expectedOccurrence) {
      issues.push(`${controlPath}.occurrence måste vara ${expectedOccurrence}`);
    }
    const controlKey = key(control.controlCode, control.occurrence);
    if (expectedKeys.has(controlKey)) issues.push(`${controlPath} förekommer flera gånger`);
    expectedKeys.add(controlKey);
  }

  const splitByKey = new Map<string, IofResultListSplit>();
  for (const [index, split] of splits.entries()) {
    const splitPath = `${path}.splits[${index}]`;
    if (!Number.isSafeInteger(split.controlCode) || split.controlCode <= 0) {
      issues.push(`${splitPath}.controlCode måste vara ett positivt heltal`);
    }
    if (!Number.isSafeInteger(split.occurrence) || split.occurrence <= 0) {
      issues.push(`${splitPath}.occurrence måste vara ett positivt heltal`);
    }
    const splitKey = key(split.controlCode, split.occurrence);
    if (!expectedKeys.has(splitKey)) issues.push(`${splitPath} hör inte till den historiska bansekvensen`);
    if (splitByKey.has(splitKey)) issues.push(`${splitPath} förekommer flera gånger`);
    if (validateMilliseconds(split.elapsedMs, `${splitPath}.elapsedMs`, issues)
      && elapsedValid && split.elapsedMs > (result.elapsedMs as number)) {
      issues.push(`${splitPath}.elapsedMs får inte vara större än resultatets elapsedMs`);
    }
    splitByKey.set(splitKey, split);
  }

  let previousElapsedMs = -1;
  for (const control of expectedControls) {
    const split = splitByKey.get(key(control.controlCode, control.occurrence));
    if (!split) continue;
    if (split.elapsedMs < previousElapsedMs) {
      issues.push(`${path}.splits måste ha icke-avtagande kumulativ tid i banordning`);
      break;
    }
    previousElapsedMs = split.elapsedMs;
  }
  const untimedKeys = new Set<string>();
  for (const [index, control] of (result.untimedControls ?? []).entries()) {
    const untimedKey = key(control.controlCode, control.occurrence);
    if (!expectedKeys.has(untimedKey) || splitByKey.has(untimedKey) || untimedKeys.has(untimedKey)) {
      issues.push(`${path}.untimedControls[${index}] måste vara en förväntad kontroll utan split`);
    }
    untimedKeys.add(untimedKey);
  }
  const hasMissingExpectedSplit = expectedControls.some((control) =>
    !splitByKey.has(key(control.controlCode, control.occurrence)) && !untimedKeys.has(key(control.controlCode, control.occurrence)));
  if (result.status === "OK" && hasMissingExpectedSplit && !manualApprovalProofValid) {
    issues.push(`${path} med status OK måste ha en split för varje förväntad kontroll eller ett giltigt manualApprovalProof`);
  }

  return { ...(startTime ? { startTime } : {}), ...(finishTime ? { finishTime } : {}), splitByKey, untimedKeys };
}

/** Person, klubb och Result. `team` ger stafettens TeamMemberResult (sträcka, sträckplacering, lagets OverallResult). */
export function serializeResult(
  lines: string[],
  result: IofResultListPersonResult,
  validated: ValidatedResult,
  team?: { readonly indent: number; readonly leg: number; readonly legOrder?: number; readonly overall?: IofResultListTeamResult }
): void {
  const base = team?.indent ?? 2;
  line(lines, base, team ? "<TeamMemberResult>" : "<PersonResult>");
  if (result.entryExternalId !== undefined && !team) {
    line(lines, base + 1, `<EntryId>${escapeXml(result.entryExternalId)}</EntryId>`);
  }
  line(lines, base + 1, "<Person>");
  if (result.personEventorId !== undefined) line(lines, base + 2, `<Id type="Eventor">${escapeXml(result.personEventorId)}</Id>`);
  line(lines, base + 2, "<Name>");
  line(lines, base + 3, `<Family>${escapeXml(result.familyName)}</Family>`);
  line(lines, base + 3, `<Given>${escapeXml(result.givenName)}</Given>`);
  line(lines, base + 2, "</Name>");
  line(lines, base + 1, "</Person>");
  if (result.organisationName !== undefined || result.organisationEventorId !== undefined) {
    line(lines, base + 1, "<Organisation>");
    if (result.organisationEventorId !== undefined) {
      line(lines, base + 2, `<Id type="Eventor">${escapeXml(result.organisationEventorId)}</Id>`);
    }
    if (result.organisationName !== undefined) line(lines, base + 2, `<Name>${escapeXml(result.organisationName)}</Name>`);
    line(lines, base + 1, "</Organisation>");
  }
  line(lines, base + 1, "<Result>");
  if (team) line(lines, base + 2, `<Leg>${team.leg}</Leg>`);
  if (team?.legOrder !== undefined) line(lines, base + 2, `<LegOrder>${team.legOrder}</LegOrder>`);
  if (validated.startTime) line(lines, base + 2, `<StartTime>${validated.startTime}</StartTime>`);
  if (validated.finishTime) line(lines, base + 2, `<FinishTime>${validated.finishTime}</FinishTime>`);
  if (result.elapsedMs !== undefined) {
    line(lines, base + 2, `<Time>${millisecondsToSeconds(result.elapsedMs)}</Time>`);
  }
  if (result.timeBehindMs !== undefined && result.position !== undefined) {
    const type = team ? ' type="Leg"' : "";
    line(lines, base + 2, `<TimeBehind${type}>${millisecondsToSeconds(result.timeBehindMs)}</TimeBehind>`);
    line(lines, base + 2, `<Position${type}>${result.position}</Position>`);
  } else if (result.position !== undefined && result.scores !== undefined) {
    line(lines, base + 2, `<Position>${result.position}</Position>`);
  }
  line(lines, base + 2, `<Status>${iofStatus(result.status)}</Status>`);
  // IOF 3.0: Score kommer efter Status.
  if (result.status !== "DNF") for (const score of result.scores ?? []) {
    line(lines, base + 2, `<Score type="${escapeXml(score.type)}">${score.value}</Score>`);
  }
  const overall = team?.overall;
  if (overall) {
    line(lines, base + 2, "<OverallResult>");
    if (overall.elapsedMs !== undefined) line(lines, base + 3, `<Time>${millisecondsToSeconds(overall.elapsedMs)}</Time>`);
    if (overall.timeBehindMs !== undefined && overall.position !== undefined) {
      line(lines, base + 3, `<TimeBehind>${millisecondsToSeconds(overall.timeBehindMs)}</TimeBehind>`);
      line(lines, base + 3, `<Position>${overall.position}</Position>`);
    }
    line(lines, base + 3, `<Status>${iofStatus(overall.status)}</Status>`);
    line(lines, base + 2, "</OverallResult>");
  }
  // IOF 3.0: Course efter OverallResult och före SplitTime.
  if (result.status !== "DNF") serializeCourse(lines, base + 2, result.course);
  for (const control of result.expectedControls ?? []) {
    const split = validated.splitByKey.get(key(control.controlCode, control.occurrence));
    if (!split && validated.untimedKeys?.has(key(control.controlCode, control.occurrence))) {
      // Stämplad men utan giltig tid: SplitTime utan Time (IOF 3.0 tillåter det).
      line(lines, base + 2, '<SplitTime status="OK">');
      line(lines, base + 3, `<ControlCode>${control.controlCode}</ControlCode>`);
      line(lines, base + 2, "</SplitTime>");
      continue;
    }
    if (!split) {
      line(lines, base + 2, '<SplitTime status="Missing">');
      line(lines, base + 3, `<ControlCode>${control.controlCode}</ControlCode>`);
      line(lines, base + 2, "</SplitTime>");
      continue;
    }
    line(lines, base + 2, '<SplitTime status="OK">');
    line(lines, base + 3, `<ControlCode>${control.controlCode}</ControlCode>`);
    line(lines, base + 3, `<Time>${millisecondsToSeconds(split.elapsedMs)}</Time>`);
    line(lines, base + 2, "</SplitTime>");
  }
  // IOF 3.0: ControlCard efter SplitTime (och Route).
  if (result.cardNumber !== undefined) {
    line(lines, base + 2, `<ControlCard punchingSystem="SI">${escapeXml(result.cardNumber)}</ControlCard>`);
  }
  line(lines, base + 1, "</Result>");
  line(lines, base, team ? "</TeamMemberResult>" : "</PersonResult>");
}
