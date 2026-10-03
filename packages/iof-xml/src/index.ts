import { XMLParser, XMLValidator } from "fast-xml-parser";

export {
  IofResultListSerializationError,
  serializeIofResultList,
  type IofResultListClass,
  type IofResultListCompleteProjection,
  type IofResultListDidNotFinishPersonResult,
  type IofResultListOutOfCompetitionPersonResult,
  type IofResultListEvaluatedPersonResult,
  type IofResultListExpectedControl,
  type IofResultListFinalizationProof,
  type IofResultListManualApprovalProof,
  type IofResultListPersonResult,
  type IofResultListProjection,
  type IofResultListSplit,
  type IofResultListSnapshotProjection,
  type IofResultListStatus
} from "./export-result-list";

export {
  IofStartListSerializationError,
  serializeIofStartList,
  type IofStartListClass,
  type IofStartListPersonStart,
  type IofStartListProjection
} from "./export-start-list";

type XmlRecord = Record<string, unknown>;

export class IofValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Ogiltig IOF XML: ${issues.join("; ")}`);
    this.name = "IofValidationError";
    this.issues = issues;
  }
}

export interface CourseImport {
  readonly externalId: string;
  readonly name: string;
  readonly controlCodes: readonly number[];
}

export interface ClassCourseImport {
  readonly classExternalId: string;
  readonly className: string;
  readonly courseExternalId: string;
  readonly startRule: "FIXED" | "PUNCH";
}

export interface CourseDataImport {
  readonly kind: "CourseData";
  readonly courses: readonly CourseImport[];
  readonly assignments: readonly ClassCourseImport[];
  readonly warnings: readonly string[];
}

export interface EntryImport {
  readonly externalId: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly organisationName?: string;
  readonly classExternalId: string;
  readonly className: string;
  readonly cardNumber?: string;
  readonly fixedStartTime?: string;
}

export interface EntryListImport {
  readonly kind: "EntryList";
  readonly entries: readonly EntryImport[];
  readonly warnings: readonly string[];
}

export interface StartImport {
  readonly entryExternalId: string;
  readonly startTime: string;
}

export interface ClassStartImport {
  readonly classExternalId: string;
  readonly starts: readonly StartImport[];
}

export interface StartListImport {
  readonly kind: "StartList";
  readonly classes: readonly ClassStartImport[];
  readonly warnings: readonly string[];
}

export type IofImport = CourseDataImport | EntryListImport | StartListImport;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  processEntities: false,
  trimValues: true
});

const IOF_NAMESPACE = "http://www.orienteering.org/datastandard/3.0";
const FORBIDDEN_DECLARATION_PATTERN = /<!\s*(?:DTD|DOCTYPE|ENTITY)\b/i;

function record(value: unknown): XmlRecord {
  return typeof value === "object" && value !== null ? value as XmlRecord : {};
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const object = record(value);
  const nested = object["#text"] ?? object["_text"];
  return nested === undefined ? "" : text(nested);
}

function requireText(value: unknown, path: string, issues: string[]): string {
  const parsed = text(value);
  if (!parsed) issues.push(`${path} saknas`);
  return parsed;
}

function count(value: unknown): number {
  return array(value).length;
}

function rejectUnexpectedKeys(
  value: XmlRecord,
  allowed: readonly string[],
  path: string,
  issues: string[]
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) issues.push(`${path}.${key} ingår inte i stödd IOF XML 3.0-struktur`);
  }
}

function readCourseData(root: XmlRecord): CourseDataImport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const courses: CourseImport[] = [];
  const assignments: ClassCourseImport[] = [];

  for (const [raceIndex, rawRaceData] of array(root.RaceCourseData).entries()) {
    const raceData = record(rawRaceData);
    rejectUnexpectedKeys(
      raceData,
      ["Map", "Control", "Course", "ClassCourseAssignment", "PersonCourseAssignment", "TeamCourseAssignment", "Extensions", "@_raceNumber"],
      `RaceCourseData[${raceIndex}]`,
      issues
    );
    const controls = new Map<string, number>();
    for (const [index, rawControl] of array(raceData.Control).entries()) {
      const control = record(rawControl);
      const externalId = requireText(control.Id, `RaceCourseData[${raceIndex}].Control[${index}].Id`, issues);
      const controlType = text(control["@_type"] || "Control");
      const code = Number(externalId);
      if (controlType === "Control" && (!Number.isInteger(code) || code <= 0)) {
        issues.push(`RaceCourseData[${raceIndex}].Control[${index}].Id måste vara en positiv kontrollkod`);
      } else if (controlType === "Control") {
        controls.set(externalId, code);
      }
    }

    const raceCourses: CourseImport[] = array(raceData.Course).map((rawCourse, index) => {
      const course = record(rawCourse);
      const path = `RaceCourseData[${raceIndex}].Course[${index}]`;
      rejectUnexpectedKeys(
        course,
        ["Id", "Name", "CourseFamily", "Length", "Climb", "CourseControl", "MapId", "Extensions", "@_numberOfCompetitors", "@_modifyTime"],
        path,
        issues
      );
      const externalId = requireText(course.Id, `${path}.Id`, issues);
      const name = requireText(course.Name, `${path}.Name`, issues);
      const controlCodes = array(course.CourseControl)
        .map(record)
        .filter((courseControl) => text(courseControl["@_type"] || "Control") === "Control")
        .map((courseControl, controlIndex) => {
          const controlId = requireText(courseControl.Control, `${path}.CourseControl[${controlIndex}].Control`, issues);
          const code = controls.get(controlId);
          if (code === undefined) {
            issues.push(`${path} refererar okänd kontroll ${controlId}`);
            return 0;
          }
          return code;
        });
      if (controlCodes.length === 0) issues.push(`${path} saknar vanliga kontroller`);
      if (array(course.CourseControl).length < 2) issues.push(`${path} måste ha minst två CourseControl enligt IOF XML 3.0`);
      return { externalId, name, controlCodes };
    });
    courses.push(...raceCourses);

    for (const [index, rawAssignment] of array(raceData.ClassCourseAssignment).entries()) {
      const assignment = record(rawAssignment);
      const path = `RaceCourseData[${raceIndex}].ClassCourseAssignment[${index}]`;
      rejectUnexpectedKeys(
        assignment,
        ["ClassId", "ClassName", "AllowedOnLeg", "CourseName", "CourseFamily", "TeamMemberCourseAssignment", "Extensions"],
        path,
        issues
      );
      const className = requireText(assignment.ClassName, `${path}.ClassName`, issues);
      const classExternalId = text(assignment.ClassId) || className;
      const courseName = requireText(assignment.CourseName, `${path}.CourseName`, issues);
      const matchedCourse = raceCourses.find((course) => course.name === courseName);
      if (!matchedCourse) issues.push(`${path} refererar okänd bana ${courseName}`);
      assignments.push({
        classExternalId,
        className,
        courseExternalId: matchedCourse?.externalId ?? courseName,
        startRule: "PUNCH"
      });
    }
  }

  if (assignments.length > 0) {
    warnings.push("Startregel saknas i IOF CourseData 3.0; PUNCH används tills en separat StartList importeras");
  }

  if (courses.length === 0) issues.push("RaceCourseData.Course saknas");
  if (assignments.length === 0) warnings.push("Inga ClassCourseAssignment hittades");
  if (issues.length > 0) throw new IofValidationError(issues);
  return { kind: "CourseData", courses, assignments, warnings };
}

function readEntryList(root: XmlRecord): EntryListImport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const entries: EntryImport[] = array(root.PersonEntry).map((rawEntry, index) => {
    const entry = record(rawEntry);
    rejectUnexpectedKeys(
      entry,
      ["Id", "Person", "Organisation", "ControlCard", "Score", "Class", "RaceNumber", "AssignedFee", "ServiceRequest", "StartTimeAllocationRequest", "EntryTime", "Extensions", "@_modifyTime"],
      `PersonEntry[${index}]`,
      issues
    );
    const person = record(entry.Person);
    const name = record(person.Name);
    const classValue = record(array(entry.Class)[0]);
    const organisation = record(entry.Organisation);
    const externalId = requireText(entry.Id ?? person.Id, `PersonEntry[${index}].Id`, issues);
    const givenName = requireText(name.Given, `PersonEntry[${index}].Person.Name.Given`, issues);
    const familyName = requireText(name.Family, `PersonEntry[${index}].Person.Name.Family`, issues);
    const classExternalId = requireText(classValue.Id ?? classValue.Name, `PersonEntry[${index}].Class.Id`, issues);
    const className = text(classValue.Name) || classExternalId;
    const organisationName = text(organisation.Name);
    const cardNumber = text(array(entry.ControlCard)[0]);
    return {
      externalId,
      givenName,
      familyName,
      classExternalId,
      className,
      ...(organisationName ? { organisationName } : {}),
      ...(cardNumber ? { cardNumber } : {})
    };
  });
  if (entries.length === 0) issues.push("EntryList.PersonEntry saknas");
  if (issues.length > 0) throw new IofValidationError(issues);
  return { kind: "EntryList", entries, warnings };
}

function readStartTime(value: unknown, path: string, issues: string[]): string {
  const parsed = text(value);
  // XML Schema dateTime requires seconds.  Requiring an explicit zone here is
  // intentional: a local time cannot be safely mapped to the race snapshot.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(parsed);
  if (!match) {
    issues.push(`${path} måste vara en ISO 8601-tid med Z eller explicit UTC-offset`);
    return parsed;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zoneValue] = match;
  const zone = zoneValue ?? "";
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHours = zone === "Z" ? 0 : Number(zone.slice(1, 3));
  const offsetMinutes = zone === "Z" ? 0 : Number(zone.slice(4, 6));
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const calendarValid = calendar.getUTCFullYear() === year
    && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day;
  const offsetValid = zone === "Z"
    || (offsetHours <= 14 && offsetMinutes <= 59 && (offsetHours < 14 || offsetMinutes === 0));
  if (!calendarValid || hour > 23 || minute > 59 || second > 59 || !offsetValid || !Number.isFinite(Date.parse(parsed))) {
    issues.push(`${path} är en ogiltig ISO 8601-tid`);
    return parsed;
  }
  return new Date(parsed).toISOString();
}

function readStartList(root: XmlRecord): StartListImport {
  const issues: string[] = [];
  const warnings: string[] = [];
  const classStarts: ClassStartImport[] = [];
  const classIds = new Set<string>();
  const entryIds = new Set<string>();
  const classStartValues = array(root.ClassStart);

  if (classStartValues.length === 0) issues.push("StartList.ClassStart saknas");
  if (classStartValues.length > 500) issues.push("StartList får innehålla högst 500 ClassStart");
  if (count(root.TeamStart) > 0) issues.push("StartList.TeamStart stöds inte");

  const eventValues = array(root.Event);
  if (eventValues.length !== 1) issues.push("StartList.Event måste förekomma exakt en gång");
  const event = record(eventValues[0]);
  rejectUnexpectedKeys(
    event,
    ["Id", "Name", "StartTime", "EndTime", "Status", "Classification", "Position", "Map", "Race", "Extensions"],
    "StartList.Event",
    issues
  );
  if (count(event.Race) > 1) issues.push("StartList.Event får innehålla högst ett Race");

  let totalStarts = 0;
  for (const [classIndex, rawClassStart] of classStartValues.entries()) {
    const classStart = record(rawClassStart);
    const classPath = `ClassStart[${classIndex}]`;
    rejectUnexpectedKeys(
      classStart,
      ["Class", "Course", "StartName", "PersonStart", "TeamStart", "Extensions", "@_timeResolution", "@_modifyTime"],
      classPath,
      issues
    );
    if (count(classStart.TeamStart) > 0) issues.push(`${classPath}.TeamStart stöds inte`);

    const classValues = array(classStart.Class);
    if (classValues.length !== 1) {
      issues.push(`${classPath}.Class måste förekomma exakt en gång`);
    }
    const classValue = record(classValues[0]);
    rejectUnexpectedKeys(classValue, ["Id", "Name", "ShortName", "LongName", "Extensions", "@_modifyTime"], `${classPath}.Class`, issues);
    const classExternalId = requireText(classValue.Id, `${classPath}.Class.Id`, issues);
    if (classExternalId && classIds.has(classExternalId)) issues.push(`${classPath}.Class.Id ${classExternalId} förekommer flera gånger`);
    if (classExternalId) classIds.add(classExternalId);

    const personValues = array(classStart.PersonStart);
    if (personValues.length === 0) issues.push(`${classPath}.PersonStart saknas`);
    const starts: StartImport[] = [];
    for (const [personIndex, rawPersonStart] of personValues.entries()) {
      const personStart = record(rawPersonStart);
      const personPath = `${classPath}.PersonStart[${personIndex}]`;
      rejectUnexpectedKeys(personStart, ["EntryId", "Person", "Organisation", "Start", "Extensions", "@_modifyTime"], personPath, issues);
      const entryExternalId = requireText(personStart.EntryId, `${personPath}.EntryId`, issues);
      if (entryExternalId && entryIds.has(entryExternalId)) issues.push(`${personPath}.EntryId ${entryExternalId} förekommer flera gånger`);
      if (entryExternalId) entryIds.add(entryExternalId);

      const startValues = array(personStart.Start);
      if (startValues.length !== 1) {
        issues.push(`${personPath}.Start måste förekomma exakt en gång`);
      }
      const start = record(startValues[0]);
      rejectUnexpectedKeys(
        start,
        ["BibNumber", "StartTime", "Course", "ControlCard", "AssignedFee", "ServiceRequest", "Extensions", "@_raceNumber", "@_modifyTime"],
        `${personPath}.Start`,
        issues
      );
      const raceNumber = text(start["@_raceNumber"]);
      if (raceNumber && raceNumber !== "1") issues.push(`${personPath}.Start raceNumber måste saknas eller vara 1`);
      const startTimeValues = array(start.StartTime);
      if (startTimeValues.length !== 1) issues.push(`${personPath}.Start.StartTime måste förekomma exakt en gång`);
      const startTime = readStartTime(startTimeValues[0], `${personPath}.Start.StartTime`, issues);
      starts.push({ entryExternalId, startTime });
    }
    totalStarts += personValues.length;
    if (classExternalId) classStarts.push({ classExternalId, starts });
  }
  if (totalStarts === 0) issues.push("StartList saknar individuella starter");
  if (totalStarts > 10_000) issues.push("StartList får innehålla högst 10 000 PersonStart");
  if (issues.length > 0) throw new IofValidationError(issues);
  return { kind: "StartList", classes: classStarts, warnings };
}

export function parseIofXml(xml: string): IofImport {
  if (FORBIDDEN_DECLARATION_PATTERN.test(xml)) {
    throw new IofValidationError(["DTD, DOCTYPE och ENTITY-deklarationer stöds inte"]);
  }
  const syntax = XMLValidator.validate(xml);
  if (syntax !== true) throw new IofValidationError([syntax.err.msg]);
  const document = record(parser.parse(xml));
  const rootName = document.CourseData
    ? "CourseData"
    : document.EntryList
      ? "EntryList"
      : document.StartList
        ? "StartList"
        : undefined;
  if (!rootName) throw new IofValidationError(["Roten måste vara CourseData, EntryList eller StartList"]);
  const root = record(document[rootName]);
  const namespace = text(root["@_xmlns"]);
  if (namespace !== IOF_NAMESPACE) {
    throw new IofValidationError([`XML-namnrymden måste vara ${IOF_NAMESPACE}`]);
  }
  const version = text(root["@_iofVersion"]);
  if (version !== "3.0") throw new IofValidationError([`iofVersion ${version || "saknas"} stöds inte`]);
  const rootIssues: string[] = [];
  const commonRootKeys = ["@_xmlns", "@_xmlns:xsi", "@_xsi:schemaLocation", "@_iofVersion", "@_createTime", "@_creator"];
  rejectUnexpectedKeys(
    root,
    rootName === "CourseData"
      ? [...commonRootKeys, "Event", "RaceCourseData", "Extensions"]
      : rootName === "EntryList"
        ? [...commonRootKeys, "Event", "TeamEntry", "PersonEntry", "Extensions"]
        : [...commonRootKeys, "Event", "ClassStart", "Extensions"],
    rootName,
    rootIssues
  );
  const eventName = text(record(root.Event).Name);
  if (!eventName) rootIssues.push(`${rootName}.Event.Name saknas`);
  if (rootIssues.length > 0) throw new IofValidationError(rootIssues);
  if (rootName === "CourseData") return readCourseData(root);
  if (rootName === "EntryList") return readEntryList(root);
  return readStartList(root);
}
