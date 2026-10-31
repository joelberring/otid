/**
 * Skriver dokumentet som .ppen i Purple Pens form (EventDB.cs, BSD, Peter Golde). Det som lästes in och inte ändrats
 * skrivs tillbaka likadant; råa element skrivs i samma ordning som de lästes.
 */
import {
  MAP_STANDARDS, ROOT, decodeCircleGaps, decodeOldCircleGaps, encodeCircleGaps, formatFloat32, formatNumber, fromRaw,
  invertRecord, nextId, CONTROL_KINDS, FLAGGING_KINDS, LABEL_KINDS
} from "./ppen-common";
import { specialCourses } from "./ppen-read";
import type { CircleGap, ControlPoint, Course, CourseControl, CourseSettingDocument, Leg, RawXml, SpecialObject } from "./types";
import { attr, childElements, el, serializeXml, textOf, type XmlElement, type XmlNode } from "./xml";

const CONTROL_KIND_TEXT = invertRecord(CONTROL_KINDS);
const LABEL_KIND_TEXT = invertRecord(LABEL_KINDS);
const FLAGGING_TEXT = invertRecord(FLAGGING_KINDS);
const MAP_STANDARD_TEXT: Record<string, string> = { ISOM2017: "2017", ISSPROM2019: "Spr2019" };

type Attr = [string, string | undefined];

/** Elementet med de tolkade attributen (i stubbens ordning om de fanns där) och stubbens övriga attribut. */
function merge(name: string, stubElement: XmlElement | undefined, attrs: readonly Attr[], children: XmlNode[] = []): XmlElement {
  const defined = attrs.filter((entry): entry is [string, string] => entry[1] !== undefined);
  const out: [string, string][] = defined.filter(([key]) => !stubElement?.attrs.some(([k]) => k === key));
  for (const [key, value] of stubElement?.attrs ?? []) {
    const own = attrs.find(([k]) => k === key)?.[1];
    out.push([key, own ?? value]);
  }
  return el(name, out, children.length > 0 ? children : stubElement?.children ?? []);
}

/**
 * Barnen till ett objekt: först de tolkade elementen som inte har någon stubbe, sedan de råa i ordning där stubbarna
 * slås ihop med modellens värden. `parts` ger elementet för ett namn (med stubbe eller utan); `null` = skrivs inte.
 */
function children(
  self: string, raws: readonly RawXml[] | undefined, canonical: readonly XmlElement[],
  parts: Readonly<Record<string, (stubElement: XmlElement | undefined) => XmlElement | null>>
): { attrs: [string, string][]; children: XmlElement[] } {
  const parsed = (raws ?? []).map(fromRaw);
  const selfStub = parsed.find(element => element.name === self);
  const stubs = new Map<string, XmlElement>();
  for (const element of parsed) if (element.name in parts && !stubs.has(element.name)) stubs.set(element.name, element);
  const out: XmlElement[] = [];
  for (const name of Object.keys(parts)) {
    if (stubs.has(name)) continue;
    const built = parts[name]!(undefined);
    if (built) out.push(built);
  }
  out.push(...canonical);
  for (const element of parsed) {
    if (element === selfStub) continue;
    if (stubs.get(element.name) === element) {
      const built = parts[element.name]!(element);
      if (built) out.push(built);
    } else {
      out.push(element);
    }
  }
  return { attrs: selfStub?.attrs ?? [], children: out };
}

const num = (value: number | undefined) => value === undefined ? undefined : formatNumber(value);

function eventElement(document: CourseSettingDocument): XmlElement {
  const event = document.event;
  const keep = (stubElement: XmlElement | undefined, name: string, map: Readonly<Record<string, string>>, value: string, text: string) => {
    const old = stubElement ? attr(stubElement, name) : undefined;
    return old !== undefined && map[old] === value ? old : text;
  };
  const parts = {
    map: (s: XmlElement | undefined) => merge("map", s, s ? [["scale", num(event.mapScale)]] : [["kind", "none"], ["scale", num(event.mapScale)]]),
    standards: (s: XmlElement | undefined) => {
      if (!s && event.overprintStandard === "ISOM2017" && event.descriptionStandard === "2004") return null;
      return merge("standards", s, [
        ["map", keep(s, "map", MAP_STANDARDS, event.overprintStandard, MAP_STANDARD_TEXT[event.overprintStandard]!)],
        ["description", keep(s, "description", { "2004": "2004", "2018": "2018" }, event.descriptionStandard, event.descriptionStandard)]
      ]);
    },
    numbering: (s: XmlElement | undefined) => {
      if (!s && event.numbering.start === 31 && event.numbering.disallowInvertible) return null;
      return merge("numbering", s, [["start", String(event.numbering.start)], ["disallow-invertible", String(event.numbering.disallowInvertible)]]);
    }
  };
  const { attrs, children: kids } = children("event", event.raw, [el("title", [], event.title === "" ? [] : [event.title])], parts);
  return el("event", attrs.length > 0 ? attrs : [["id", "1"]], kids);
}

function controlElement(control: ControlPoint): XmlElement {
  const canonical: XmlElement[] = [];
  if (control.code !== undefined) canonical.push(el("code", [], control.code === "" ? [] : [control.code]));
  for (const box of control.descriptions) {
    canonical.push(merge("description", undefined, [["box", box.box], ["iof-2004-ref", box.ref]], box.text ? [box.text] : []));
  }
  canonical.push(...circleGapElements(control));
  const parts = {
    location: (s: XmlElement | undefined) => merge("location", s, [["x", num(control.at.x)], ["y", num(control.at.y)]])
  };
  const { attrs, children: kids } = children("control", control.raw, canonical, parts);
  return merge("control", el("control", attrs), [
    ["id", control.id], ["kind", CONTROL_KIND_TEXT[control.kind]], ["orientation", num(control.orientation)]
  ], kids);
}

/** Avbrotten för skalor där de råa elementen (orörda från filen eller från SET_CIRCLE_GAPS) inte redan ger samma avbrott. */
function circleGapElements(control: ControlPoint): XmlElement[] {
  const byScale = new Map<number | null, CircleGap[]>();
  for (const gap of control.circleGaps ?? []) byScale.set(gap.scale, [...(byScale.get(gap.scale) ?? []), gap]);
  const written = new Map<number | null, string[]>();
  const add = (scale: number | null, text: string) => written.set(scale, [...(written.get(scale) ?? []), text]);
  for (const element of (control.raw ?? []).map(fromRaw)) {
    if (element.name === "control" && attr(element, "gaps")) add(null, attr(element, "gaps")!);
    if (element.name !== "gaps" && element.name !== "circle-gaps") continue;
    const scale = Number(attr(element, "scale") ?? "0");
    add(scale === 0 ? null : scale, textOf(element).trim());
  }
  const out: XmlElement[] = [];
  for (const [scale, gaps] of byScale) {
    const same = (written.get(scale) ?? []).some(text => {
      const decoded = text.includes(":") ? decodeCircleGaps(text, scale) : decodeOldCircleGaps(text, scale);
      return decoded !== null && JSON.stringify(decoded) === JSON.stringify(gaps);
    });
    if (!same) out.push(el("circle-gaps", [["scale", String(scale ?? 0)]], [encodeCircleGaps(gaps)]));
  }
  return out;
}

/** Kortaste text för numrets förskjutning som ger exakt samma läge när filen läses igen. */
function delta(at: number, numberAt: number): string {
  const value = numberAt - at;
  for (let digits = 1; digits <= 17; digits++) {
    const candidate = Number(value.toPrecision(digits));
    if (at + candidate === numberAt) return formatNumber(candidate);
  }
  return formatFloat32(value);
}

function courseElement(course: Course): XmlElement {
  const defaultLabel = course.kind === "SCORE" ? "CODE" : "SEQUENCE";
  const parts = {
    name: (s: XmlElement | undefined) => merge("name", s ? el("name", s.attrs) : undefined, [], course.name === "" ? [] : [course.name]),
    labels: (s: XmlElement | undefined) => !s && course.labelKind === defaultLabel ? null
      : merge("labels", s, [["label-kind", s && attr(s, "label-kind") !== undefined && course.labelKind === "SEQUENCE" ? undefined : LABEL_KIND_TEXT[course.labelKind]]]),
    first: (s: XmlElement | undefined) => course.first === undefined ? null : merge("first", s, [["course-control", course.first]]),
    options: (s: XmlElement | undefined) => course.printScale === undefined ? null : merge("options", s, [
      ["print-scale", num(course.printScale)], ["climb", num(course.climbMeters)], ["course-length", num(course.lengthOverrideMeters)]
    ]),
    relay: (s: XmlElement | undefined) => !course.relay ? null
      : merge("relay", s, [["teams", String(course.relay.teams)], ["legs", String(course.relay.legs)]])
  };
  const canonical: XmlElement[] = [];
  if (course.secondaryTitle !== undefined) canonical.push(el("secondary-title", [], course.secondaryTitle === "" ? [] : [course.secondaryTitle]));
  const { attrs, children: kids } = children("course", course.raw, canonical, parts);
  for (const [leg, branches] of Object.entries(course.relay?.fixedBranches ?? {})) {
    for (const branch of branches) kids.push(el("relay-branch", [["branch", branch], ["leg", leg]]));
  }
  return merge("course", el("course", attrs), [
    ["id", course.id], ["kind", course.kind === "SCORE" ? "score" : "normal"], ["order", String(course.order)]
  ], kids);
}

function courseControlElement(cc: CourseControl, control: ControlPoint | undefined): XmlElement {
  const canonical: XmlElement[] = [];
  for (const branch of cc.split?.branches ?? []) canonical.push(el("variation", [["course-control", branch]]));
  const parts = {
    next: (s: XmlElement | undefined) => cc.next === undefined ? null : merge("next", s, [["course-control", cc.next]]),
    "number-location": (s: XmlElement | undefined) => {
      if (!cc.numberAt || !control) return null;
      return merge("number-location", s, [
        ["x", delta(control.at.x, cc.numberAt.x)], ["y", delta(control.at.y, cc.numberAt.y)]
      ]);
    }
  };
  const { attrs, children: ordered } = children("course-control", cc.raw, canonical, parts);
  return merge("course-control", el("course-control", attrs), [
    ["id", cc.id], ["control", cc.control],
    ["variation", cc.split ? (cc.split.kind === "LOOP" ? "loop" : "fork") : undefined],
    ["variation-end", cc.split?.end],
    ["points", cc.points === undefined || cc.points === 0 ? undefined : String(cc.points)]
  ], ordered);
}

function legElement(leg: Leg, id: string): XmlElement {
  const canonical: XmlElement[] = [];
  if (leg.bends.length > 0) canonical.push(el("bends", [], leg.bends.map(p => el("location", [["x", formatNumber(p.x)], ["y", formatNumber(p.y)]]))));
  if (leg.gaps.length > 0) {
    canonical.push(el("gaps", [], leg.gaps.map(g => el("gap", [["start", formatNumber(g.start)], ["length", formatNumber(g.length)]]))));
  }
  const parts = {
    flagging: (s: XmlElement | undefined) => {
      if (leg.flagging === undefined) return null;
      const at = leg.flagging === "BEGINNING" || leg.flagging === "END" || leg.flagging === "MIDDLE" ? leg.flaggingAt : undefined;
      return merge("flagging", s, [["kind", FLAGGING_TEXT[leg.flagging]], ["x", num(at?.x)], ["y", num(at?.y)]]);
    }
  };
  const { attrs, children: ordered } = children("leg", leg.raw, canonical, parts);
  return merge("leg", el("leg", attrs.length > 0 ? attrs : [["id", id]]), [["start-control", leg.from], ["end-control", leg.to]], ordered);
}

/** Specialobjektet orört, eller med nya punkter och banor om de ändrats. */
function specialElement(special: SpecialObject): XmlElement {
  const element = fromRaw(special.raw);
  const points = childElements(element).filter(child => child.name === "location")
    .map(child => ({ x: Number(attr(child, "x")), y: Number(attr(child, "y")) }));
  const samePoints = JSON.stringify(points) === JSON.stringify(special.points);
  const sameCourses = JSON.stringify(specialCourses(element)) === JSON.stringify(special.courses);
  if (samePoints && sameCourses) return element;
  const kids: XmlNode[] = [];
  let pointsWritten = false;
  for (const child of element.children) {
    if (typeof child !== "string" && child.name === "location") {
      if (!pointsWritten) kids.push(...special.points.map(p => el("location", [["x", formatNumber(p.x)], ["y", formatNumber(p.y)]])));
      pointsWritten = true;
    } else if (typeof child !== "string" && child.name === "courses") {
      kids.push(special.courses.length === 0 ? el("courses", [["all", "true"]])
        : el("courses", [], special.courses.map(id => childElements(child).find(c => attr(c, "course") === id) ?? el("course", [["course", id]]))));
    } else {
      kids.push(child);
    }
  }
  return el(element.name, element.attrs, kids);
}

/** Hela filen. */
export function writePpenDocument(document: CourseSettingDocument): string {
  const raws = document.raw.map(fromRaw);
  const rootStub = raws.find(element => element.name === ROOT);
  const kids: XmlElement[] = [eventElement(document)];
  for (const control of Object.values(document.controls)) kids.push(controlElement(control));
  for (const course of document.courses) kids.push(courseElement(course));
  for (const cc of Object.values(document.courseControls)) kids.push(courseControlElement(cc, document.controls[cc.control]));
  const legId = (leg: Leg) => {
    const own = leg.raw?.map(fromRaw).find(e => e.name === "leg");
    return own ? attr(own, "id") : undefined;
  };
  const taken = Object.values(document.legs).map(legId).filter((id): id is string => id !== undefined);
  for (const leg of Object.values(document.legs)) {
    const id = legId(leg);
    if (id !== undefined) kids.push(legElement(leg, id));
    else {
      const fresh = nextId(taken);
      taken.push(fresh);
      kids.push(legElement(leg, fresh));
    }
  }
  for (const special of document.specialObjects) kids.push(specialElement(special));
  for (const element of raws) if (element !== rootStub) kids.push(element);
  return `${serializeXml(el(ROOT, rootStub?.attrs ?? [], kids), "")}\n`;
}
