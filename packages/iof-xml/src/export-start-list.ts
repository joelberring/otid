const IOF_NAMESPACE = "http://www.orienteering.org/datastandard/3.0";
const MAX_CLASSES = 1_000;
const MAX_STARTS = 10_000;

export interface IofStartListPersonStart {
  readonly givenName: string;
  readonly familyName: string;
  readonly organisationName?: string;
  readonly startTime?: string;
}

export interface IofStartListClass {
  readonly className: string;
  readonly startRule: "FIXED" | "PUNCH";
  readonly starts: readonly IofStartListPersonStart[];
}

export interface IofStartListProjection {
  readonly eventName: string;
  readonly classes: readonly IofStartListClass[];
}

export class IofStartListSerializationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Ogiltig IOF StartList-projektion: ${issues.join("; ")}`);
    this.name = "IofStartListSerializationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issues.push(`${path}.${key} är inte tillåten`);
  }
}

function isXml10CodePoint(codePoint: number): boolean {
  return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d
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
      if (!isXml10CodePoint(codePoint)) issues.push(`${path} innehåller en kodpunkt som inte är tillåten i XML 1.0`);
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      issues.push(`${path} innehåller ett oparat UTF-16-surrogat`);
      return;
    } else if (!isXml10CodePoint(first)) {
      issues.push(`${path} innehåller en kodpunkt som inte är tillåten i XML 1.0`);
      return;
    }
  }
}

function validateText(value: unknown, path: string, maximum: number, issues: string[]): value is string {
  if (typeof value !== "string") {
    issues.push(`${path} måste vara text`);
    return false;
  }
  if (value.trim().length === 0) issues.push(`${path} får inte vara tom`);
  if (value.length > maximum) issues.push(`${path} får vara högst ${maximum} tecken`);
  validateXmlText(value, path, issues);
  return value.trim().length > 0 && value.length <= maximum;
}

function normalizedUtcInstant(value: string, path: string, issues: string[]): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) {
    issues.push(`${path} måste vara en ISO 8601-tid med explicit UTC-zon och högst millisekundprecision`);
    return undefined;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const calendarValid = calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day;
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

function line(lines: string[], indentation: number, value: string): void {
  lines.push(`${"  ".repeat(indentation)}${value}`);
}

interface ValidatedStart {
  readonly givenName: string;
  readonly familyName: string;
  readonly organisationName?: string;
  readonly startTime?: string;
}

function validateStart(value: unknown, path: string, issues: string[]): ValidatedStart {
  if (!isRecord(value)) {
    issues.push(`${path} måste vara ett objekt`);
    return { givenName: "", familyName: "" };
  }
  rejectUnknownKeys(value, ["givenName", "familyName", "organisationName", "startTime"], path, issues);
  validateText(value.givenName, `${path}.givenName`, 160, issues);
  validateText(value.familyName, `${path}.familyName`, 160, issues);
  if (value.organisationName !== undefined) validateText(value.organisationName, `${path}.organisationName`, 240, issues);
  let startTime: string | undefined;
  if (value.startTime !== undefined) {
    if (validateText(value.startTime, `${path}.startTime`, 160, issues)) {
      startTime = normalizedUtcInstant(value.startTime, `${path}.startTime`, issues);
    }
  }
  return {
    givenName: typeof value.givenName === "string" ? value.givenName : "",
    familyName: typeof value.familyName === "string" ? value.familyName : "",
    ...(typeof value.organisationName === "string" ? { organisationName: value.organisationName } : {}),
    ...(startTime ? { startTime } : {})
  };
}

/** Serializes the deliberately small, individual and single-race IOF StartList subset. */
export function serializeIofStartList(projection: IofStartListProjection): Uint8Array {
  const issues: string[] = [];
  if (!isRecord(projection)) {
    throw new IofStartListSerializationError(["projektionen måste vara ett objekt"]);
  }
  rejectUnknownKeys(projection, ["eventName", "classes"], "projection", issues);
  validateText(projection.eventName, "eventName", 160, issues);
  if (!Array.isArray(projection.classes)) {
    issues.push("classes måste vara en lista");
    throw new IofStartListSerializationError(issues);
  }
  if (projection.classes.length > MAX_CLASSES) issues.push(`classes får innehålla högst ${MAX_CLASSES} klasser`);

  const validated = projection.classes.map((raceClass, classIndex) => {
    const path = `classes[${classIndex}]`;
    if (!isRecord(raceClass)) {
      issues.push(`${path} måste vara ett objekt`);
      return { className: "", starts: [] as ValidatedStart[] };
    }
    rejectUnknownKeys(raceClass, ["className", "startRule", "starts"], path, issues);
    validateText(raceClass.className, `${path}.className`, 160, issues);
    if (raceClass.startRule !== "FIXED" && raceClass.startRule !== "PUNCH") {
      issues.push(`${path}.startRule måste vara FIXED eller PUNCH`);
    }
    if (!Array.isArray(raceClass.starts)) {
      issues.push(`${path}.starts måste vara en lista`);
      return { className: typeof raceClass.className === "string" ? raceClass.className : "", starts: [] as ValidatedStart[] };
    }
    const starts = raceClass.starts.map((start, startIndex) => {
      const checked = validateStart(start, `${path}.starts[${startIndex}]`, issues);
      if (raceClass.startRule === "PUNCH" && isRecord(start) && Object.prototype.hasOwnProperty.call(start, "startTime")) {
        issues.push(`${path}.starts[${startIndex}].startTime får inte anges för PUNCH`);
      }
      return checked;
    });
    return { className: typeof raceClass.className === "string" ? raceClass.className : "", starts };
  });
  const totalStarts = validated.reduce((total, raceClass) => total + raceClass.starts.length, 0);
  if (totalStarts === 0) issues.push("minst en PersonStart krävs");
  if (totalStarts > MAX_STARTS) issues.push(`starts får innehålla högst ${MAX_STARTS} deltagare`);
  if (issues.length > 0) throw new IofStartListSerializationError(issues);

  const lines = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<StartList xmlns="${IOF_NAMESPACE}" iofVersion="3.0" creator="O-Tid">`,
    "  <Event>",
    `    <Name>${escapeXml(projection.eventName)}</Name>`,
    "  </Event>"
  ];
  for (const raceClass of validated) {
    line(lines, 1, "<ClassStart>");
    line(lines, 2, "<Class>");
    line(lines, 3, `<Name>${escapeXml(raceClass.className)}</Name>`);
    line(lines, 2, "</Class>");
    for (const start of raceClass.starts) {
      line(lines, 2, "<PersonStart>");
      line(lines, 3, "<Person>");
      line(lines, 4, "<Name>");
      line(lines, 5, `<Family>${escapeXml(start.familyName)}</Family>`);
      line(lines, 5, `<Given>${escapeXml(start.givenName)}</Given>`);
      line(lines, 4, "</Name>");
      line(lines, 3, "</Person>");
      if (start.organisationName !== undefined) {
        line(lines, 3, "<Organisation>");
        line(lines, 4, `<Name>${escapeXml(start.organisationName)}</Name>`);
        line(lines, 3, "</Organisation>");
      }
      if (start.startTime) {
        line(lines, 3, "<Start>");
        line(lines, 4, `<StartTime>${start.startTime}</StartTime>`);
        line(lines, 3, "</Start>");
      } else {
        line(lines, 3, "<Start/>");
      }
      line(lines, 2, "</PersonStart>");
    }
    line(lines, 1, "</ClassStart>");
  }
  lines.push("</StartList>", "");
  return new TextEncoder().encode(lines.join("\n"));
}
