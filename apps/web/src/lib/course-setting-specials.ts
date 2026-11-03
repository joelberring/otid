import {
  printScaleOf, specialPointCount, type CourseSettingDocument, type CourseSettingEdit, type SpecialInput, type SpecialKind, type SpecialObject
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { applySteps, type Apply, type EditorState } from "./course-setting-editor";

/**
 * Steg 64: specialobjekten i editorn utan React. Verktyget SPECIAL skapar `specialKind`: punktobjekt, text och beskrivningen
 * med ett klick, ytor och linjer med ett klick per hörn (avslutas med Enter, "Klar" eller ett klick på första punkten),
 * rektangel och ellips med två klick. Som i Purple Pen syns nya objekt på alla banor. Kontrollbeskrivningen är inget
 * kartobjekt här: den placeras på papperet i utskriften (`paper-layout.ts` i paketet).
 */
export const SPECIAL_TOOL_KINDS: readonly SpecialKind[] = [
  "out-of-bounds", "white-out", "optional-crossing-point", "text", "forbidden-route", "dangerous-area", "temporary-construction",
  "boundary", "line", "rectangle", "ellipse", "first-aid", "water", "registration-mark", "image"
];

/** Bildens bredd på papperet när den läggs ut (mm); höjden följer bildens proportioner. */
export const IMAGE_WIDTH_PAPER_MM = 25;

/** Mått på papperet (mm) som kartans mm vid banans utskriftsskala. */
export function paperToMap(document: CourseSettingDocument, view: string, paperMm: number): number {
  return paperMm * printScaleOf(document, view) / document.event.mapScale;
}

/** Ett nytt objekt med Purple Pens förval (text 4 mm siffhöjd på papperet, beskrivning 6 mm rutor). */
export function specialInput(document: CourseSettingDocument, view: string, kind: SpecialKind, points: readonly Point[],
  image?: { readonly format: string; readonly data: string; readonly aspect: number }): SpecialInput {
  const at = points[0]!;
  switch (kind) {
    case "image": {
      // ADR-0180 beslut 14: ett klick ger övre vänstra hörnet; bredden 25 mm på papperet och bildens proportioner.
      if (!image || points.length > 1) return { kind, points: [...points] };
      const width = paperToMap(document, view, IMAGE_WIDTH_PAPER_MM);
      return { kind, points: [at, { x: at.x + width, y: at.y - width * image.aspect }], image: { format: image.format, data: image.data } };
    }
    case "text": {
      const height = paperToMap(document, view, 4);
      return { kind, points: [at, { x: at.x + 12 * height, y: at.y - 1.5 * height }], text: "Text", font: { name: "Arial", bold: false, italic: false, height },
        color: "purple" };
    }
    case "optional-crossing-point": return { kind, points: [at], orientation: 0 };
    case "line": case "rectangle": case "ellipse":
      return { kind, points: [...points], color: "purple", line: { kind: "single", width: 0.35, gapSize: 0, dashSize: 0, ...(kind === "rectangle" ? { cornerRadius: 0 } : {}) } };
    default: return { kind, points: [...points] };
  }
}

/** Antal klick som slaget tar (Infinity = tills det avslutas). */
export function clicksFor(kind: SpecialKind, image?: unknown): number {
  if (kind === "text" || (kind === "image" && image)) return 1;
  const { min, max } = specialPointCount(kind);
  return min === max ? max : Infinity;
}

function create(state: EditorState, points: readonly Point[], apply: Apply): EditorState {
  const kind = state.specialKind!;
  const edit: CourseSettingEdit = { type: "ADD_SPECIAL", special: specialInput(state.document, state.view, kind, points, state.specialImage) };
  const next = applySteps({ ...state, drawing: undefined, ...(kind === "image" ? { specialImage: undefined } : {}) }, [edit], apply,
    (created, document) => created && document.specialObjects.some(special => special.id === created) ? { kind: "special", special: created } : undefined);
  return next.error ? { ...next, drawing: undefined } : next;
}

/** Ett klick med verktyget SPECIAL. `closeMm` = hur nära första punkten ett klick avslutar ytan. */
export function clickSpecial(state: EditorState, at: Point, apply: Apply, closeMm: number): EditorState {
  const kind = state.specialKind;
  if (!kind) return state;
  const points = [...(state.drawing ?? []), at];
  if (kind === "image" && !state.specialImage) return { ...state, error: "Välj en bild först (Objekt → Bild)." };
  const clicks = clicksFor(kind, state.specialImage);
  if (points.length >= clicks) return create(state, points, apply);
  const first = state.drawing?.[0];
  if (clicks === Infinity && first && points.length > specialPointCount(kind).min && Math.hypot(at.x - first.x, at.y - first.y) <= closeMm) {
    return create(state, points.slice(0, -1), apply);
  }
  return { ...state, drawing: points, error: undefined };
}

/** Avsluta ytan eller linjen som ritas (Enter, "Klar"). För få punkter: inget görs. */
export function finishDrawing(state: EditorState, apply: Apply): EditorState {
  const kind = state.specialKind;
  const points = state.drawing ?? [];
  if (!kind || points.length < specialPointCount(kind).min) return state;
  return create(state, points, apply);
}

/** Handtagen för ett valt objekt: hörnen (ytor, linjer, två hörn) eller punkten. */
export function specialHandles(special: SpecialObject): readonly Point[] {
  return special.points;
}

/** Närmaste handtag inom toleransen. */
export function nearestHandle(special: SpecialObject, point: Point, toleranceMm: number): number | undefined {
  let best: number | undefined, distance = toleranceMm;
  special.points.forEach((handle, index) => {
    const d = Math.hypot(handle.x - point.x, handle.y - point.y);
    if (d <= distance) { distance = d; best = index; }
  });
  return best;
}

/** Objektet flyttat `dx`, `dy` (hela) eller med ett hörn på `at`. */
export function moveSpecialEdit(special: SpecialObject, move: { dx: number; dy: number } | { index: number; at: Point }): CourseSettingEdit {
  if ("index" in move) {
    return { type: "MOVE_SPECIAL", special: special.id, points: special.points.map((p, i) => i === move.index ? move.at : p) };
  }
  return { type: "MOVE_SPECIAL", special: special.id, points: special.points.map(p => ({ x: p.x + move.dx, y: p.y + move.dy })) };
}
