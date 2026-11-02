import type { Point } from "@o-tid/map-file";
import type { CourseSettingDocument, MapRect, PrintArea } from "./types";

/**
 * ADR-0194 beslut 4: banläggningen flyttad till en annan kartversion ("Flytta banorna till senaste kartversionen"). Varje
 * läge i kartans mm går genom `move`: kontrollerna, flyttade nummer, sträckornas brytpunkter och snitslingen,
 * specialobjektens punkter och tryckytorna. Längder, vinklar och storlekar ändras inte (en ny version av samma karta har
 * samma skala; en vridning mellan versionerna är högst några grader).
 */
export function moveDocumentPoints(document: CourseSettingDocument, move: (point: Point) => Point): CourseSettingDocument {
  const rect = (value: MapRect): MapRect => {
    const a = move({ x: value.minX, y: value.minY }), b = move({ x: value.maxX, y: value.maxY });
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  };
  const area = (value: PrintArea | undefined): PrintArea | undefined => value?.rect ? { ...value, rect: rect(value.rect) } : value;
  const controls = Object.fromEntries(Object.entries(document.controls).map(([id, control]) => [id, { ...control, at: move(control.at) }]));
  const courseControls = Object.fromEntries(Object.entries(document.courseControls).map(([id, control]) =>
    [id, control.numberAt ? { ...control, numberAt: move(control.numberAt) } : control]));
  const legs = Object.fromEntries(Object.entries(document.legs).map(([key, leg]) => [key, { ...leg, bends: leg.bends.map(move),
    ...(leg.flaggingAt ? { flaggingAt: move(leg.flaggingAt) } : {}) }]));
  const printArea = area(document.event.printArea);
  return {
    ...document,
    event: { ...document.event, ...(printArea ? { printArea } : {}) },
    controls, courseControls, legs,
    courses: document.courses.map(course => { const moved = area(course.printArea); return moved ? { ...course, printArea: moved } : course; }),
    specialObjects: document.specialObjects.map(special => ({ ...special, points: special.points.map(move) }))
  };
}

/** Kontrollernas yta (mm), eller null utan kontroller. */
export function controlBounds(document: CourseSettingDocument): MapRect | null {
  const points = Object.values(document.controls).map(control => control.at);
  if (points.length === 0) return null;
  return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)),
    maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
}
