const IOF_NAMESPACE = "http://www.orienteering.org/datastandard/3.0";
const MAX_CLASSES = 1_000;
const MAX_RESULTS = 10_000;
const MAX_EXPECTED_CONTROLS = 256;

export type IofResultListStatus = "OK" | "MP" | "DSQ" | "DNF" | "OOC" | "DNS";

export interface IofResultListExpectedControl {
  readonly controlCode: number;
  readonly occurrence: number;
}

export interface IofResultListSplit {
  readonly controlCode: number;
  readonly occurrence: number;
  readonly elapsedMs: number;
}

export interface IofResultListManualApprovalProof {
  /** Internal approval-decision identity; never written to the IOF document. */
  readonly decisionId: string;
  /** Exact technical result revision approved by the decision; never serialized. */
  readonly targetResultRevisionId: string;
}

interface IofResultListPersonResultBase {
  readonly entryExternalId?: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organisationName?: string;
}

export interface IofResultListEvaluatedPersonResult extends IofResultListPersonResultBase {
  readonly status: Exclude<IofResultListStatus, "DNF" | "OOC">;
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly elapsedMs?: number;
  /** Already-derived individual ranking; serialized only as a complete pair for OK. */
  readonly position?: number;
  readonly timeBehindMs?: number;
  readonly expectedControls: readonly IofResultListExpectedControl[];
  readonly splits: readonly IofResultListSplit[];
  /**
   * Internal proof for an approved OK projection whose source has a missing
   * expected split. It is runtime-validated and intentionally never emitted.
   */
  readonly manualApprovalProof?: IofResultListManualApprovalProof;
}

/** OOC preserves technical timing/control facts but can never carry ranking or an approval proof. */
export interface IofResultListOutOfCompetitionPersonResult extends IofResultListPersonResultBase {
  readonly status: "OOC";
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly elapsedMs?: number;
  readonly position?: never;
  readonly timeBehindMs?: never;
  readonly expectedControls: readonly IofResultListExpectedControl[];
  readonly splits: readonly IofResultListSplit[];
  readonly manualApprovalProof?: never;
}

/** A strict status-only projection: no course, timing, ranking or proof data may cross the adapter. */
export interface IofResultListDidNotFinishPersonResult extends IofResultListPersonResultBase {
  readonly status: "DNF";
  readonly startTime?: never;
  readonly finishTime?: never;
  readonly elapsedMs?: never;
  readonly position?: never;
  readonly timeBehindMs?: never;
  readonly expectedControls?: never;
  readonly splits?: never;
  readonly manualApprovalProof?: never;
}

export type IofResultListPersonResult =
  | IofResultListEvaluatedPersonResult
  | IofResultListOutOfCompetitionPersonResult
  | IofResultListDidNotFinishPersonResult;

export interface IofResultListClass {
  readonly className: string;
  readonly classExternalId?: string;
  readonly results: readonly IofResultListPersonResult[];
}

export interface IofResultListFinalizationProof {
  /** Internal finalization identity; never written to the IOF document. */
  readonly finalizationId: string;
  /** Scope-local immutable finalization revision. */
  readonly revision: number;
  /** Canonical SHA-256 of the immutable finalization source. */
  readonly sourceHash: string;
}

interface IofResultListProjectionBase {
  readonly eventName: string;
  readonly classes: readonly IofResultListClass[];
}

export interface IofResultListSnapshotProjection extends IofResultListProjectionBase {
  readonly status: "Snapshot";
}

export interface IofResultListCompleteProjection extends IofResultListProjectionBase {
  readonly status: "Complete";
  readonly finalizationProof: IofResultListFinalizationProof;
}

export type IofResultListProjection =
  | IofResultListSnapshotProjection
  | IofResultListCompleteProjection;

export class IofResultListSerializationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Ogiltig IOF ResultList-projektion: ${issues.join("; ")}`);
    this.name = "IofResultListSerializationError";
    this.issues = issues;
  }
}

function isXml10CodePoint(codePoint: number): boolean {
  return codePoint === 0x09
    || codePoint === 0x0a
    || codePoint === 0x0d
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
}

function validateXmlText(value: string, path: string, issues: string[]): void {
  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) {
        issues.push(`${path} innehåller ett oparat UTF-16-surrogat`);
        return;
      }
      const codePoint = ((first - 0xd800) * 0x400) + second - 0xdc00 + 0x10000;
      if (!isXml10CodePoint(codePoint)) {
        issues.push(`${path} innehåller en kodpunkt som inte är tillåten i XML 1.0`);
        return;
      }
      index += 1;
      continue;
    }
    if (first >= 0xdc00 && first <= 0xdfff) {
      issues.push(`${path} innehåller ett oparat UTF-16-surrogat`);
      return;
    }
    if (!isXml10CodePoint(first)) {
      issues.push(`${path} innehåller en kodpunkt som inte är tillåten i XML 1.0`);
      return;
    }
  }
}

function validateText(value: unknown, path: string, issues: string[]): value is string {
  if (typeof value !== "string") {
    issues.push(`${path} måste vara text`);
    return false;
  }
  if (value.trim().length === 0) {
    issues.push(`${path} får inte vara tom`);
    return false;
  }
  validateXmlText(value, path, issues);
  return true;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "\"": return "&quot;";
      default: return "&apos;";
    }
  });
}

function validateMilliseconds(value: unknown, path: string, issues: string[]): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${path} måste vara ett icke-negativt heltal i millisekunder`);
    return false;
  }
  return true;
}

function millisecondsToSeconds(value: number): string {
  const whole = Math.floor(value / 1_000);
  const remainder = value % 1_000;
  if (remainder === 0) return String(whole);
  return `${whole}.${String(remainder).padStart(3, "0").replace(/0+$/, "")}`;
}

function normalizedUtcInstant(value: string, path: string, issues: string[]): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) {
    issues.push(`${path} måste vara en ISO 8601-tid med explicit UTC-zon`);
    return undefined;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const calendarValid = calendar.getUTCFullYear() === year
    && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day;
  const offsetValid = offsetHour <= 14 && offsetMinute <= 59 && (offsetHour < 14 || offsetMinute === 0);
  if (!calendarValid || hour > 23 || minute > 59 || second > 59 || !offsetValid) {
    issues.push(`${path} är en ogiltig ISO 8601-tid`);
    return undefined;
  }
  const epochMs = Date.parse(value);
  if (!Number.isFinite(epochMs)) {
    issues.push(`${path} är en ogiltig ISO 8601-tid`);
    return undefined;
  }
  return new Date(epochMs).toISOString();
}

function key(controlCode: number, occurrence: number): string {
  return `${controlCode}:${occurrence}`;
}

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sourceHashPattern = /^[a-f0-9]{64}$/;

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

function validateFinalizationProof(value: unknown, issues: string[]): void {
  const path = "finalizationProof";
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    issues.push(`${path} måste vara ett objekt`);
    return;
  }
  const proof = value as Record<string, unknown>;
  for (const property of Object.keys(proof)) {
    if (property !== "finalizationId" && property !== "revision" && property !== "sourceHash") {
      issues.push(`${path}.${property} är inte tillåten`);
    }
  }
  if (typeof proof.finalizationId !== "string" || !canonicalUuidPattern.test(proof.finalizationId)) {
    issues.push(`${path}.finalizationId måste vara ett kanoniskt gemener-UUID`);
  }
  if (typeof proof.revision !== "number"
    || !Number.isSafeInteger(proof.revision)
    || proof.revision <= 0) {
    issues.push(`${path}.revision måste vara ett positivt säkert heltal`);
  }
  if (typeof proof.sourceHash !== "string" || !sourceHashPattern.test(proof.sourceHash)) {
    issues.push(`${path}.sourceHash måste vara exakt 64 hextecken i gemener`);
  }
}

interface ValidatedResult {
  readonly startTime?: string;
  readonly finishTime?: string;
  readonly splitByKey: ReadonlyMap<string, IofResultListSplit>;
}

function validateResult(
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
  if (result.status !== "OK" && result.status !== "MP" &&
      result.status !== "DSQ" && result.status !== "DNF" &&
      result.status !== "OOC" && result.status !== "DNS") {
    issues.push(`${path}.status måste vara OK, MP, DSQ, DNF, OOC eller DNS`);
  }

  if (result.status === "DNF") {
    const forbidden = [
      "startTime",
      "finishTime",
      "elapsedMs",
      "position",
      "timeBehindMs",
      "expectedControls",
      "splits",
      "manualApprovalProof"
    ];
    for (const property of forbidden) {
      if (Object.prototype.hasOwnProperty.call(result, property)) {
        issues.push(`${path} med status DNF måste vara status-only utan ${property}`);
      }
    }
    return { splitByKey: new Map() };
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
  if (positionProvided !== timeBehindProvided) {
    issues.push(`${path}.position och ${path}.timeBehindMs måste anges tillsammans`);
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
  if (result.status === "OK" && (!startTime || !finishTime || !elapsedValid)) {
    issues.push(`${path} med status OK måste ha startTime, finishTime och elapsedMs`);
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
  if (result.status === "OOC" && result.elapsedMs === undefined && splits.length !== 0) {
    issues.push(`${path} med status OOC får inte ha splits utan elapsedMs`);
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
  const hasMissingExpectedSplit = expectedControls.some((control) =>
    !splitByKey.has(key(control.controlCode, control.occurrence)));
  if (result.status === "OK" && hasMissingExpectedSplit && !manualApprovalProofValid) {
    issues.push(`${path} med status OK måste ha en split för varje förväntad kontroll eller ett giltigt manualApprovalProof`);
  }

  return { ...(startTime ? { startTime } : {}), ...(finishTime ? { finishTime } : {}), splitByKey };
}

function line(lines: string[], indentation: number, value: string): void {
  lines.push(`${"  ".repeat(indentation)}${value}`);
}

function serializeResult(
  lines: string[],
  result: IofResultListPersonResult,
  validated: ValidatedResult
): void {
  line(lines, 2, "<PersonResult>");
  if (result.entryExternalId !== undefined) {
    line(lines, 3, `<EntryId>${escapeXml(result.entryExternalId)}</EntryId>`);
  }
  line(lines, 3, "<Person>");
  line(lines, 4, "<Name>");
  line(lines, 5, `<Family>${escapeXml(result.familyName)}</Family>`);
  line(lines, 5, `<Given>${escapeXml(result.givenName)}</Given>`);
  line(lines, 4, "</Name>");
  line(lines, 3, "</Person>");
  if (result.organisationName !== undefined) {
    line(lines, 3, "<Organisation>");
    line(lines, 4, `<Name>${escapeXml(result.organisationName)}</Name>`);
    line(lines, 3, "</Organisation>");
  }
  line(lines, 3, "<Result>");
  if (validated.startTime) line(lines, 4, `<StartTime>${validated.startTime}</StartTime>`);
  if (validated.finishTime) line(lines, 4, `<FinishTime>${validated.finishTime}</FinishTime>`);
  if (result.elapsedMs !== undefined) {
    line(lines, 4, `<Time>${millisecondsToSeconds(result.elapsedMs)}</Time>`);
  }
  if (result.timeBehindMs !== undefined && result.position !== undefined) {
    line(lines, 4, `<TimeBehind>${millisecondsToSeconds(result.timeBehindMs)}</TimeBehind>`);
    line(lines, 4, `<Position>${result.position}</Position>`);
  }
  const iofStatus = result.status === "OK"
    ? "OK"
    : result.status === "MP"
      ? "MissingPunch"
      : result.status === "DSQ"
        ? "Disqualified"
        : result.status === "DNF"
          ? "DidNotFinish"
          : result.status === "OOC"
            ? "NotCompeting"
            : "DidNotStart";
  line(lines, 4, `<Status>${iofStatus}</Status>`);
  if (result.status !== "DNF") for (const control of result.expectedControls) {
    const split = validated.splitByKey.get(key(control.controlCode, control.occurrence));
    if (!split) {
      line(lines, 4, '<SplitTime status="Missing">');
      line(lines, 5, `<ControlCode>${control.controlCode}</ControlCode>`);
      line(lines, 4, "</SplitTime>");
      continue;
    }
    line(lines, 4, '<SplitTime status="OK">');
    line(lines, 5, `<ControlCode>${control.controlCode}</ControlCode>`);
    line(lines, 5, `<Time>${millisecondsToSeconds(split.elapsedMs)}</Time>`);
    line(lines, 4, "</SplitTime>");
  }
  line(lines, 3, "</Result>");
  line(lines, 2, "</PersonResult>");
}

export function serializeIofResultList(projection: IofResultListProjection): Uint8Array {
  const issues: string[] = [];
  if (typeof projection !== "object" || projection === null || Array.isArray(projection)) {
    throw new IofResultListSerializationError(["projektionen måste vara ett objekt"]);
  }
  if (projection.status !== "Snapshot" && projection.status !== "Complete") {
    issues.push("status måste vara Snapshot eller Complete");
  } else if (projection.status === "Snapshot") {
    if (Object.prototype.hasOwnProperty.call(projection, "finalizationProof")) {
      issues.push("Snapshot får inte ha finalizationProof");
    }
  } else {
    if (!Object.prototype.hasOwnProperty.call(projection, "finalizationProof")) {
      issues.push("Complete kräver finalizationProof");
    } else {
      validateFinalizationProof(projection.finalizationProof, issues);
    }
  }
  validateText(projection.eventName, "eventName", issues);
  if (!Array.isArray(projection.classes)) {
    throw new IofResultListSerializationError(["classes måste vara en lista"]);
  }
  const classes: readonly IofResultListClass[] = projection.classes;
  if (classes.length > MAX_CLASSES) {
    issues.push(`classes får innehålla högst ${MAX_CLASSES} klasser`);
  }

  let resultCount = 0;
  const validatedResults = new Map<IofResultListPersonResult, ValidatedResult>();
  for (const [classIndex, raceClass] of classes.entries()) {
    const classPath = `classes[${classIndex}]`;
    validateText(raceClass.className, `${classPath}.className`, issues);
    if (raceClass.classExternalId !== undefined) {
      validateText(raceClass.classExternalId, `${classPath}.classExternalId`, issues);
    }
    if (!Array.isArray(raceClass.results)) {
      issues.push(`${classPath}.results måste vara en lista`);
      continue;
    }
    const results: readonly IofResultListPersonResult[] = raceClass.results;
    resultCount += results.length;
    for (const [resultIndex, result] of results.entries()) {
      const validated = validateResult(result, `${classPath}.results[${resultIndex}]`, issues);
      validatedResults.set(result, validated);
    }
  }
  if (resultCount > MAX_RESULTS) issues.push(`projektionen får innehålla högst ${MAX_RESULTS} resultat`);
  if (issues.length > 0) throw new IofResultListSerializationError(issues);

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  lines.push(`<ResultList xmlns="${IOF_NAMESPACE}" iofVersion="3.0" creator="O-Tid" status="${projection.status}">`);
  line(lines, 1, "<Event>");
  line(lines, 2, `<Name>${escapeXml(projection.eventName)}</Name>`);
  line(lines, 1, "</Event>");
  for (const raceClass of classes) {
    line(lines, 1, '<ClassResult timeResolution="0.001">');
    line(lines, 2, "<Class>");
    if (raceClass.classExternalId !== undefined) {
      line(lines, 3, `<Id>${escapeXml(raceClass.classExternalId)}</Id>`);
    }
    line(lines, 3, `<Name>${escapeXml(raceClass.className)}</Name>`);
    line(lines, 2, "</Class>");
    for (const result of raceClass.results) {
      serializeResult(lines, result, validatedResults.get(result)!);
    }
    line(lines, 1, "</ClassResult>");
  }
  lines.push("</ResultList>");
  return new TextEncoder().encode(`${lines.join("\n")}\n`);
}
