/** Gemensamt för IOF ResultList: kontroll av text och tider, XML-skydd, statusen och banan (SimpleCourse). */
import type { IofResultListCourse, IofResultListTeamStatus } from "./result-list-types";

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

export function validateText(value: unknown, path: string, issues: string[]): value is string {
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

export function escapeXml(value: string): string {
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

export function validateMilliseconds(value: unknown, path: string, issues: string[]): value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${path} måste vara ett icke-negativt heltal i millisekunder`);
    return false;
  }
  return true;
}

export function millisecondsToSeconds(value: number): string {
  const whole = Math.floor(value / 1_000);
  const remainder = value % 1_000;
  if (remainder === 0) return String(whole);
  return `${whole}.${String(remainder).padStart(3, "0").replace(/0+$/, "")}`;
}

export function normalizedUtcInstant(value: string, path: string, issues: string[]): string | undefined {
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

export function key(controlCode: number, occurrence: number): string {
  return `${controlCode}:${occurrence}`;
}

export const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function validateCourse(course: IofResultListCourse, path: string, issues: string[]): void {
  if (course.name !== undefined) validateText(course.name, `${path}.name`, issues);
  if (course.lengthMeters !== undefined && (!Number.isSafeInteger(course.lengthMeters) || course.lengthMeters <= 0)) {
    issues.push(`${path}.lengthMeters måste vara ett positivt heltal`);
  }
  if (course.climbMeters !== undefined && (!Number.isSafeInteger(course.climbMeters) || course.climbMeters < 0)) {
    issues.push(`${path}.climbMeters måste vara ett icke-negativt heltal`);
  }
}

/** IOF 3.0 SimpleCourse: Name, Length, Climb i den ordningen. Inget skrivs för en tom bana. */
export function serializeCourse(lines: string[], indentation: number, course: IofResultListCourse | undefined): void {
  if (!course || (course.name === undefined && course.lengthMeters === undefined && course.climbMeters === undefined)) return;
  line(lines, indentation, "<Course>");
  if (course.name !== undefined) line(lines, indentation + 1, `<Name>${escapeXml(course.name)}</Name>`);
  if (course.lengthMeters !== undefined) line(lines, indentation + 1, `<Length>${course.lengthMeters}</Length>`);
  if (course.climbMeters !== undefined) line(lines, indentation + 1, `<Climb>${course.climbMeters}</Climb>`);
  line(lines, indentation, "</Course>");
}

export function line(lines: string[], indentation: number, value: string): void {
  lines.push(`${"  ".repeat(indentation)}${value}`);
}

export function iofStatus(status: IofResultListTeamStatus): string {
  switch (status) {
    case "OK": return "OK";
    case "OVERTIME": return "OverTime";
    case "MP": return "MissingPunch";
    case "DSQ": return "Disqualified";
    case "DNF": return "DidNotFinish";
    case "OOC": return "NotCompeting";
    case "DNS": return "DidNotStart";
    case "Active": return "Active";
  }
}
