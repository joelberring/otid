import {
  printScaleOf, specialPointCount, type CourseSettingDocument, type CourseSettingEdit, type SpecialInput, type SpecialKind, type SpecialObject
} from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { applySteps, type Apply, type EditorState } from "./course-setting-editor";
import { ALL_CONTROLS } from "./course-setting-hit";

/**
 * Steg 64: specialobjekten i editorn utan React. Verktyget SPECIAL skapar `specialKind`: punktobjekt, text och beskrivningen
 * med ett klick, ytor och linjer med ett klick per hörn (avslutas med Enter, "Klar" eller ett klick på första punkten),
 * rektangel och ellips med två klick. Som i Purple Pen syns nya objekt på alla banor; beskrivningen bara på banan.
 */
export const SPECIAL_TOOL_KINDS: readonly SpecialKind[] = [
  "out-of-bounds", "white-out", "optional-crossing-point", "descriptions", "text", "forbidden-route", "dangerous-area", "temporary-construction",
  "boundary", "line", "rectangle", "ellipse", "first-aid", "water", "registration-mark", "image"
];

/** Bildens bredd på papperet när den läggs ut (mm); höjden följer bildens proportioner. */
export const IMAGE_WIDTH_PAPER_MM = 25;

/** Mått på papperet (mm) som kartans mm vid banans utskriftsskala. */
export function paperToMap(document: CourseSettingDocument, view: string, paperMm: number): number {
  return paperMm * printScaleOf(document, view) / document.event.mapScale;
}

/** Beskrivningen på kartan för banan (eller Alla kontroller), om den finns. */
export function descriptionOn(document: CourseSettingDocument, view: string): SpecialObject | undefined {
  const course = view === ALL_CONTROLS ? "0" : view;
  return document.specialObjects.find(special => special.kind === "descriptions" && (special.courses.length === 0 || special.courses.includes(course)));
}

/** Ett nytt objekt med Purple Pens förval (text 4 mm siffhöjd på papperet, beskrivning 6 mm rutor). */
export function specialInput(document: CourseSettingDocument, view: string, kind: SpecialKind, points: readonly Point[],
  image?: { readonly format: string; readonly data: string; readonly aspect: number }): SpecialInput {
  const at = points[0]!;
  switch (kind) {
    case "image": {
      // ADR-0180 beslut 12: ett klick ger övre vänstra hörnet; bredden 25 mm på papperet och bildens proportioner.
      if (!image || points.length > 1) return { kind, points: [...points] };
      const width = paperToMap(document, view, IMAGE_WIDTH_PAPER_MM);
      return { kind, points: [at, { x: at.x + width, y: at.y - width * image.aspect }], image: { format: image.format, data: image.data } };
    }
    case "text": {
      const height = paperToMap(document, view, 4);
      return { kind, points: [at, { x: at.x + 12 * height, y: at.y - 1.5 * height }], text: "Text", font: { name: "Arial", bold: false, italic: false, height },
        color: "purple" };
    }
    case "descriptions": {
      const cell = paperToMap(document, view, 6);
      return { kind, points: [at, { x: at.x + cell, y: at.y }], courses: [view === ALL_CONTROLS ? "0" : view] };
    }
    case "optional-crossing-point": return { kind, points: [at], orientation: 0 };
    case "line": case "rectangle": case "ellipse":
      return { kind, points: [...points], color: "purple", line: { kind: "single", width: 0.35, gapSize: 0, dashSize: 0, ...(kind === "rectangle" ? { cornerRadius: 0 } : {}) } };
    default: return { kind, points: [...points] };
  }
}

/** Antal klick som slaget tar (Infinity = tills det avslutas). */
export function clicksFor(kind: SpecialKind, image?: unknown): number {
  if (kind === "text" || kind === "descriptions" || (kind === "image" && image)) return 1;
  const { min, max } = specialPointCount(kind);
  return min === max ? max : Infinity;
}

function create(state: EditorState, points: readonly Point[], apply: Apply): EditorState {
  const kind = state.specialKind!;
  const existing = kind === "descriptions" ? descriptionOn(state.document, state.view) : undefined;
  // En bana har en beskrivning på kartan: finns den flyttas den hit.
  const edit: CourseSettingEdit = existing
    ? { type: "MOVE_SPECIAL", special: existing.id, points: [points[0]!, { x: points[0]!.x + (existing.points[1]!.x - existing.points[0]!.x),
      y: points[0]!.y + (existing.points[1]!.y - existing.points[0]!.y) }] }
    : { type: "ADD_SPECIAL", special: specialInput(state.document, state.view, kind, points, state.specialImage) };
  const next = applySteps({ ...state, drawing: undefined, ...(kind === "image" ? { specialImage: undefined } : {}) }, [edit], apply,
    (created, document) => {
      const id = existing?.id ?? created;
      return id && document.specialObjects.some(special => special.id === id) ? { kind: "special", special: id } : undefined;
    });
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
    // Beskrivningens andra punkt är rutans sida: den följer med när hörnet flyttas.
    if (special.kind === "descriptions") {
      const side = { x: special.points[1]!.x - special.points[0]!.x, y: special.points[1]!.y - special.points[0]!.y };
      return { type: "MOVE_SPECIAL", special: special.id, points: move.index === 0 ? [move.at, { x: move.at.x + side.x, y: move.at.y + side.y }]
        : [special.points[0]!, { x: special.points[0]!.x + Math.max(0.5, Math.hypot(move.at.x - special.points[0]!.x, move.at.y - special.points[0]!.y)), y: special.points[0]!.y }] };
    }
    return { type: "MOVE_SPECIAL", special: special.id, points: special.points.map((p, i) => i === move.index ? move.at : p) };
  }
  return { type: "MOVE_SPECIAL", special: special.id, points: special.points.map(p => ({ x: p.x + move.dx, y: p.y + move.dy })) };
}
