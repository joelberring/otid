/**
 * Kontrollbeskrivningens rader för en bana, portade från Purple Pens CourseView.cs (CreateStandardCourseView,
 * CreateAllVariationsCourseView, CreateScoreCourseView, CreateFilteredAllControlsView) och DescriptionFormatter.cs
 * (CreateDescription med huvud, kontrollrader, riktningsrader, kartbyten, snitslar, textrader och nyckel; BSD, Peter Golde).
 */
import { legKey, rawAttribute } from "./ppen-common";
import { summaries } from "./summary";
import type { SymbolData } from "./description-symbols";
import { descriptionContext, formatDecimal, format, symbolIds, columnFText, Textifier, type DescriptionContext } from "./description-text";
import type { ControlKind, ControlPoint, Course, CourseControl, CourseSettingDocument } from "./types";
import { CourseSettingEditError } from "./types";
import { enumerateCourseControls, findCourse, legPath, pathLength, variations } from "./walk";
import { courseParts } from "./course-parts";

export type DescriptionLineKind = "TITLE" | "SECONDARY_TITLE" | "HEADER_3" | "HEADER_2" | "NORMAL" | "DIRECTIVE" | "TEXT" | "KEY";
export type TextLineKind = "BEFORE_CONTROL" | "BEFORE_COURSE_CONTROL" | "AFTER_CONTROL" | "AFTER_COURSE_CONTROL";
/** En ruta: symbol, text eller tom. */
export type DescriptionBoxValue = SymbolData | string | null;

export interface DescriptionLine {
  readonly kind: DescriptionLineKind;
  readonly boxes: readonly DescriptionBoxValue[];
  /** Raden som text (textbeskrivningen). */
  readonly textual?: string | undefined;
  readonly isLeg?: boolean | undefined;
  readonly textLineKind?: TextLineKind | undefined;
  readonly control?: string | undefined;
  readonly courseControl?: string | undefined;
}

/** "Alla varianter" ur Purple Pens MiscText.*.resx (AllVariations). */
const ALL_VARIATIONS: Readonly<Record<string, string>> = {
  en: "All Variations", sv: "Alla alternativ", "nb-NO": "Alle varianter", fi: "Kaikki hajonnat", de: "Alle Varianten"
};

type ViewKind = "NORMAL" | "ALL_CONTROLS" | "SCORE" | "ALL_VARIATIONS";

interface ControlView {
  readonly control: string;
  /** Banans kontroller (flera för en gaffling i alla varianter); tom för alla kontroller. */
  readonly courseControls: readonly string[];
  readonly ordinal: number;
  /** Index till nästa vy (flera för en gaffling); längd och sträckans nyckel per index. */
  legTo?: number[];
  legLength?: number[];
  legId?: (string | undefined)[];
}

interface CourseView {
  readonly kind: ViewKind;
  readonly course?: Course | undefined;
  readonly fullName: string;
  readonly views: ControlView[];
  readonly scoreColumn: number;
}

/** Purple Pens ordning på kontrollslagen när alla kontroller och poängbanor sorteras (ControlPointKind). */
const KIND_ORDER: Readonly<Record<ControlKind, number>> = { MAP_ISSUE: 1, START: 2, MAP_EXCHANGE: 3, NORMAL: 4, FINISH: 5, CROSSING_POINT: 6 };

const isInteger = (code: string) => /^-?\d+$/.test(code.trim());

/** Kodernas ordning (Util.CompareCodes): saknad först, tal i talordning, sedan text. */
export function compareCodes(a: string | undefined, b: string | undefined): number {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  const ai = isInteger(a);
  const bi = isInteger(b);
  if (ai && !bi) return -1;
  if (!ai && bi) return 1;
  if (ai && bi) return Number(a) - Number(b);
  return a.localeCompare(b);
}

const byId = (a: string, b: string) => Number(a) - Number(b) || (a < b ? -1 : a > b ? 1 : 0);

function controlOf(document: CourseSettingDocument, id: string): ControlPoint {
  const control = document.controls[id];
  if (!control) throw new CourseSettingEditError("NOT_FOUND", `Kontrollen ${id} finns inte`);
  return control;
}

const cc = (document: CourseSettingDocument, id: string): CourseControl => document.courseControls[id]!;

function rawFlag(raws: CourseControl["raw"], name: string): boolean {
  return (rawAttribute(raws, "course-control", name) ?? "").trim().toLowerCase() === "true";
}

/** Sträckornas index, nycklar och längder (CourseView.UpdateLegToIndices). `legTo` håller först banans kontroll-id. */
function finishViews(document: CourseSettingDocument, views: ControlView[], targets: (string | undefined)[][]): void {
  views.forEach((view, i) => {
    const target = targets[i];
    if (!target || target.length === 0) return;
    view.legTo = [];
    view.legId = [];
    view.legLength = [];
    for (const ccId of target) {
      const j = ccId === undefined ? -1 : views.findIndex(other => other.courseControls.includes(ccId));
      view.legTo.push(j);
      if (j < 0) { view.legId.push(undefined); view.legLength.push(0); continue; }
      const key = legKey(view.control, views[j]!.control);
      view.legId.push(document.legs[key] ? key : undefined);
      view.legLength.push(pathLength(legPath(document, view.control, views[j]!.control)) * document.event.mapScale / 1000);
    }
  });
}

function allControlsView(document: CourseSettingDocument): CourseView {
  const views: ControlView[] = Object.values(document.controls).map(control => ({ control: control.id, courseControls: [], ordinal: -1 }));
  views.sort((a, b) => {
    const x = controlOf(document, a.control);
    const y = controlOf(document, b.control);
    return KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || compareCodes(x.code, y.code) || byId(a.control, b.control);
  });
  return { kind: "ALL_CONTROLS", fullName: "", views, scoreColumn: -1 };
}

function firstOrdinal(course: Course): number {
  const value = Number(rawAttribute(course.raw, "first", "control-number") ?? "1");
  return Number.isInteger(value) && value > 0 ? value : 1;
}

function standardView(document: CourseSettingDocument, course: Course, choices: readonly string[] | null, variantCode: string,
  part?: { readonly index: number; readonly ids: readonly string[] }): CourseView {
  const all = enumerateCourseControls(document, course.id, choices);
  // Kartbyten (ADR-0203): delens kontroller; numren fortsätter från delarna före (CourseView.CreateCourseView).
  const ids = part ? [...part.ids] : all;
  let ordinal = firstOrdinal(course);
  if (part) for (const id of all.slice(0, Math.max(0, all.indexOf(part.ids[0]!)))) if (controlOf(document, cc(document, id).control).kind === "NORMAL") ordinal++;
  const views: ControlView[] = [];
  const targets: (string | undefined)[][] = [];
  ids.forEach((id, index) => {
    const kind = controlOf(document, cc(document, id).control).kind;
    const viewOrdinal = kind === "NORMAL" ? ordinal++ : kind === "START" || kind === "MAP_EXCHANGE" ? 0 : -1;
    views.push({ control: cc(document, id).control, courseControls: [id], ordinal: viewOrdinal });
    targets.push(index < ids.length - 1 ? [ids[index + 1]] : []);
  });
  finishViews(document, views, targets);
  const name = variantCode === "" ? course.name : `${course.name} ${variantCode}`;
  return { kind: "NORMAL", course, fullName: part ? `${name}-${part.index + 1}` : name, views, scoreColumn: -1 };
}

function allVariationsView(document: CourseSettingDocument, course: Course): CourseView {
  const views: ControlView[] = [];
  const targets: (string | undefined)[][] = [];
  for (const id of enumerateCourseControls(document, course.id)) {
    const item = cc(document, id);
    if (item.split && views.some(view => view.courseControls.includes(id))) continue;
    const group = item.split ? item.split.branches : [id];
    views.push({ control: item.control, courseControls: group, ordinal: -1 });
    targets.push(item.next === undefined ? [] : group.map(branch => cc(document, branch).next));
  }
  finishViews(document, views, targets);
  return { kind: "ALL_VARIATIONS", course, fullName: course.name, views, scoreColumn: -1 };
}

/** Poängbanans kolumn för poängen: A (0), B (1), H (7) eller ingen (-1) (EventDBUtil.ReadScoreColumnAttribute). */
function scoreColumnOf(course: Course): number {
  const text = (rawAttribute(course.raw, "options", "score-column") ?? "").trim().toUpperCase();
  return text === "B" ? 1 : text === "H" ? 7 : text === "NONE" ? -1 : 0;
}

function scoreView(document: CourseSettingDocument, course: Course): CourseView {
  const scoreColumn = scoreColumnOf(course);
  const items: string[] = [];
  for (let next = course.first, guard = 0; next !== undefined && guard <= Object.keys(document.courseControls).length; guard++) {
    items.push(next);
    next = cc(document, next).next;
  }
  items.sort((a, b) => {
    const x = controlOf(document, cc(document, a).control);
    const y = controlOf(document, cc(document, b).control);
    return KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || (cc(document, a).points ?? 0) - (cc(document, b).points ?? 0)
      || compareCodes(x.code, y.code) || byId(x.id, y.id);
  });
  const showOrdinals = scoreColumn !== 0 && ["SEQUENCE", "SEQUENCE_AND_CODE", "SEQUENCE_AND_SCORE"].includes(course.labelKind);
  let ordinal = firstOrdinal(course);
  const views: ControlView[] = items.map(id => {
    const normal = controlOf(document, cc(document, id).control).kind === "NORMAL";
    return { control: cc(document, id).control, courseControls: [id], ordinal: showOrdinals && normal ? ordinal++ : -1 };
  });
  const targets: (string | undefined)[][] = views.map(() => []);
  if (views.length >= 2 && controlOf(document, views[0]!.control).kind === "MAP_ISSUE" && controlOf(document, views[1]!.control).kind === "START") {
    targets[0] = [views[1]!.courseControls[0]];
  }
  finishViews(document, views, targets);
  return { kind: "SCORE", course, fullName: course.name, views, scoreColumn };
}

/** Poängbanans nummer per kontroll, samma som i beskrivningen (inga när poängen står i kolumn A eller etiketten saknar nummer). */
export function scoreOrdinals(document: CourseSettingDocument, course: Course): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const view of scoreView(document, course).views) if (view.ordinal > 0) out.set(view.control, [view.ordinal]);
  return out;
}

function courseView(document: CourseSettingDocument, courseId: string, variant: string | undefined, part?: number): CourseView {
  if (courseId === "ALL_CONTROLS") return allControlsView(document);
  const course = findCourse(document, courseId);
  if (course.kind === "SCORE") return scoreView(document, course);
  const all = variations(document, courseId);
  if (part !== undefined) {
    const parts = courseParts(document, courseId, variant);
    if (parts.length > 1 && part >= 0 && part < parts.length) {
      const found = all.find(candidate => candidate.code === variant);
      return standardView(document, course, found?.choices ?? null, found?.code ?? "", { index: part, ids: parts[part]! });
    }
  }
  if (all.length === 0 || variant === undefined) {
    if (all.length > 0) return allVariationsView(document, course);
    if (variant !== undefined && variant !== "") throw new CourseSettingEditError("NOT_FOUND", `Varianten ${variant} finns inte`);
    return standardView(document, course, null, "");
  }
  const found = all.find(candidate => candidate.code === variant);
  if (!found) throw new CourseSettingEditError("NOT_FOUND", `Varianten ${variant} finns inte`);
  return standardView(document, course, found.choices, found.code);
}

/** Avrundning till jämnt vid exakt halva (.NET Math.Round). */
function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

const roundTo10 = (meters: number) => roundHalfEven(meters / 10) * 10;
const roundAway = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.sign(value) * Math.round(Math.abs(value) * factor) / factor;
};

/** "4.7 km" eller "4.5–5.0 km" (Util.GetLengthInKm med en decimal). */
function lengthInKm(minMeters: number, maxMeters: number, language: string): string {
  const min = formatDecimal(roundAway(minMeters / 1000, 1).toFixed(1), language);
  const max = formatDecimal(roundAway(maxMeters / 1000, 1).toFixed(1), language);
  return min === max ? `${min} km` : `${min}–${max} km`;
}

class Formatter {
  private readonly textifier: Textifier;
  private readonly key = new Map<string, string>();

  constructor(private readonly document: CourseSettingDocument, private readonly view: CourseView, private readonly context: DescriptionContext, private readonly variant: string | undefined) {
    this.textifier = new Textifier(context);
  }

  private symbol(id: string): SymbolData {
    return this.context.db.get(id, this.context.standard);
  }

  private text(id: string): string {
    return this.context.db.bestText(this.symbol(id).texts, this.context.language, false, "", "")?.text ?? "";
  }

  private titleLines(kind: "TITLE" | "SECONDARY_TITLE", text: string): DescriptionLine[] {
    return text.split("|").map(part => ({ kind, boxes: [part], textual: part }));
  }

  private textLines(text: string | undefined, view: ControlView, textLineKind: TextLineKind): DescriptionLine[] {
    if (text === undefined || text === "") return [];
    return text.split("|").map(part => ({ kind: "TEXT", boxes: [part], textual: part, control: view.control, courseControl: view.courseControls[0], textLineKind }));
  }

  private headerLine(): DescriptionLine {
    const view = this.view;
    const language = this.context.language;
    if (view.kind === "ALL_CONTROLS" || view.kind === "ALL_VARIATIONS") {
      const count = view.views.filter(v => controlOf(this.document, v.control).kind === "NORMAL").length;
      const controls = format(this.text("number_controls"), String(count));
      const name = view.kind === "ALL_CONTROLS" ? this.text("all_controls") : ALL_VARIATIONS[language] ?? ALL_VARIATIONS.en!;
      return { kind: "HEADER_2", boxes: [name, controls], textual: controls };
    }
    if (view.kind === "SCORE") {
      let total = 0;
      for (const v of view.views) if (controlOf(this.document, v.control).kind === "NORMAL") total += cc(this.document, v.courseControls[0]!).points ?? 0;
      const count = view.views.filter(v => controlOf(this.document, v.control).kind === "NORMAL").length;
      const second = total > 0 ? format(this.text("number_points"), String(total)) : format(this.text("number_controls"), String(count));
      return { kind: "HEADER_2", boxes: [view.fullName, second], textual: second };
    }
    // Längden som i banlistan (courseSummaries); en variant får sin egen längd.
    const summary = summaries(this.document).find(s => s.course === view.course!.id)!;
    const override = view.course!.lengthOverrideMeters;
    let min = summary.lengthRangeMeters?.min ?? summary.lengthMeters;
    let max = summary.lengthRangeMeters?.max ?? summary.lengthMeters;
    if (this.variant !== undefined && summary.variants.length > 1) {
      const variant = summary.variants.find(v => v.code === this.variant);
      min = max = override ?? variant?.lengthMeters ?? summary.lengthMeters;
    }
    const length = lengthInKm(min, max, language);
    const climb = view.course!.climbMeters;
    if (climb === undefined || climb < 0) {
      return { kind: "HEADER_3", boxes: [view.fullName, length, null], textual: format(this.text("course_length"), length) };
    }
    const climbText = `${roundAway(climb / 5, 0) * 5} m`;
    return { kind: "HEADER_3", boxes: [view.fullName, length, climbText], textual: format(this.text("course_length_climb"), length, climbText) };
  }

  /** Rad med åtta rutor för start och kontroll (GetRegularLine). */
  private regularLine(view: ControlView): DescriptionLine {
    const control = controlOf(this.document, view.control);
    const courseControl = view.courseControls[0] !== undefined ? cc(this.document, view.courseControls[0]) : undefined;
    const boxes: DescriptionBoxValue[] = new Array<DescriptionBoxValue>(8).fill(null);
    if (control.kind === "START" || control.kind === "MAP_EXCHANGE") boxes[0] = this.symbol("start");
    else if (this.view.kind !== "ALL_CONTROLS" && view.ordinal > 0) boxes[0] = String(view.ordinal);
    if (control.kind === "NORMAL") boxes[1] = control.code ?? "";
    const ids = symbolIds(control);
    for (let i = 2; i < 8; i++) {
      const id = ids[i - 2];
      const symbol = id !== undefined ? this.context.db.find(id, this.context.standard) : undefined;
      if (!symbol || id === undefined) continue;
      boxes[i] = symbol;
      const custom = this.context.customTexts.get(id);
      if (this.context.customKeys.get(id) === true && custom && custom.some(text => text.lang === this.context.language)) {
        this.key.set(id, this.context.db.bestText(custom, this.context.language, false, "", "")?.text ?? "");
      }
    }
    const sizeText = columnFText(control);
    if (sizeText !== undefined) boxes[5] = sizeText;
    if (control.kind === "NORMAL" && this.view.scoreColumn >= 0 && courseControl) {
      const points = courseControl.points ?? 0;
      boxes[this.view.scoreColumn] = points > 0 ? String(points) : null;
    }
    return {
      kind: "NORMAL", boxes, textual: this.textifier.createTextForControl(control, ""),
      control: view.control, courseControl: view.courseControls[0]
    };
  }

  /** Mål, passage eller kartutdelning (GetDirectiveLine). */
  private directiveLine(view: ControlView, previous: ControlView | undefined): DescriptionLine {
    const control = controlOf(this.document, view.control);
    let distance = NaN;
    if (control.kind === "MAP_ISSUE") distance = view.legLength?.[0] ?? NaN;
    else if (previous?.legLength) distance = previous.legLength[0] ?? NaN;
    const distanceText = Number.isNaN(distance) ? "" : `${roundTo10(distance)} m`;
    const defaults: Partial<Record<ControlKind, string>> = { FINISH: "14.3", CROSSING_POINT: "13.3", MAP_ISSUE: "13.6" };
    let directive = symbolIds(control)[0] ?? defaults[control.kind]!;
    if (control.kind === "FINISH" && (this.view.kind === "NORMAL" || this.view.kind === "ALL_VARIATIONS") && previous) {
      const flagging = this.legFlagging(previous.control, view.control);
      if (flagging === "ALL") directive = "14.1";
      else if (flagging === "END") directive = "14.2";
    }
    const symbol = this.context.db.find(directive, this.context.standard) ?? null;
    return {
      kind: "DIRECTIVE",
      boxes: [symbol, control.kind === "FINISH" || control.kind === "MAP_ISSUE" ? distanceText : null],
      textual: this.textifier.createTextForDirective(directive, distanceText) ?? "",
      control: view.control, courseControl: view.courseControls[0]
    };
  }

  /** Snitslingen på sträckan, med målets och kartbytets särfall (QueryEvent.GetLegFlagging). */
  private legFlagging(from: string, to: string): string {
    let flagging = this.document.legs[legKey(from, to)]?.flagging ?? "NONE";
    const toControl = controlOf(this.document, to);
    if (toControl.kind === "FINISH" && symbolIds(toControl)[0] === "14.1") flagging = "ALL";
    if (toControl.kind === "MAP_EXCHANGE") flagging = "ALL";
    if (controlOf(this.document, from).kind === "MAP_ISSUE") flagging = "ALL";
    return flagging;
  }

  /** Snitslad sträcka till nästa kontroll (GetMarkedRouteLine), längden av den snitslade delen. */
  private markedRouteLine(from: ControlView, legId: string): DescriptionLine {
    const leg = this.document.legs[legId]!;
    const points = legPath(this.document, leg.from, leg.to);
    let start = 0;
    let stop = points.length - 1;
    const at = leg.flaggingAt;
    const index = at ? points.findIndex(p => p.x === at.x && p.y === at.y) : -1;
    if (leg.flagging === "BEGINNING") stop = index;
    else if (leg.flagging === "END") start = index;
    let mm = 0;
    for (let i = start + 1; i <= stop; i++) mm += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    const distanceText = `${roundTo10(mm * this.document.event.mapScale / 1000)} m`;
    const id = leg.flagging === "BEGINNING" ? "13.1" : "13.2";
    return {
      kind: "DIRECTIVE", boxes: [this.symbol(id), distanceText], isLeg: true,
      textual: this.textifier.createTextForDirective(id, distanceText) ?? "", control: from.control, courseControl: from.courseControls[0]
    };
  }

  /** Snitsel till kartbyte (GetMapExchangeLine). */
  private mapExchangeLine(from: ControlView): DescriptionLine {
    const distanceText = `${roundTo10(from.legLength?.[0] ?? 0)} m`;
    return {
      kind: "DIRECTIVE", boxes: [this.symbol("13.5"), distanceText], isLeg: true,
      textual: this.textifier.createTextForDirective("13.5", distanceText) ?? "", control: from.control, courseControl: from.courseControls[0]
    };
  }

  /** Kartbyte vid kontrollen eller vänd kartan (GetMapExchangeAtControlLine; vänd kartan finns bara i 2018). */
  private mapExchangeAtControlLine(view: ControlView): DescriptionLine {
    const item = cc(this.document, view.courseControls[0]!);
    const flip = rawFlag(item.raw, "map-flip") && this.context.standard !== "2004";
    const id = flip ? "15.6" : "13.5control";
    const distanceText = flip ? "" : "0 m";
    return {
      kind: "DIRECTIVE", boxes: [this.symbol(id), flip ? null : distanceText],
      textual: this.textifier.createTextForDirective(id, distanceText) ?? "", control: view.control, courseControl: view.courseControls[0]
    };
  }

  private filterControl(control: ControlPoint, previous: ControlPoint | undefined, next: ControlPoint | undefined): boolean {
    switch (this.view.kind) {
      case "ALL_CONTROLS": return true;
      case "SCORE": return control.kind === "NORMAL" || control.kind === "START" || control.kind === "MAP_ISSUE";
      default:
        if (control.kind === "CROSSING_POINT" && previous?.kind === "CROSSING_POINT") return false;
        if (control.kind === "MAP_EXCHANGE" && next === undefined) return false;
        return true;
    }
  }

  private filterLeg(from: ControlPoint, to: ControlPoint | undefined, legId: string | undefined): boolean {
    const flagging = legId ? this.document.legs[legId]?.flagging ?? "NONE" : "NONE";
    if (flagging === "NONE" || flagging === "END" || !to) return false;
    if (to.kind === "FINISH" || to.kind === "MAP_EXCHANGE") return false;
    return from.kind !== "MAP_ISSUE";
  }

  lines(createKey: boolean): DescriptionLine[] {
    const document = this.document;
    const view = this.view;
    const list: DescriptionLine[] = [...this.titleLines("TITLE", document.event.title)];
    if (view.course?.secondaryTitle !== undefined) list.push(...this.titleLines("SECONDARY_TITLE", view.course.secondaryTitle));
    list.push(this.headerLine());
    view.views.forEach((controlView, i) => {
      const control = controlOf(document, controlView.control);
      const courseControl = controlView.courseControls[0] !== undefined ? cc(document, controlView.courseControls[0]) : undefined;
      const previous = i > 0 ? controlOf(document, view.views[i - 1]!.control) : undefined;
      const next = i < view.views.length - 1 ? controlOf(document, view.views[i + 1]!.control) : undefined;
      if (this.filterControl(control, previous, next)) {
        list.push(...this.textLines(control.descriptionTextBefore, controlView, "BEFORE_CONTROL"));
        if (courseControl) list.push(...this.textLines(courseControl.descriptionTextBefore, controlView, "BEFORE_COURSE_CONTROL"));
        const directive = control.kind === "FINISH" || control.kind === "CROSSING_POINT" || control.kind === "MAP_ISSUE";
        list.push(directive ? this.directiveLine(controlView, view.views[i - 1]) : this.regularLine(controlView));
        if (courseControl) list.push(...this.textLines(courseControl.descriptionTextAfter, controlView, "AFTER_COURSE_CONTROL"));
        list.push(...this.textLines(control.descriptionTextAfter, controlView, "AFTER_CONTROL"));
      }
      if (view.kind === "NORMAL" || view.kind === "ALL_VARIATIONS") {
        if (next?.kind === "MAP_EXCHANGE") list.push(this.mapExchangeLine(controlView));
        else if (courseControl && rawFlag(courseControl.raw, "map-exchange") && control.kind !== "MAP_EXCHANGE" && previous) {
          list.push(this.mapExchangeAtControlLine(controlView));
        }
      }
      const target = controlView.legTo?.[0];
      if (target !== undefined && target >= 0) {
        const legId = controlView.legId?.[0];
        if (this.filterLeg(control, controlOf(document, view.views[target]!.control), legId)) list.push(this.markedRouteLine(controlView, legId!));
      }
    });
    if (createKey) for (const [id, text] of this.key) list.push({ kind: "KEY", boxes: [this.symbol(id), text] });
    return list;
  }
}

/** Beskrivningens rader för banan ("ALL_CONTROLS" för alla kontroller); `createKey` ger nyckel för egna symboltexter. */
export function formatDescription(
  document: CourseSettingDocument,
  options: { course: string; variant?: string | undefined; language: string; createKey: boolean; context?: DescriptionContext | undefined;
    /** Kartbyten (ADR-0203): en del av banan. */
    part?: number | undefined }
): { lines: DescriptionLine[]; scoreColumn: number } {
  const context = options.context ?? descriptionContext(document, options.language);
  const view = courseView(document, options.course, options.variant, options.part);
  return { lines: new Formatter(document, view, context, options.variant).lines(options.createKey), scoreColumn: view.scoreColumn };
}

const pad = (text: string, width: number, left: boolean) => (left ? text.padEnd(width) : text.padStart(width));

/** Raderna i Purple Pens testformat (DescriptionFormatter.DumpDescription), för jämförelse med dess förväntade resultat. */
export function dumpDescription(lines: readonly DescriptionLine[]): string {
  const box = (value: DescriptionBoxValue | undefined) => (value === null || value === undefined ? "" : typeof value === "string" ? value : value.id);
  let out = "";
  for (const line of lines) {
    out += line.control !== undefined && line.kind !== "KEY" ? `(${pad(line.control, 3, false)}) |` : "      |";
    switch (line.kind) {
      case "TITLE": case "SECONDARY_TITLE": case "TEXT": out += ` ${pad(box(line.boxes[0]), 46, true)}|`; break;
      case "NORMAL": for (let i = 0; i < 8; i++) out += `${pad(box(line.boxes[i]), 5, false)}|`; break;
      case "HEADER_3": out += `${pad(box(line.boxes[0]), 17, true)}|${pad(box(line.boxes[1]), 17, true)}|${pad(box(line.boxes[2]), 11, true)}|`; break;
      case "HEADER_2": case "KEY": out += `${pad(box(line.boxes[0]), 17, true)}|${pad(box(line.boxes[1]), 29, true)}|`; break;
      case "DIRECTIVE": out += `     ${pad(box(line.boxes[0]), 16, false)}: ${pad(box(line.boxes[1]), 24, true)}|`; break;
    }
    if (line.textual !== undefined) out += `   [${line.textual}]`;
    out += "\n";
  }
  return out;
}

/** ADR-0190: en kontroll i banans vy för IOF-exporten (Purple Pens CourseView.ControlView). */
export interface ExportControlView {
  readonly control: string;
  readonly courseControl: string | undefined;
  /** Kontrollens nummer (> 0 för vanliga kontroller på en vanlig bana). */
  readonly ordinal: number;
  /** Sträckans längd till nästa kontroll i meter (första sträckan vid en gaffling); saknas = ingen sträcka. */
  readonly legLengthMeters: number | undefined;
}

/** ADR-0190: banans vy (variant eller ogafflad bana, poängbanan sorterad som Purple Pen) för IOF-exporten. */
export function courseViewForExport(document: CourseSettingDocument, courseId: string, variant: string | undefined): ExportControlView[] {
  return courseView(document, courseId, variant).views.map(view => ({ control: view.control, courseControl: view.courseControls[0],
    ordinal: view.ordinal, legLengthMeters: view.legTo && view.legTo.length > 0 ? view.legLength![0] : undefined }));
}
