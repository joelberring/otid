/**
 * ADR-0190 beslut 5: banorna som IOF XML 3.0 CourseData, som Purple Pens ExportXmlVersion3 (ExportXml.cs, BSD, Peter Golde),
 * så att MeOS, OLA, OCAD och andra program läser dem som en fil från Purple Pen:
 *
 * - kontrollerna per slag (start och kartbyte som Start, vanliga, mål, passager), utan kod: STA1, XCHG1, CTL1, FIN1, CROSS1
 * - bara banor med start och mål, i banlistans ordning; en gafflad bana blir en `Course` per variant med namnet
 *   "Bana AC" och `CourseFamily` "Bana" (Purple Pens konvention, som MeOS och OLA läser som en bana med varianter)
 * - längden avrundad till 100 m (fast längd före uträknad), stigningen till 5 m; poängbanor utan längd, med
 *   `randomOrder` och `Score`
 * - sträckornas längd (`LegLength`) och kontrollernas nummer (`MapText`); kartutdelningen skrivs inte men dess sträcka räknas
 * - klasserna ur banans undertitel som `ClassCourseAssignment` efter banorna
 * - `Position` (WGS 84) när den som anropar kan räkna om kartans mm (georefererad kartfil).
 *
 * Stafettlagens varianter (`TeamCourseAssignment`, Purple Pens RelayVariations med slumptal) skrivs inte. Ren funktion.
 */
import type { Point } from "@o-tid/map-file";
import { courseViewForExport } from "./description-format";
import { sortedCourses } from "./course-properties";
import type { ControlKind, Course, CourseSettingDocument, MapRect } from "./types";
import { excludedVariantCodes } from "./summary";
import { enumerateCourseControls, variations } from "./walk";

export interface IofCourseDataOptions {
  /** Kartans yta i mm (kartfilens gränser); saknas = kontrollernas yta. */
  readonly mapBounds?: MapRect | undefined;
  /** Kartans mm → WGS 84, när kartfilen är georefererad. */
  readonly position?: ((at: Point) => { readonly latitude: number; readonly longitude: number } | undefined) | undefined;
  readonly createTime?: Date | undefined;
  readonly creator?: string | undefined;
}

/** .NET Math.Round: jämnt vid exakt halva. */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}
/** Purple Pen lagrar lägen som float och avrundar till två decimaler. */
const mm = (value: number) => {
  const rounded = roundHalfEven(Math.fround(value) * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
};
const escapeText = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (text: string) => escapeText(text).replace(/"/g, "&quot;");

class Writer {
  readonly lines: string[] = [];
  private depth = 0;
  private pad() { return "  ".repeat(this.depth); }
  private attrs(attrs: readonly [string, string][]) { return attrs.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join(""); }
  open(name: string, attrs: readonly [string, string][] = []) { this.lines.push(`${this.pad()}<${name}${this.attrs(attrs)}>`); this.depth += 1; }
  close(name: string) { this.depth -= 1; this.lines.push(`${this.pad()}</${name}>`); }
  empty(name: string, attrs: readonly [string, string][]) { this.lines.push(`${this.pad()}<${name}${this.attrs(attrs)} />`); }
  text(name: string, value: string) { this.lines.push(`${this.pad()}<${name}>${escapeText(value)}</${name}>`); }
}

const CONTROL_TYPES: readonly { readonly kind: ControlKind; readonly type: string; readonly prefix: string }[] = [
  { kind: "START", type: "Start", prefix: "STA" }, { kind: "MAP_EXCHANGE", type: "Start", prefix: "XCHG" }, { kind: "NORMAL", type: "Control", prefix: "CTL" },
  { kind: "FINISH", type: "Finish", prefix: "FIN" }, { kind: "CROSSING_POINT", type: "CrossingPoint", prefix: "CROSS" }
];

const byId = (a: string, b: string) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0);

/** Klasserna i undertiteln, åtskilda med komma eller lodstreck (Purple Pens GetClassNames). */
export function classNamesOfCourse(course: Course): string[] {
  return (course.secondaryTitle ?? "").split(/[,|]/).map(name => name.trim()).filter(name => name.length > 0);
}

function controlsBounds(document: CourseSettingDocument): MapRect {
  const points = Object.values(document.controls).map(control => control.at);
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  return { minX: Math.min(...xs) - 10, minY: Math.min(...ys) - 10, maxX: Math.max(...xs) + 10, maxY: Math.max(...ys) + 10 };
}

/** Dokumentets banor som IOF XML 3.0 CourseData (UTF-8, indraget som Purple Pen). */
export function writeIofCourseData(document: CourseSettingDocument, options: IofCourseDataOptions = {}): string {
  const w = new Writer();
  const createTime = (options.createTime ?? new Date()).toISOString();
  w.open("CourseData", [["xmlns", "http://www.orienteering.org/datastandard/3.0"], ["iofVersion", "3.0"], ["createTime", createTime],
    ["creator", options.creator ?? "O-Tid"]]);
  w.open("Event");
  w.text("Name", document.event.title);
  w.close("Event");
  w.open("RaceCourseData");
  const bounds = options.mapBounds ?? controlsBounds(document);
  w.open("Map");
  w.text("Scale", String(document.event.mapScale));
  w.empty("MapPositionTopLeft", [["x", mm(bounds.minX)], ["y", mm(bounds.maxY)]]);
  w.empty("MapPositionBottomRight", [["x", mm(bounds.maxX)], ["y", mm(bounds.minY)]]);
  w.close("Map");

  // Kontrollerna per slag i id-ordning; utan kod får de ett påhittat id (WriteControls).
  const codes = new Map<string, string>();
  const ids = Object.keys(document.controls).sort(byId);
  for (const { kind, type, prefix } of CONTROL_TYPES) {
    let suffix = 1;
    for (const id of ids) {
      const control = document.controls[id]!;
      if (control.kind !== kind) continue;
      const code = control.code !== undefined && control.code !== "" ? control.code : `${prefix}${suffix++}`;
      codes.set(id, code);
      w.open("Control", [["type", type]]);
      w.text("Id", code);
      const position = options.position?.(control.at);
      if (position && Number.isFinite(position.latitude) && Number.isFinite(position.longitude)) {
        w.empty("Position", [["lng", String(position.longitude)], ["lat", String(position.latitude)]]);
      }
      w.empty("MapPosition", [["x", mm(control.at.x)], ["y", mm(control.at.y)]]);
      w.close("Control");
    }
  }

  const assignments: { className: string; courseName: string; family: string | undefined }[] = [];
  for (const course of sortedCourses(document.courses)) {
    const kinds = new Set(enumerateCourseControls(document, course.id)
      .map(id => document.controls[document.courseControls[id]?.control ?? ""]?.kind));
    if (!kinds.has("START") || !kinds.has("FINISH")) continue;
    // ADR-0197: bortvalda varianter skrivs inte.
    const excluded = excludedVariantCodes(document, course.id);
    const all = course.kind === "SCORE" ? [] : variations(document, course.id).filter(variation => !excluded.has(variation.code));
    const variants = all.length === 0 ? [undefined] : all.map(variation => variation.code);
    for (const variant of variants) {
      const name = variant === undefined ? course.name : `${course.name} ${variant}`;
      const family = variant === undefined ? undefined : course.name;
      writeCourse(w, document, course, variant, name, family, codes);
      for (const className of classNamesOfCourse(course)) assignments.push({ className, courseName: name, family });
    }
  }
  for (const assignment of assignments) {
    w.open("ClassCourseAssignment");
    w.text("ClassName", assignment.className);
    w.text("CourseName", assignment.courseName);
    if (assignment.family !== undefined) w.text("CourseFamily", assignment.family);
    w.close("ClassCourseAssignment");
  }
  w.close("RaceCourseData");
  w.close("CourseData");
  return `<?xml version="1.0" encoding="utf-8"?>\n${w.lines.join("\n")}`;
}

function writeCourse(w: Writer, document: CourseSettingDocument, course: Course, variant: string | undefined, name: string,
  family: string | undefined, codes: ReadonlyMap<string, string>): void {
  const score = course.kind === "SCORE";
  const views = courseViewForExport(document, course.id, variant);
  w.open("Course");
  w.text("Name", name);
  if (family !== undefined) w.text("CourseFamily", family);
  if (!score) {
    const measured = views.reduce((sum, view) => sum + (view.legLengthMeters ?? 0), 0);
    w.text("Length", String(roundHalfEven((course.lengthOverrideMeters ?? measured) / 100) * 100));
    const climb = course.climbMeters ?? 0;
    if (climb > 0) w.text("Climb", String(Math.sign(climb / 5) * Math.round(Math.abs(climb / 5)) * 5));
  }
  let distance = 0;
  for (const view of views) {
    const control = document.controls[view.control];
    if (!control) continue;
    if (control.kind !== "MAP_ISSUE") {
      const first = control.descriptions.find(box => box.box === "all")?.ref;
      const attrs: [string, string][] = [];
      switch (control.kind) {
        case "START": case "MAP_EXCHANGE": attrs.push(["type", "Start"]); break;
        case "FINISH":
          attrs.push(["type", "Finish"]);
          if (first === "14.1") attrs.push(["specialInstruction", "TapedRoute"]);
          else if (first === "14.2") attrs.push(["specialInstruction", "FunnelTapedRoute"]);
          break;
        case "NORMAL": attrs.push(["type", "Control"]); if (score) attrs.push(["randomOrder", "true"]); break;
        case "CROSSING_POINT":
          attrs.push(["type", "CrossingPoint"], ["specialInstruction", first === "13.4" ? "MandatoryOutOfBoundsAreaPassage" : "MandatoryCrossingPoint"]);
          break;
      }
      w.open("CourseControl", attrs);
      w.text("Control", codes.get(control.id) ?? control.id);
      if (!score && view.ordinal > 0) w.text("MapText", String(view.ordinal));
      if (!score && control.kind !== "START") { w.text("LegLength", String(roundHalfEven(Math.fround(distance)))); distance = 0; }
      if (score && control.kind === "NORMAL") {
        const points = view.courseControl !== undefined ? document.courseControls[view.courseControl]?.points ?? 0 : 0;
        if (points > 0) w.text("Score", String(points));
      }
      w.close("CourseControl");
    }
    if (view.legLengthMeters !== undefined) distance += view.legLengthMeters;
  }
  w.close("Course");
}
