/**
 * Läser Purple Pens händelsefil (.ppen). Elementen och attributen följer EventDB.cs i Purple Pen (BSD, Peter Golde):
 * det som modellen tolkar läses in, resten sparas i `raw` och skrivs tillbaka. Det som Purple Pen själv inte kan läsa
 * (okända slag, saknade obligatoriska attribut, länkar till sådant som inte finns) ger `CourseSettingEditError("INVALID")`.
 */
import type { Point } from "@o-tid/map-file";
import {
  CONTROL_KINDS, FLAGGING_KINDS, LABEL_KINDS, MAP_STANDARDS, ROOT, SPECIAL_KINDS, decodeCircleGaps, decodeOldCircleGaps,
  invalid, legKey, parseBool, parseInteger, parseNumber, stub, toRaw
} from "./ppen-common";
import type {
  CircleGap, ControlPoint, Course, CourseControl, CourseRelayOptions, CourseSettingDocument, DescriptionBox, Leg,
  PpenReadWarning, RawXml, SpecialObject
} from "./types";
import { enumerateCourseControls } from "./walk";
import { attr, childElements, parseXml, textOf, type XmlElement } from "./xml";

class Warnings {
  private readonly byCode = new Map<string, { count: number; text: string }>();
  add(code: string, text: string): void {
    const found = this.byCode.get(code);
    if (found) found.count++;
    else this.byCode.set(code, { count: 1, text });
  }
  list(): PpenReadWarning[] {
    return [...this.byCode].map(([code, { count, text }]) => ({ code, count, text }));
  }
}

const required = (element: XmlElement, name: string): string => {
  const value = attr(element, name);
  if (value === undefined) throw invalid(`<${element.name}> saknar ${name}`);
  return value;
};

const point = (element: XmlElement): Point => ({
  x: parseNumber(required(element, "x"), `${element.name} x`),
  y: parseNumber(required(element, "y"), `${element.name} y`)
});

/** Läs en .ppen. */
export function readPpenDocument(xml: string): { readonly document: CourseSettingDocument; readonly warnings: readonly PpenReadWarning[] } {
  const parsed = parseXml(xml);
  const root = parsed.root;
  if (root.name !== ROOT) throw invalid(`rotelementet är <${root.name}>, inte <${ROOT}>`);
  const warnings = new Warnings();
  if (parsed.comments > 0) for (let i = 0; i < parsed.comments; i++) warnings.add("XML_COMMENT", "XML-kommentarer tas inte med när filen skrivs");

  const raw: RawXml[] = [];
  const rootStub = stub(root, [], false, true);
  if (rootStub) raw.push(rootStub);
  let event: CourseSettingDocument["event"] | undefined;
  const controls: Record<string, ControlPoint> = {};
  const courses: Course[] = [];
  const courseControls: Record<string, CourseControl> = {};
  const numberDeltas = new Map<string, Point>();
  const legs: Record<string, Leg> = {};
  const specialObjects: SpecialObject[] = [];
  const seen = new Map<string, Set<string>>();
  const unique = (kind: string, id: string) => {
    const ids = seen.get(kind) ?? new Set<string>();
    seen.set(kind, ids);
    if (ids.has(id)) throw invalid(`id ${id} finns två gånger på <${kind}>`);
    ids.add(id);
  };

  for (const child of childElements(root)) {
    const id = attr(child, "id");
    switch (child.name) {
      case "event":
        if (event) { raw.push(toRaw(child)); warnings.add("SECOND_EVENT", "Filen har mer än ett <event>; det andra sparas orört"); }
        else event = readEvent(child, warnings);
        break;
      case "control": {
        const control = readControl(child, warnings);
        unique(child.name, control.id);
        controls[control.id] = control;
        break;
      }
      case "course": {
        const course = readCourse(child);
        unique(child.name, course.id);
        courses.push(course);
        break;
      }
      case "course-control": {
        const { courseControl, numberDelta } = readCourseControl(child);
        unique(child.name, courseControl.id);
        courseControls[courseControl.id] = courseControl;
        if (numberDelta) numberDeltas.set(courseControl.id, numberDelta);
        break;
      }
      case "leg": {
        unique(child.name, parseIdText(id, child.name));
        const leg = readLeg(child);
        const key = legKey(leg.from, leg.to);
        if (legs[key]) { raw.push(toRaw(child)); warnings.add("DUPLICATE_LEG", "Två sträckor mellan samma kontroller; den andra sparas orörd"); }
        else legs[key] = leg;
        break;
      }
      case "special-object": {
        const special = readSpecial(child);
        unique(child.name, special.id);
        specialObjects.push(special);
        break;
      }
      default:
        raw.push(toRaw(child));
        warnings.add("UNKNOWN_ELEMENT", "Element som O-Tid inte känner till sparas orörda");
    }
  }
  if (!event) throw invalid("filen saknar <event>");

  // Numrets läge sparas relativt kontrollen i filen men absolut i modellen.
  for (const [ccId, delta] of numberDeltas) {
    const cc = courseControls[ccId]!;
    const control = controls[cc.control];
    if (control) courseControls[ccId] = { ...cc, numberAt: { x: control.at.x + delta.x, y: control.at.y + delta.y } };
  }
  for (const cc of Object.values(courseControls)) {
    if (!controls[cc.control]) throw invalid(`banans kontroll ${cc.id} pekar på kontroll ${cc.control} som inte finns`);
    for (const ref of [cc.next, cc.split?.end, ...(cc.split?.branches ?? [])]) {
      if (ref !== undefined && !courseControls[ref]) throw invalid(`banans kontroll ${cc.id} pekar på ${ref} som inte finns`);
    }
  }
  for (const course of courses) {
    if (course.first !== undefined && !courseControls[course.first]) throw invalid(`banan ${course.name} börjar på ${course.first} som inte finns`);
  }
  for (const leg of Object.values(legs)) {
    if (!controls[leg.from] || !controls[leg.to]) warnings.add("LEG_WITHOUT_CONTROL", "En sträcka pekar på en kontroll som inte finns");
  }

  const fixedCourses = fixCourseOrders(courses, warnings);
  const document: CourseSettingDocument = {
    version: 1, event, controls, courseControls, courses: fixedCourses, legs, specialObjects, raw
  };
  const used = new Set<string>();
  for (const course of fixedCourses) for (const ccId of enumerateCourseControls(document, course.id)) used.add(ccId);
  const unused = Object.keys(courseControls).filter(ccId => !used.has(ccId)).length;
  for (let i = 0; i < unused; i++) warnings.add("UNUSED_COURSE_CONTROL", "Banans kontroller som ingen bana når sparas orörda");
  const specialKinds = new Set(specialObjects.map(special => special.kind));
  if (specialKinds.size > 0) warnings.add("SPECIAL_OBJECTS", `Specialobjekt (${[...specialKinds].join(", ")}) sparas men ritas inte än`);
  return { document, warnings: warnings.list() };
}

function parseIdText(id: string | undefined, element: string): string {
  if (id === undefined) throw invalid(`<${element}> saknar id`);
  return String(parseInteger(id, `${element} id`));
}

/** Banor utan ordning får ordning efter namn, som Purple Pens FixCourseSortOrders. */
function fixCourseOrders(courses: Course[], warnings: Warnings): Course[] {
  if (!courses.some(course => course.order <= 0)) return courses;
  warnings.add("COURSE_ORDER_MISSING", "Banor utan ordning har ordnats efter namn");
  const sorted = [...courses].sort((a, b) => a.name.localeCompare(b.name, "sv", { sensitivity: "accent" }));
  return courses.map(course => ({ ...course, order: sorted.indexOf(course) + 1 }));
}

function readEvent(element: XmlElement, warnings: Warnings): CourseSettingDocument["event"] {
  const raw: RawXml[] = [toRaw({ name: "event", attrs: element.attrs, children: [] })];
  let title = "";
  let mapScale: number | undefined;
  let overprintStandard: CourseSettingDocument["event"]["overprintStandard"] = "ISOM2017";
  let descriptionStandard: CourseSettingDocument["event"]["descriptionStandard"] = "2004";
  let mapStandardSeen = false;
  let numbering = { start: 31, disallowInvertible: true };
  for (const child of childElements(element)) {
    switch (child.name) {
      case "title": title = textOf(child); break;
      case "map": {
        const kind = required(child, "kind");
        if (!["none", "OCAD", "bitmap", "PDF"].includes(kind)) throw invalid(`okänt kartslag ${kind}`);
        if (kind === "bitmap") parseNumber(required(child, "dpi"), "map dpi");
        mapScale = parseNumber(required(child, "scale"), "map scale");
        raw.push(stub(child, ["scale"], true)!);
        break;
      }
      case "standards": {
        const used: string[] = [];
        const map = attr(child, "map");
        if (map !== undefined) {
          mapStandardSeen = true;
          overprintStandard = MAP_STANDARDS[map] ?? "ISOM2017";
          if (map === "2017" || map === "Spr2019") used.push("map");
          else warnings.add("MAP_STANDARD", `Banpåtryck enligt ${map} ritas som ISOM 2017`);
        }
        const description = attr(child, "description");
        if (description === "2004" || description === "2018") { descriptionStandard = description; used.push("description"); }
        raw.push(stub(child, used, true)!);
        break;
      }
      case "numbering": {
        const start = attr(child, "start");
        const disallow = attr(child, "disallow-invertible");
        numbering = {
          start: start === undefined ? 31 : parseInteger(start, "numbering start"),
          disallowInvertible: disallow === undefined ? true : parseBool(disallow, "disallow-invertible")
        };
        raw.push(stub(child, ["start", "disallow-invertible"], true)!);
        break;
      }
      default: raw.push(toRaw(child));
    }
  }
  if (!mapStandardSeen) warnings.add("MAP_STANDARD", "Banpåtryck enligt 2000 ritas som ISOM 2017");
  if (mapScale === undefined) throw invalid("<event> saknar <map>");
  if (!(mapScale > 0)) throw invalid("kartans skala är inte positiv");
  return { title, mapScale, overprintStandard, descriptionStandard, numbering, raw };
}

function readControl(element: XmlElement, warnings: Warnings): ControlPoint {
  const id = parseIdText(attr(element, "id"), "control");
  const kindText = required(element, "kind");
  const kind = CONTROL_KINDS[kindText];
  if (!kind) throw invalid(`okänt kontrollslag ${kindText}`);
  const orientationText = attr(element, "orientation");
  if (kind === "CROSSING_POINT" && orientationText === undefined) throw invalid(`passagen ${id} saknar orientation`);
  const orientation = orientationText === undefined ? undefined : parseNumber(orientationText, "orientation");
  const raw: RawXml[] = [];
  const self = stub({ name: "control", attrs: element.attrs, children: [] }, ["id", "kind", "orientation"]);
  if (self) raw.push(self);
  let code: string | undefined;
  let at: Point = { x: 0, y: 0 };
  const descriptions: DescriptionBox[] = [];
  const circleGaps: CircleGap[] = [];
  const newScales = new Set<number | null>();
  const oldGaps: { scale: number | null; text: string }[] = [];
  const gapsAttribute = attr(element, "gaps");
  if (gapsAttribute !== undefined && gapsAttribute !== "") oldGaps.push({ scale: null, text: gapsAttribute });

  for (const child of childElements(element)) {
    switch (child.name) {
      case "code":
        if (kind !== "NORMAL") throw invalid(`kontrollen ${id} är inte vanlig men har kod`);
        if (child.attrs.length > 0) { raw.push(toRaw(child)); break; }
        code = textOf(child);
        break;
      case "location": {
        at = point(child);
        const rest = stub(child, ["x", "y"]);
        if (rest) raw.push(rest);
        break;
      }
      case "description": {
        const box = required(child, "box");
        if (!["all", "C", "D", "E", "F", "G", "H"].includes(box)) throw invalid(`okänd ruta ${box} i beskrivningen`);
        if (child.attrs.some(([name]) => name !== "box" && name !== "iof-2004-ref") || childElements(child).length > 0) {
          raw.push(toRaw(child));
          warnings.add("DESCRIPTION_RAW", "En beskrivningsruta med okända delar sparas orörd");
          break;
        }
        const ref = attr(child, "iof-2004-ref");
        const text = textOf(child);
        descriptions.push({ box, ...(ref !== undefined ? { ref } : {}), ...(text !== "" ? { text } : {}) });
        break;
      }
      case "circle-gaps": {
        const text = textOf(child).trim();
        if (!text.includes(":") || child.attrs.some(([name]) => name !== "scale")) { raw.push(toRaw(child)); break; }
        const scaleNumber = parseInteger(attr(child, "scale") ?? "0", "circle-gaps scale");
        const scale = scaleNumber === 0 ? null : scaleNumber;
        newScales.add(scale);
        circleGaps.push(...decodeCircleGaps(text, scale));
        raw.push(toRaw(child));
        break;
      }
      case "gaps": {
        const scaleNumber = parseInteger(attr(child, "scale") ?? "0", "gaps scale");
        oldGaps.push({ scale: scaleNumber === 0 ? null : scaleNumber, text: textOf(child).trim() });
        raw.push(toRaw(child));
        break;
      }
      default: raw.push(toRaw(child));
    }
  }
  // Avbrotten skrivs tillbaka orörda (både gamla och nya); gamla utan nya för samma skala läses också.
  for (const old of oldGaps) {
    if (newScales.has(old.scale) || old.text === "") continue;
    const gaps = old.text.includes(":") ? decodeCircleGaps(old.text, old.scale) : decodeOldCircleGaps(old.text, old.scale);
    if (gaps === null) throw invalid(`felaktiga ringavbrott på kontroll ${id}`);
    newScales.add(old.scale);
    circleGaps.push(...gaps);
  }
  return {
    id, kind, at, descriptions,
    ...(code !== undefined ? { code } : {}),
    ...(orientation !== undefined ? { orientation } : {}),
    ...(circleGaps.length > 0 ? { circleGaps } : {}),
    ...(raw.length > 0 ? { raw } : {})
  };
}

function readCourse(element: XmlElement): Course {
  const id = parseIdText(attr(element, "id"), "course");
  const kindText = required(element, "kind");
  if (kindText !== "normal" && kindText !== "score") throw invalid(`okänt banslag ${kindText}`);
  const kind = kindText === "score" ? "SCORE" : "NORMAL";
  const orderText = attr(element, "order");
  const order = orderText === undefined ? 0 : parseInteger(orderText, "course order");
  const raw: RawXml[] = [];
  const self = stub({ name: "course", attrs: element.attrs, children: [] }, ["id", "kind", "order"]);
  if (self) raw.push(self);
  let name = "";
  let secondaryTitle: string | undefined;
  let first: string | undefined;
  let labelKind: Course["labelKind"] = kind === "SCORE" ? "CODE" : "SEQUENCE";
  let printScale: number | undefined;
  let climbMeters: number | undefined;
  let lengthOverrideMeters: number | undefined;
  let relay: { teams: number; legs: number } | undefined;
  const branches: XmlElement[] = [];

  for (const child of childElements(element)) {
    switch (child.name) {
      case "name": {
        name = textOf(child);
        const rest = stub(child, [], false, true);
        if (rest) raw.push(rest);
        break;
      }
      case "secondary-title":
        if (child.attrs.length > 0) { raw.push(toRaw(child)); break; }
        secondaryTitle = textOf(child);
        break;
      case "first": {
        first = parseIdText(required(child, "course-control"), "first");
        const rest = stub(child, ["course-control"]);
        if (rest) raw.push(rest);
        break;
      }
      case "labels": {
        const label = attr(child, "label-kind");
        const known = label === undefined ? undefined : LABEL_KINDS[label];
        if (known) labelKind = known;
        else if (label !== undefined) labelKind = "SEQUENCE";
        raw.push(stub(child, known ? ["label-kind"] : [], true)!);
        break;
      }
      case "options": {
        printScale = parseNumber(required(child, "print-scale"), "print-scale");
        const used = ["print-scale"];
        const climb = attr(child, "climb");
        if (climb !== undefined && parseNumber(climb, "climb") >= 0) { climbMeters = parseNumber(climb, "climb"); used.push("climb"); }
        const length = attr(child, "course-length");
        if (length !== undefined && parseNumber(length, "course-length") > 0) { lengthOverrideMeters = parseNumber(length, "course-length"); used.push("course-length"); }
        const rest = stub(child, used);
        if (rest) raw.push(rest);
        break;
      }
      case "relay": {
        relay = {
          teams: parseInteger(attr(child, "teams") ?? "0", "relay teams"),
          legs: parseInteger(attr(child, "legs") ?? "1", "relay legs")
        };
        const rest = stub(child, ["teams", "legs"]);
        if (rest) raw.push(rest);
        break;
      }
      case "relay-branch":
        branches.push(child);
        break;
      default: raw.push(toRaw(child));
    }
  }
  let relayOptions: CourseRelayOptions | undefined;
  if (relay) {
    const fixed: Record<string, string[]> = {};
    for (const branch of branches) {
      const code = attr(branch, "branch") ?? "";
      const leg = Number(attr(branch, "leg") ?? "-1");
      if (code.length !== 1 || !Number.isInteger(leg) || leg < 1 || branch.attrs.length !== 2) { raw.push(toRaw(branch)); continue; }
      (fixed[String(leg)] ??= []).push(code);
    }
    relayOptions = { ...relay, ...(Object.keys(fixed).length > 0 ? { fixedBranches: fixed } : {}) };
  } else {
    for (const branch of branches) raw.push(toRaw(branch));
  }
  return {
    id, name, kind, order, labelKind,
    ...(first !== undefined ? { first } : {}),
    ...(secondaryTitle !== undefined ? { secondaryTitle } : {}),
    ...(printScale !== undefined ? { printScale } : {}),
    ...(climbMeters !== undefined ? { climbMeters } : {}),
    ...(lengthOverrideMeters !== undefined ? { lengthOverrideMeters } : {}),
    ...(relayOptions ? { relay: relayOptions } : {}),
    ...(raw.length > 0 ? { raw } : {})
  };
}

function readCourseControl(element: XmlElement): { courseControl: CourseControl; numberDelta?: Point } {
  const id = parseIdText(attr(element, "id"), "course-control");
  const control = parseIdText(required(element, "control"), "course-control control");
  const variation = attr(element, "variation");
  const splitKind = variation === "fork" ? "FORK" : variation === "loop" ? "LOOP" : undefined;
  const used = ["id", "control"];
  let end: string | undefined;
  if (splitKind) {
    end = parseIdText(required(element, "variation-end"), "variation-end");
    used.push("variation", "variation-end");
  }
  const pointsText = attr(element, "points");
  const points = pointsText === undefined ? 0 : parseInteger(pointsText, "points");
  if (points !== 0) used.push("points");
  const raw: RawXml[] = [];
  const self = stub({ name: "course-control", attrs: element.attrs, children: [] }, used);
  if (self) raw.push(self);
  let next: string | undefined;
  const branches: string[] = [];
  let numberDelta: Point | undefined;
  for (const child of childElements(element)) {
    switch (child.name) {
      case "next": {
        next = parseIdText(required(child, "course-control"), "next");
        const rest = stub(child, ["course-control"]);
        if (rest) raw.push(rest);
        break;
      }
      case "variation":
        if (child.attrs.length !== 1) throw invalid(`<variation> på ${id} har okända attribut`);
        branches.push(parseIdText(required(child, "course-control"), "variation"));
        break;
      case "number-location": {
        numberDelta = point(child);
        const rest = stub(child, ["x", "y"]);
        if (rest) raw.push(rest);
        break;
      }
      default: raw.push(toRaw(child));
    }
  }
  if (!splitKind && branches.length > 0) throw invalid(`banans kontroll ${id} har grenar men är ingen gaffling`);
  if (splitKind && branches.length === 0) throw invalid(`gafflingen ${id} saknar grenar`);
  const courseControl: CourseControl = {
    id, control,
    ...(next !== undefined ? { next } : {}),
    ...(splitKind ? { split: { kind: splitKind, branches, end: end! } } : {}),
    ...(points !== 0 ? { points } : {}),
    ...(raw.length > 0 ? { raw } : {})
  };
  return numberDelta ? { courseControl, numberDelta } : { courseControl };
}

function readLeg(element: XmlElement): Leg {
  const raw: RawXml[] = [stub({ name: "leg", attrs: element.attrs, children: [] }, ["start-control", "end-control"], true)!];
  const from = parseIdText(required(element, "start-control"), "start-control");
  const to = parseIdText(required(element, "end-control"), "end-control");
  let flagging: Leg["flagging"];
  let flaggingAt: Point | undefined;
  const bends: Point[] = [];
  const gaps: { start: number; length: number }[] = [];
  for (const child of childElements(element)) {
    switch (child.name) {
      case "flagging": {
        const kindText = required(child, "kind");
        flagging = FLAGGING_KINDS[kindText];
        if (!flagging) throw invalid(`okänd snitsling ${kindText}`);
        const used = ["kind"];
        if (flagging === "BEGINNING" || flagging === "END" || flagging === "MIDDLE") { flaggingAt = point(child); used.push("x", "y"); }
        const rest = stub(child, used);
        if (rest) raw.push(rest);
        break;
      }
      case "bends":
        if (child.attrs.length > 0 || childElements(child).some(c => c.name !== "location" || c.attrs.length !== 2)) { raw.push(toRaw(child)); break; }
        for (const location of childElements(child)) bends.push(point(location));
        break;
      case "gaps":
        if (child.attrs.length > 0 || childElements(child).some(c => c.name !== "gap" || c.attrs.length !== 2)) { raw.push(toRaw(child)); break; }
        for (const gap of childElements(child)) {
          gaps.push({ start: parseNumber(required(gap, "start"), "gap start"), length: parseNumber(required(gap, "length"), "gap length") });
        }
        break;
      default: raw.push(toRaw(child));
    }
  }
  return {
    from, to, bends, gaps,
    ...(flagging !== undefined ? { flagging } : {}),
    ...(flaggingAt !== undefined ? { flaggingAt } : {}),
    raw
  };
}

function readSpecial(element: XmlElement): SpecialObject {
  const id = parseIdText(attr(element, "id"), "special-object");
  const kind = required(element, "kind");
  if (!SPECIAL_KINDS.has(kind)) throw invalid(`okänt specialobjekt ${kind}`);
  if (kind === "optional-crossing-point") parseNumber(required(element, "orientation"), "orientation");
  const children = childElements(element);
  const points = children.filter(child => child.name === "location").map(point);
  if (points.length === 0) throw invalid(`specialobjektet ${id} saknar location`);
  if (kind === "text" && !children.some(child => child.name === "font")) throw invalid(`texten ${id} saknar font`);
  if (kind === "image" && !children.some(child => child.name === "image-data")) throw invalid(`bilden ${id} saknar image-data`);
  return { id, kind, points, courses: specialCourses(element), raw: toRaw(element) };
}

/** Banorna ett specialobjekt syns på; tomt = alla. */
export function specialCourses(element: XmlElement): string[] {
  const courses = childElements(element).find(child => child.name === "courses");
  if (!courses) return [];
  const all = attr(courses, "all");
  if (all !== undefined && parseBool(all, "courses all")) return [];
  const ids: string[] = [];
  for (const course of childElements(courses)) {
    if (course.name !== "course") continue;
    const id = parseIdText(required(course, "course"), "course");
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
