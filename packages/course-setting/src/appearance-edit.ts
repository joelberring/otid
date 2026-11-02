/**
 * Banans utseende för hela banläggningen (Purple Pens "Anpassa utseende", CourseAppearanceDialog; BSD, Peter Golde):
 * ändringen `SET_APPEARANCE`, måtten på papperet och varningarna mot ISOM 2017-2 och ISSprOM 2019-2.
 */
import { appearanceOf, ITEM_SCALINGS, OVERPRINT_SIZES, sizesFor, type Appearance } from "./appearance";
import { formatFloat32, fromRaw, rawName, toRaw } from "./ppen-common";
import type { CourseSettingDocument, OverprintStandard } from "./types";
import { CourseSettingEditError } from "./types";
import { el } from "./xml";

/** Gränserna i Purple Pens dialog, i mm på papperet vid standardens mått. */
export const APPEARANCE_LIMITS = {
  circleMm: { min: 1, max: 50 },
  lineMm: { min: 0.01, max: 10 },
  numberMm: { min: 1, max: 50 },
  autoLegGapMm: { min: 0, max: 50 }
} as const;

/** Attributen i `<course-appearance>` i den ordning Purple Pen skriver dem (Event.WriteAttributesAndContent). */
const ATTRIBUTE_ORDER = [
  "control-circle-size-ratio", "line-width-ratio", "center-dot-diameter", "number-size-ratio", "scale-sizes", "scale-sizes-circle-gaps",
  "number-bold", "number-font", "number-outline-width", "auto-leg-gap-size", "purple-cyan", "purple-magenta", "purple-yellow",
  "purple-black", "blend-purple", "blend-style", "lower-purple-layer"
];

const invalid = (message: string) => new CourseSettingEditError("INVALID", message);
/** Purple Pen lagrar kvoterna som 32-bitarstal; lika där är lika. */
const sameFloat = (a: number, b: number) => Math.fround(a) === Math.fround(b);

function checkChanges(document: CourseSettingDocument, changes: Partial<Appearance>): void {
  const standard = OVERPRINT_SIZES[document.event.overprintStandard];
  const ratio = (value: number | undefined, base: number, limits: { min: number; max: number }, what: string) => {
    if (value === undefined) return;
    if (!(typeof value === "number" && Number.isFinite(value) && value > 0)) throw invalid(`${what} ska vara ett tal större än noll`);
    const mm = value * base;
    if (mm < limits.min - 1e-9 || mm > limits.max + 1e-9) {
      throw invalid(`${what} ger ${mm.toFixed(2)} mm; Purple Pen tillåter ${limits.min}–${limits.max} mm`);
    }
  };
  if (changes.itemScaling !== undefined && !ITEM_SCALINGS.includes(changes.itemScaling)) {
    throw invalid("Skalningen är Ingen, Relativt kartan eller Relativt 1:15 000");
  }
  ratio(changes.circleSize, standard.controlOutside, APPEARANCE_LIMITS.circleMm, "Ringstorleken");
  ratio(changes.lineWidth, standard.line, APPEARANCE_LIMITS.lineMm, "Linjebredden");
  ratio(changes.numberSize, standard.number, APPEARANCE_LIMITS.numberMm, "Nummerstorleken");
  const gap = changes.autoLegGap;
  if (gap !== undefined && !(typeof gap === "number" && Number.isFinite(gap) && gap >= APPEARANCE_LIMITS.autoLegGapMm.min
    && gap <= APPEARANCE_LIMITS.autoLegGapMm.max)) {
    throw invalid(`Avbrottet vid sträckor ska vara ${APPEARANCE_LIMITS.autoLegGapMm.min}–${APPEARANCE_LIMITS.autoLegGapMm.max} mm`);
  }
  if (changes.circleGapsScaled !== undefined && typeof changes.circleGapsScaled !== "boolean") throw invalid("Ringavbrotten anges som ja eller nej");
}

/**
 * Ändringen `SET_APPEARANCE`. Utseendet står i händelsens råa `<course-appearance>` (som Purple Pen läser det, se
 * `appearanceOf`). Ändras inget fält är dokumentet och `raw` orörda. Annars skrivs elementet som Purple Pen skriver det:
 * kvoterna bara när de inte är 1, `scale-sizes` och `auto-leg-gap-size` alltid, nya tal som 32-bitarstal (kortaste
 * formen); fält som inte ändrats behåller sin text, och attribut som O-Tid inte tolkar (typsnitt, lila, blandning …)
 * följer med. `scale-sizes-circle-gaps` skrivs bara när det ändras: Purple Pen skriver alltid true men flyttar då först
 * ringavbrotten i äldre filer (EventDB.FixCircleGaps), vilket O-Tid inte gör.
 */
export function setAppearance(document: CourseSettingDocument, changes: Partial<Appearance>): CourseSettingDocument {
  checkChanges(document, changes);
  const current = appearanceOf(document);
  const defined = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)) as Partial<Appearance>;
  const next: Appearance = { ...current, ...defined };
  const changed = {
    itemScaling: next.itemScaling !== current.itemScaling,
    circleSize: !sameFloat(next.circleSize, current.circleSize),
    lineWidth: !sameFloat(next.lineWidth, current.lineWidth),
    numberSize: !sameFloat(next.numberSize, current.numberSize),
    autoLegGap: !sameFloat(next.autoLegGap, current.autoLegGap),
    circleGapsScaled: next.circleGapsScaled !== current.circleGapsScaled
  };
  if (!Object.values(changed).some(Boolean)) return document;
  const raws = document.event.raw ?? [];
  const index = raws.findIndex(raw => rawName(raw) === "course-appearance");
  const old = index >= 0 ? fromRaw(raws[index]!) : el("course-appearance");
  /** Talets text: den gamla om värdet inte ändrats, annars som Purple Pen. */
  const number = (name: string, value: number, wasChanged: boolean) => {
    const text = old.attrs.find(([key]) => key === name)?.[1];
    return !wasChanged && text !== undefined ? text : formatFloat32(value);
  };
  const ratio = (name: string, value: number, wasChanged: boolean) => (sameFloat(value, 1) ? null : number(name, value, wasChanged));
  const own = new Map<string, string | null>([
    ["control-circle-size-ratio", ratio("control-circle-size-ratio", next.circleSize, changed.circleSize)],
    ["line-width-ratio", ratio("line-width-ratio", next.lineWidth, changed.lineWidth)],
    ["number-size-ratio", ratio("number-size-ratio", next.numberSize, changed.numberSize)],
    ["scale-sizes", next.itemScaling],
    ["auto-leg-gap-size", number("auto-leg-gap-size", next.autoLegGap, changed.autoLegGap)]
  ]);
  if (changed.circleGapsScaled) own.set("scale-sizes-circle-gaps", next.circleGapsScaled ? "true" : null);
  const attrs: [string, string][] = old.attrs.filter(([name]) => !own.has(name));
  for (const [name, value] of own) if (value !== null) attrs.push([name, value]);
  const rank = (name: string) => (ATTRIBUTE_ORDER.includes(name) ? ATTRIBUTE_ORDER.indexOf(name) : ATTRIBUTE_ORDER.length);
  const sorted = attrs.map((entry, order) => ({ entry, order }))
    .sort((a, b) => rank(a.entry[0]) - rank(b.entry[0]) || a.order - b.order).map(item => item.entry);
  const element = toRaw(el("course-appearance", sorted, old.children));
  const list = [...raws];
  if (index >= 0) list[index] = element; else list.push(element);
  return { ...document, event: { ...document.event, raw: list } };
}

/** Mått på papperet i mm: ringens ytterdiameter (med linjen), linjens bredd och siffrornas höjd. */
export interface PaperSizes {
  readonly circle: number;
  readonly line: number;
  readonly number: number;
}

/** Banpåtryckets mått på papperet vid en utskriftsskala, med dokumentets utseende (och avbrottet vid sträckor). */
export function paperSizesFor(document: CourseSettingDocument, printScale: number): PaperSizes & { readonly autoLegGap: number } {
  const sizes = sizesFor(document, printScale);
  const k = document.event.mapScale / printScale;
  return { circle: (sizes.control + sizes.line) * k, line: sizes.line * k, number: sizes.numberHeight * k, autoLegGap: sizes.autoLegGap * k };
}

/**
 * Det som standarden anger på papperet vid utskriftsskalan. ISOM 2017-2 (2.9.1 och 3.7): måtten gäller 1:15 000 och
 * förstoras i proportion vid större skala (150 % i 1:10 000, 300 % i 1:5 000). ISSprOM 2019-2: standardens mått.
 */
export function standardPaperSizes(standard: OverprintStandard, printScale: number): PaperSizes {
  const base = OVERPRINT_SIZES[standard];
  const factor = standard === "ISOM2017" && printScale < 15000 ? 15000 / printScale : 1;
  return { circle: base.controlOutside * factor, line: base.line * factor, number: base.number * factor };
}

/** Avvikelse från standarden som ger varning (2 %; 32-bitarstal och avrundade kvoter ger mindre). */
export const APPEARANCE_TOLERANCE = 0.02;

export interface AppearanceWarning {
  readonly field: keyof PaperSizes;
  readonly printScale: number;
  readonly actual: number;
  readonly expected: number;
}

/** Utskriftsskalorna som används (banornas och Alla kontrollers), minsta skaltalet först. */
export function printScalesInUse(document: CourseSettingDocument): number[] {
  const all = document.event.allControlsPrintScale ?? document.event.mapScale;
  return [...new Set([all, ...document.courses.map(course => course.printScale ?? document.event.mapScale)])].sort((a, b) => a - b);
}

/** Måtten som går utanför ISOM 2017-2 eller ISSprOM 2019-2 vid utskriftsskalorna (alla som används om inget anges). */
export function appearanceWarnings(document: CourseSettingDocument, printScales: readonly number[] = printScalesInUse(document)): AppearanceWarning[] {
  const out: AppearanceWarning[] = [];
  for (const printScale of printScales) {
    const actual = paperSizesFor(document, printScale);
    const expected = standardPaperSizes(document.event.overprintStandard, printScale);
    for (const field of ["circle", "line", "number"] as const) {
      if (Math.abs(actual[field] / expected[field] - 1) > APPEARANCE_TOLERANCE) out.push({ field, printScale, actual: actual[field], expected: expected[field] });
    }
  }
  return out;
}
