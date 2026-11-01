import type { CourseSettingNote, CourseSettingNoteTarget } from "@o-tid/contracts";
import type { CourseSettingDocument } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";
import { ALL_CONTROLS, type HitTarget } from "./course-setting-hit";

/**
 * Steg 66 (ADR-0181 beslut 1): notiserna på kartan. Var en notis står (punkten, kontrollen, sträckans mitt), vilka som
 * visas (öppna eller alla, den valda banan), träff-test för markeringarna och vad ett klick med verktyget Notis fäster
 * den vid. Inga antaganden om mus eller skärmstorlek: träffytan ges i mm (steg 67 bygger mobilvyn på detta).
 */
export type NoteFilter = "OPEN" | "DONE" | "ALL";

export interface NoteMark {
  readonly id: string;
  readonly at: Point;
  readonly status: CourseSettingNote["status"];
  readonly count: number;
}

const middle = (points: readonly Point[]): Point | undefined => {
  if (points.length === 0) return undefined;
  let total = 0;
  const lengths = points.slice(1).map((point, index) => { const length = Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y); total += length; return length; });
  let left = total / 2;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (left <= length && length > 0) {
      const from = points[index]!, to = points[index + 1]!, share = left / length;
      return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
    }
    left -= length;
  }
  return points[0];
};

/** Notisens läge på kartan nu (kontrollen kan ha flyttats); undefined för en bana utan läge. */
export function notePosition(note: Pick<CourseSettingNote, "target" | "at">, document: CourseSettingDocument): Point | undefined {
  const target = note.target;
  if (target.kind === "POINT") return target.at;
  if (target.kind === "CONTROL") return document.controls[target.control]?.at ?? note.at ?? undefined;
  if (target.kind === "LEG") {
    const from = document.controls[target.from]?.at, to = document.controls[target.to]?.at;
    if (!from || !to) return note.at ?? undefined;
    return middle([from, ...(document.legs[`${target.from}-${target.to}`]?.bends ?? []), to]);
  }
  return note.at ?? undefined;
}

export function filterNotes(notes: readonly CourseSettingNote[], filter: NoteFilter): CourseSettingNote[] {
  return notes.filter(note => filter === "ALL" || note.status === filter);
}

/** Notisen hör till vyn: alla i Alla kontroller; i en bana de som gäller banan, dess kontroller och sträckor, eller punkter. */
export function noteInView(note: CourseSettingNote, view: string, controlsInView: ReadonlySet<string>): boolean {
  if (view === ALL_CONTROLS) return true;
  const target = note.target;
  if (target.kind === "COURSE") return target.course === view;
  if (target.kind === "CONTROL") return controlsInView.has(target.control);
  if (target.kind === "LEG") return controlsInView.has(target.from) && controlsInView.has(target.to);
  return note.course === null || note.course === view;
}

/** Markeringarna: en per notis med läge, flera på samma ställe slås ihop (antalet visas). */
export function noteMarks(notes: readonly CourseSettingNote[], document: CourseSettingDocument): NoteMark[] {
  const marks: NoteMark[] = [];
  for (const note of notes) {
    const at = notePosition(note, document);
    if (!at) continue;
    const same = marks.findIndex(mark => Math.hypot(mark.at.x - at.x, mark.at.y - at.y) < 0.01);
    if (same >= 0) {
      const mark = marks[same]!;
      marks[same] = { ...mark, count: mark.count + 1, status: mark.status === "OPEN" || note.status === "OPEN" ? "OPEN" : "DONE" };
    } else marks.push({ id: note.id, at, status: note.status, count: 1 });
  }
  return marks;
}

/**
 * Markeringens storlek och läge: en ruta (14–28 px beroende på zoomen) upp till höger om punkten som en flagga, så att
 * kontrollringen syns. I kartans mm för träff-testet.
 */
export function noteMarkGeometry(pxPerMm: number): { sizePx: number; sizeMm: number; offsetMm: Point } {
  const sizePx = Math.max(14, Math.min(28, 2 * pxPerMm));
  const offset = (sizePx * 0.9) / pxPerMm;
  return { sizePx, sizeMm: sizePx / pxPerMm, offsetMm: { x: offset, y: offset } };
}

/** Den närmaste markeringen inom `toleranceMm` från markeringens ruta. */
export function hitNoteMark(marks: readonly NoteMark[], point: Point, toleranceMm: number, geometry: { sizeMm: number; offsetMm: Point })
  : NoteMark | undefined {
  let best: NoteMark | undefined, bestDistance = Infinity;
  for (const mark of marks) {
    const center = { x: mark.at.x + geometry.offsetMm.x, y: mark.at.y + geometry.offsetMm.y };
    const half = geometry.sizeMm / 2;
    const dx = Math.max(0, Math.abs(point.x - center.x) - half), dy = Math.max(0, Math.abs(point.y - center.y) - half);
    const distance = Math.hypot(dx, dy);
    if (distance <= toleranceMm && distance < bestDistance) { best = mark; bestDistance = distance; }
  }
  return best;
}

/** Vad en ny notis fästs vid efter ett klick: kontrollen eller sträckan som träffades, annars punkten. */
export function noteTargetAt(hit: HitTarget | undefined, point: Point): CourseSettingNoteTarget {
  if (hit?.kind === "control" || hit?.kind === "number") return { kind: "CONTROL", control: hit.control };
  if (hit?.kind === "leg") return { kind: "LEG", from: hit.from, to: hit.to };
  return { kind: "POINT", at: { x: Math.round(point.x * 100) / 100, y: Math.round(point.y * 100) / 100 } };
}

/**
 * Storleken som ett foto förminskas till: längsta sidan högst `maxSide` px, proportionerna kvar. Kvaliteten sänks
 * stegvis tills filen är högst 2 MB (`photoQualities`).
 */
export function scaledSize(width: number, height: number, maxSide = 1600): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export const PHOTO_QUALITIES: readonly number[] = [0.85, 0.75, 0.6, 0.45];
export const PHOTO_SIDES: readonly number[] = [1600, 1200, 900];
