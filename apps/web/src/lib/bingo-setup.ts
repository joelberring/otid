/**
 * Bingoorientering i banläggningen (ägaren 2026-11-15): en grupp är en bana utan kontroller med ett rutnät
 * (`CourseTraining.bingo`). Rena hjälpfunktioner för panelen: grupperna, området och ändringarna.
 */
import { bingoCells, courseTrainingOf, type BingoTraining, type CourseSettingDocument, type CourseSettingEdit, type MapRect } from "@o-tid/course-setting";
import type { Point } from "@o-tid/map-file";

export interface BingoGroupRow {
  readonly course: string;
  readonly name: string;
  readonly bingo: BingoTraining;
  readonly cells: number;
  readonly printScale: number | undefined;
}

/** Grupperna (banorna med rutnät) i banornas ordning. */
export function bingoGroups(document: CourseSettingDocument): BingoGroupRow[] {
  const courses = document.training?.courses ?? {};
  return document.courses.flatMap(course => {
    const bingo = courses[course.id]?.bingo;
    return bingo ? [{ course: course.id, name: course.name, bingo, cells: bingoCells(bingo, document.event.mapScale).length,
      printScale: course.printScale }] : [];
  });
}

/** Rektangeln runt de klickade punkterna, klippt till kartan; undefined utan yta. */
export function bingoAreaFrom(points: readonly Point[], map: MapRect | undefined): MapRect | undefined {
  if (points.length < 2) return undefined;
  let minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
  let minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
  if (map) { minX = Math.max(minX, map.minX); maxX = Math.min(maxX, map.maxX); minY = Math.max(minY, map.minY); maxY = Math.min(maxY, map.maxY); }
  const round = (value: number) => Math.round(value * 100) / 100;
  return maxX - minX > 1 && maxY - minY > 1 ? { minX: round(minX), minY: round(minY), maxX: round(maxX), maxY: round(maxY) } : undefined;
}

/** Förslag på gruppernas namn: färgerna i svensk ungdomsorientering. Fritt namn går också. */
export const BINGO_GROUP_NAMES = ["Grön", "Vit", "Gul", "Orange", "Violett", "Blå"] as const;

/** Första färgen som ingen grupp har än. */
export function suggestedGroupName(document: CourseSettingDocument): string | undefined {
  const used = new Set(bingoGroups(document).map(group => group.name.trim().toLowerCase()));
  return BINGO_GROUP_NAMES.find(name => !used.has(name.toLowerCase()));
}

/** Träningens område: det som grupperna utan eget område har (eller det nyss ritade). */
export function trainingBingoArea(document: CourseSettingDocument, pending: MapRect | undefined): MapRect | undefined {
  const groups = bingoGroups(document);
  return pending ?? groups.find(group => !group.bingo.ownArea)?.bingo.area ?? groups[0]?.bingo.area;
}

/** Träningens område för alla grupper utan eget område (ett ångra-steg). */
export function setBingoAreaEdits(document: CourseSettingDocument, area: MapRect): CourseSettingEdit[] {
  const groups = bingoGroups(document).filter(group => !group.bingo.ownArea);
  if (groups.length === 0) return [];
  return [{ type: "PUT_TRAINING", courses: Object.fromEntries(groups.map(group =>
    [group.course, { ...courseTrainingOf(document, group.course), bingo: { ...group.bingo, area } }])) }];
}

/** En ny grupp: en bana med gruppens namn och rutnätet (banans id blir nästa nummer, som `ADD_COURSE`). */
export function addBingoGroupEdits(document: CourseSettingDocument, name: string, cellMeters: number, area: MapRect, printScale: number | undefined):
  { edits: CourseSettingEdit[]; courseId: string } {
  const courseId = String(Math.max(0, ...document.courses.map(course => Number(course.id) || 0)) + 1);
  const edits: CourseSettingEdit[] = [{ type: "ADD_COURSE", name },
    { type: "UPDATE_COURSE", course: courseId, changes: { secondaryTitle: `Bingo · rutor ${cellMeters} m`, ...(printScale ? { printScale } : {}) } },
    { type: "PUT_TRAINING", courses: { [courseId]: { outside: { kind: "FULL" }, sections: [], bingo: { area, cellMeters } } } }];
  return { edits, courseId };
}

/** Gruppens eget område (`area`), eller tillbaka till träningens (`area` = träningens, utan flaggan). */
export function setGroupAreaEdits(document: CourseSettingDocument, group: BingoGroupRow, area: MapRect, own: boolean): CourseSettingEdit[] {
  const bingo: BingoTraining = { area, cellMeters: group.bingo.cellMeters, ...(own ? { ownArea: true } : {}),
    ...(group.bingo.ships ? { ships: group.bingo.ships } : {}) };
  return [{ type: "PUT_TRAINING", courses: { [group.course]: { ...courseTrainingOf(document, group.course), bingo } } }];
}

/** Skeppen för gruppen ("4, 3, 2"); tom text = efter rutnätets storlek. Undefined om texten inte går att läsa. */
export function parseShips(text: string): number[] | null | undefined {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const lengths = parts.map(Number);
  return lengths.length <= 8 && lengths.every(length => Number.isInteger(length) && length >= 1 && length <= 6) ? lengths : undefined;
}

export function setShipsEdits(document: CourseSettingDocument, group: BingoGroupRow, ships: readonly number[] | null): CourseSettingEdit[] {
  const bingo: BingoTraining = { area: group.bingo.area, cellMeters: group.bingo.cellMeters, ...(group.bingo.ownArea ? { ownArea: true } : {}),
    ...(ships ? { ships } : {}) };
  return [{ type: "PUT_TRAINING", courses: { [group.course]: { ...courseTrainingOf(document, group.course), bingo } } }];
}

/** Ny rutstorlek för gruppen (och rubrikens rad). */
export function setBingoCellEdits(document: CourseSettingDocument, group: BingoGroupRow, cellMeters: number): CourseSettingEdit[] {
  return [{ type: "PUT_TRAINING", courses: { [group.course]: { ...courseTrainingOf(document, group.course), bingo: { ...group.bingo, cellMeters } } } },
    { type: "UPDATE_COURSE", course: group.course, changes: { secondaryTitle: `Bingo · rutor ${cellMeters} m` } }];
}
