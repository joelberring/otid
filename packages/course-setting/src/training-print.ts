/**
 * Utskriften för träningsformerna (ADR-0192 beslut 6): stjärnans uddar och kepsens kartor som egna kartor, kartbitar för
 * minnes- och pusselorientering (en liten ram per sträcka, flera på ett A4).
 */
import type { MapRect } from "./types";
import type { CourseSettingDocument } from "./types";
import type { Sheet, SheetFrame, SheetItem, SheetText } from "./sheet-layout";
import { layout, printScaleOf } from "./overprint";
import { figureBounds, printRectangle } from "./page-layout";
import type { PieceTraining } from "./training-types";
import { controlSequences, metersToMm } from "./training-regions";
import { trainingOf } from "./training-passes";

export const DEFAULT_PIECES: PieceTraining = { sizeMm: 60, marginMeters: 40, order: "COURSE" };

/**
 * Stjärnans uddar: positionerna från en mittkontroll till nästa (ut och tillbaka). Start före den första mitten hör till den
 * första udden och mål efter den sista till den sista.
 */
export function starSpokes(document: CourseSettingDocument, sequence: readonly string[], center: string): { from: number; to: number }[] {
  const at = sequence.flatMap((ccId, index) => document.courseControls[ccId]?.control === center ? [index] : []);
  if (at.length < 2) return at.length === 1 ? [{ from: 0, to: sequence.length - 1 }] : [];
  const out = at.slice(0, -1).map((from, index) => ({ from, to: at[index + 1]! }));
  out[0] = { ...out[0]!, from: 0 };
  out[out.length - 1] = { ...out[out.length - 1]!, to: sequence.length - 1 };
  return out;
}

/**
 * Kartorna för valda banor med träningen: en per udd i stjärnan (`PER_CONTROL`), löpare A och B i kepsen (`SEPARATE`),
 * och kontrollantens karta i linjeorienteringen när den efterfrågas.
 */
export function expandTrainingItems(document: CourseSettingDocument, items: readonly SheetItem[], options: { readonly controllerMaps?: boolean } = {}): SheetItem[] {
  const training = trainingOf(document);
  return items.flatMap(item => {
    const ct = training.courses[item.course];
    if (!ct) return [item];
    let out: SheetItem[] = [item];
    if (ct.star?.print === "PER_CONTROL") {
      const sequence = controlSequences(document, item.course, item.variant)[0] ?? [];
      const spokes = starSpokes(document, sequence, ct.star.center);
      if (spokes.length > 0) out = spokes.map(section => ({ ...item, training: { ...item.training, section } }));
    } else if (ct.pairs?.print === "SEPARATE") {
      out = (["A", "B"] as const).map(pairMap => ({ ...item, training: { ...item.training, pairMap } }));
    }
    if (ct.line && options.controllerMaps) out = [...out, { ...item, training: { ...item.training, view: "CONTROLLER" as const } }];
    return out;
  });
}

/** Samma blandning varje gång (förhandsvisningen och PDF:en). */
function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  const next = () => { state = Math.imul(state ^ (state >>> 15), 2246822507) ^ Math.imul(state ^ (state >>> 13), 3266489909); return ((state >>>= 0) % 100000) / 100000; };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}

const A4 = { widthMm: 210, heightMm: 297 };
const MARGIN = 10, GAP = 6, LABEL = 5, TITLE = 8;

/** Kartbitarna för en bana: en ram per sträcka, i banans ordning eller blandade, så många per A4 som får plats. */
export function trainingPieceSheets(document: CourseSettingDocument, item: SheetItem, options: { readonly mapBounds?: MapRect | undefined } = {}): Sheet[] {
  const settings = trainingOf(document).courses[item.course]?.pieces ?? DEFAULT_PIECES;
  const course = document.courses.find(row => row.id === item.course);
  if (!course) return [];
  const sequence = controlSequences(document, item.course, item.variant)[0] ?? [];
  const control = (i: number) => document.controls[document.courseControls[sequence[i]!]?.control ?? ""];
  // Numren som på kartan: vanliga kontroller i ordning, S och M.
  let ordinal = 0;
  const names = sequence.map((_, i) => {
    const kind = control(i)?.kind;
    return kind === "START" ? "S" : kind === "FINISH" ? "M" : kind === "NORMAL" ? String(++ordinal) : "·";
  });
  const legs: { from: number; to: number; label: string }[] = [];
  for (let i = 0; i + 1 < sequence.length; i++) {
    if (control(i)?.id === control(i + 1)?.id) continue;
    legs.push({ from: i, to: i + 1, label: `${names[i]}–${names[i + 1]}` });
  }
  const ordered = settings.order === "SHUFFLED"
    ? seededShuffle(legs, `${item.course}|${item.variant ?? ""}`).map((leg, index) => ({ ...leg, label: String.fromCharCode(65 + (index % 26)) + (index >= 26 ? String(Math.floor(index / 26)) : "") }))
    : legs;
  const size = settings.sizeMm;
  const columns = Math.max(1, Math.floor((A4.widthMm - 2 * MARGIN + GAP) / (size + GAP)));
  const rows = Math.max(1, Math.floor((A4.heightMm - 2 * MARGIN - TITLE + GAP) / (size + LABEL + GAP)));
  const perSheet = columns * rows;
  const baseScale = settings.scale ?? printScaleOf(document, item.course, item.printScale);
  const margin = metersToMm(document, settings.marginMeters);
  const frames: { frame: SheetFrame; text: SheetText }[] = ordered.map((leg, index) => {
    const slot = index % perSheet;
    const x = MARGIN + (slot % columns) * (size + GAP), y = MARGIN + TITLE + Math.floor(slot / columns) * (size + LABEL + GAP) + LABEL;
    const training = { ...item.training, section: { from: leg.from, to: leg.to } };
    const figuresAt = (printScale: number) => layout(document, { course: item.course, ...(item.variant ? { variant: item.variant } : {}), printScale, training });
    let printScale = baseScale;
    let figures = figuresAt(printScale);
    const bounds = figureBounds(figures);
    if (bounds) {
      // Sträckan och marginalen ska rymmas i biten: större skala om den inte gör det.
      const need = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + 2 * margin;
      const ratio = Math.max(printScale / document.event.mapScale, need / size);
      if (ratio * document.event.mapScale > printScale * 1.001) { printScale = Math.round(ratio * document.event.mapScale / 500) * 500 + 500; figures = figuresAt(printScale); }
    }
    const ratio = printScale / document.event.mapScale;
    const mapArea = printRectangle({ automatic: true, restrictToPageSize: true }, { width: size * ratio, height: size * ratio }, figureBounds(figures), options.mapBounds);
    const scale = 1 / ratio;
    const frame: SheetFrame = { course: item.course, ...(item.variant ? { variant: item.variant } : {}), title: `${course.name} ${leg.label}`,
      mapScale: document.event.mapScale, printScale, mapArea, clip: { x, y, width: size, height: size },
      transform: { scale, translateX: x - mapArea.minX * scale, translateY: y + mapArea.maxY * scale }, figures };
    const scaleText = printScale !== baseScale ? `  1:${Math.round(printScale).toLocaleString("sv-SE").replace(/\s/g, " ")}` : "";
    const text: SheetText = { text: `${leg.label}${scaleText}`, at: { x, y: y - 1.2 }, heightMm: 3.5, bold: true, align: "left", rotation: 0, color: "BLACK" };
    return { frame, text };
  });
  const sheets: Sheet[] = [];
  for (let start = 0; start < frames.length; start += perSheet) {
    const part = frames.slice(start, start + perSheet);
    const title: SheetText = { text: `${course.name} – ${settings.order === "SHUFFLED" ? "pussel" : "kartbitar"}${frames.length > perSheet ? ` (${sheets.length + 1})` : ""}`,
      at: { x: MARGIN, y: MARGIN + 5 }, heightMm: 4.5, bold: true, align: "left", rotation: 0, color: "BLACK" };
    sheets.push({ paper: { widthMm: A4.widthMm, heightMm: A4.heightMm, landscape: false, marginMm: MARGIN }, frames: part.map(row => row.frame),
      texts: [title, ...part.map(row => row.text)], images: [], descriptions: [], boxes: [], cutMarks: [] });
  }
  return sheets;
}
