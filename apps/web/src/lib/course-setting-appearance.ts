import {
  APPEARANCE_LIMITS, appearanceOf, appearanceWarnings, controlLabelText, courseControlOrder, OVERPRINT_SIZES, paperSizesFor, printScalesInUse,
  standardPaperSizes, type Appearance, type AppearanceWarning, type Course, type CourseSettingDocument, type CourseSettingEdit,
  type OverprintPrimitive, type OverprintStandard
} from "@o-tid/course-setting";

/**
 * Banans utseende och etiketten vid kontrollen (ADR-0180 beslut 12) utan React: snabbvalen, kvoterna i mm på papperet,
 * varningarna mot standarden, etikettens val och ändringarna för en eller flera banor.
 */
export type LabelKind = Course["labelKind"];
export type AppearanceField = "circleSize" | "lineWidth" | "numberSize";

/**
 * Snabbval. Bara standardernas mått (ISOM 2017-2, ISSprOM 2019-2) eller mått som står med sitt ursprung; ett snabbval
 * ändrar bara sina fält, så att de går att kombinera (t.ex. förstorat och mindre nummer).
 */
export interface AppearancePreset {
  readonly id: "standard" | "enlarged" | "sprint-rings" | "smaller-numbers";
  readonly changes: Partial<Appearance>;
  /** Standarder där valet finns (förstoring och sprintens ring bara för ISOM 2017-2). */
  readonly standards: readonly OverprintStandard[];
}

export const APPEARANCE_PRESETS: readonly AppearancePreset[] = [
  { id: "standard", changes: { circleSize: 1, lineWidth: 1, numberSize: 1 }, standards: ["ISOM2017", "ISSPROM2019"] },
  // ISOM 2017-2 2.9.1 och 3.7: i 1:10 000 förstoras allt, också banpåtrycket, till 150 % (Purple Pens "Relativt 1:15 000").
  { id: "enlarged", changes: { itemScaling: "RelativeTo15000" }, standards: ["ISOM2017"] },
  // ISSprOM 2019-2:s ring (6,0 mm + linjen) på en skogskarta.
  { id: "sprint-rings", changes: { circleSize: OVERPRINT_SIZES.ISSPROM2019.controlOutside / OVERPRINT_SIZES.ISOM2017.controlOutside }, standards: ["ISOM2017"] },
  // 3,0 mm: Purple Pens storlek för koderna i Alla kontroller.
  { id: "smaller-numbers", changes: { numberSize: 0.75 }, standards: ["ISOM2017", "ISSPROM2019"] }
];

const same = (a: unknown, b: unknown) => typeof a === "number" && typeof b === "number" ? Math.fround(a) === Math.fround(b) : a === b;

export function presetsFor(standard: OverprintStandard): readonly AppearancePreset[] {
  return APPEARANCE_PRESETS.filter(preset => preset.standards.includes(standard));
}

/** Gäller snabbvalet redan (alla dess fält har dess värden)? */
export function presetActive(appearance: Appearance, preset: AppearancePreset): boolean {
  return Object.entries(preset.changes).every(([key, value]) => same(appearance[key as keyof Appearance], value));
}

/** Ändringen; `undefined` om inget ändras (så att ångra-historiken inte får tomma steg). */
export function appearanceEdit(document: CourseSettingDocument, changes: Partial<Appearance>): CourseSettingEdit | undefined {
  const current = appearanceOf(document);
  const changed = Object.fromEntries(Object.entries(changes).filter(([key, value]) => value !== undefined && !same(current[key as keyof Appearance], value)));
  return Object.keys(changed).length > 0 ? { type: "SET_APPEARANCE", changes: changed } : undefined;
}

/** Talet med svenskt decimaltecken: högst två decimaler, minst en ("6,0", "5,35", "0,7"). */
export function formatMm(value: number): string {
  const rounded = Math.round(value * 100 + 1e-6) / 100;
  const text = Number.isInteger(rounded * 10) ? rounded.toFixed(1) : rounded.toFixed(2);
  return text.replace(".", ",");
}

/** Kvoten som den visas i fältet ("1", "1.121", "0.75"): högst fyra decimaler. */
export function formatRatio(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

/** Tal ur ett fält: punkt eller komma. `undefined` om det inte är ett tal. */
export function parseDecimal(text: string): number | undefined {
  const value = Number(text.trim().replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) ? value : undefined;
}

/** Standardens mått för fältet (mm på papperet vid 1:15 000 för ISOM) och Purple Pens gränser. */
export function fieldBase(standard: OverprintStandard, field: AppearanceField): { readonly mm: number; readonly min: number; readonly max: number } {
  const sizes = OVERPRINT_SIZES[standard];
  switch (field) {
    case "circleSize": return { mm: sizes.controlOutside, ...APPEARANCE_LIMITS.circleMm };
    case "lineWidth": return { mm: sizes.line, ...APPEARANCE_LIMITS.lineMm };
    case "numberSize": return { mm: sizes.number, ...APPEARANCE_LIMITS.numberMm };
  }
}

/** Kvoten inom Purple Pens gränser? (gränserna är i mm) */
export function ratioAllowed(standard: OverprintStandard, field: AppearanceField, ratio: number): boolean {
  const base = fieldBase(standard, field);
  return ratio > 0 && ratio * base.mm >= base.min - 1e-9 && ratio * base.mm <= base.max + 1e-9;
}

const PAPER_FIELD = { circleSize: "circle", lineWidth: "line", numberSize: "number" } as const;

/** Vad fältet ger på papperet vid skalan: standardens mått → dokumentets ("5,35 → 6,0"). */
export function paperChange(document: CourseSettingDocument, field: AppearanceField, printScale: number): { readonly standard: number; readonly actual: number } {
  const key = PAPER_FIELD[field];
  return { standard: standardPaperSizes(document.event.overprintStandard, printScale)[key], actual: paperSizesFor(document, printScale)[key] };
}

/** Skalan som måtten visas för: vald banas utskriftsskala, annars Alla kontrollers. */
export function referenceScale(document: CourseSettingDocument, view: string): number {
  const course = document.courses.find(row => row.id === view);
  return course?.printScale ?? (course ? document.event.mapScale : document.event.allControlsPrintScale ?? document.event.mapScale);
}

export interface ScaleRow {
  readonly printScale: number;
  readonly courses: readonly string[];
  readonly circle: number;
  readonly line: number;
  readonly number: number;
  readonly warnings: readonly AppearanceWarning[];
}

/** En rad per utskriftsskala som används, med banorna, måtten på papperet och varningarna. */
export function scaleRows(document: CourseSettingDocument): ScaleRow[] {
  const warnings = appearanceWarnings(document);
  const all = document.event.allControlsPrintScale ?? document.event.mapScale;
  return printScalesInUse(document).map(printScale => {
    const sizes = paperSizesFor(document, printScale);
    const courses = [...document.courses].sort((a, b) => a.order - b.order)
      .filter(course => (course.printScale ?? document.event.mapScale) === printScale).map(course => course.name);
    return { printScale, courses: printScale === all ? [...courses, ALL_CONTROLS_NAME] : courses, circle: sizes.circle, line: sizes.line,
      number: sizes.number, warnings: warnings.filter(warning => warning.printScale === printScale) };
  });
}

export const ALL_CONTROLS_NAME = "Alla kontroller";

// Etiketten vid kontrollen.

export const NORMAL_LABEL_KINDS: readonly LabelKind[] = ["SEQUENCE", "CODE", "SEQUENCE_AND_CODE"];
export const SCORE_LABEL_KINDS: readonly LabelKind[] = [...NORMAL_LABEL_KINDS, "SCORE", "CODE_AND_SCORE", "SEQUENCE_AND_SCORE"];

/** Valen för banan: poängvarianterna bara för poängbanor (som Purple Pen). */
export function labelKindsFor(course: Course): readonly LabelKind[] {
  return course.kind === "SCORE" ? SCORE_LABEL_KINDS : NORMAL_LABEL_KINDS;
}

/** Ett litet exempel för valet med banans första kontroll ("1", "31", "1-31"); utan kontroller kod 31 och 30 poäng. */
export function labelExample(document: CourseSettingDocument, course: Course, kind: LabelKind): string {
  const first = safeOrder(document, course.id).map(id => document.courseControls[id]).find(item => item && document.controls[item.control]?.kind === "NORMAL");
  const code = (first && document.controls[first.control]?.code) || "31";
  const points = first?.points !== undefined && first.points > 0 ? first.points : 30;
  return controlLabelText(kind, { ordinals: [1], code, points }) ?? "";
}

function safeOrder(document: CourseSettingDocument, course: string): readonly string[] {
  try { return courseControlOrder(document, course); } catch { return []; }
}

/** Stafettbanor: banor med stafettens lag och sträckor (Purple Pens `<relay>`). */
export function relayCourses(document: CourseSettingDocument): readonly Course[] {
  return document.courses.filter(course => course.relay !== undefined);
}

/** Ändringarna som ger banorna etiketten (de som redan har den, och de där valet inte finns, hoppas över). */
export function labelKindEdits(courses: readonly Course[], kind: LabelKind): CourseSettingEdit[] {
  return courses.filter(course => course.labelKind !== kind && labelKindsFor(course).includes(kind))
    .map(course => ({ type: "UPDATE_COURSE", course: course.id, changes: { labelKind: kind } }));
}

/**
 * Det som kartans banpåtryck visar, för testerna och skärmläsare: numrens texter och kontrollringens ytterdiameter i
 * kartans mm (första ringen).
 */
export function overprintProbe(primitives: readonly OverprintPrimitive[]): { readonly labels: string; readonly ring: string | undefined } {
  const labels = primitives.flatMap(p => p.kind === "text" && p.role === "NUMBER" ? [p.text] : []).slice(0, 60).join(" ");
  const ring = primitives.find(p => p.kind === "circle" && p.role === "CONTROL");
  return { labels, ring: ring && ring.kind === "circle" ? (ring.diameter + ring.lineWidth).toFixed(3) : undefined };
}
