/**
 * Spegelorientering (ADR-0192 beslut 12): kartan och banan spegelvända i utskriften. Ramens kartbild vänds kring ramens
 * mitt (förhandsvisningen och PDF:en), och banpåtrycket speglas här kring samma linje, så att kontrollerna hamnar på samma
 * föremål i den vända kartan. Texter (nummer, kepsens etiketter, markeringar) speglas till sin plats men vänds inte;
 * beskrivningar och bilder på kartan står kvar där banläggaren lagt dem. Editorn och avläsningen påverkas inte.
 */
import type { Point } from "@o-tid/map-file";
import type { OverprintPrimitive } from "./types";

/** Speglingen kring den lodräta linjen x = `axis` (kartans mm). */
export function mirrorPoint(point: Point, axis: number): Point {
  return { x: 2 * axis - point.x, y: point.y };
}

/** Avbrotten i ringen (grader moturs från öster): [s, e] blir [180 − e, 180 − s]. */
function mirrorGaps(gaps: readonly { readonly startDegrees: number; readonly endDegrees: number }[]) {
  return gaps.map(gap => {
    const span = gap.endDegrees - gap.startDegrees;
    const start = (((180 - gap.endDegrees) % 360) + 360) % 360;
    return { startDegrees: start, endDegrees: start + span };
  });
}

/** Banpåtrycket speglat kring x = `axis`. */
export function mirrorFigures(figures: readonly OverprintPrimitive[], axis: number): OverprintPrimitive[] {
  const m = (point: Point) => mirrorPoint(point, axis);
  return figures.map((figure): OverprintPrimitive => {
    switch (figure.kind) {
      case "circle": return { ...figure, center: m(figure.center), ...(figure.gaps ? { gaps: mirrorGaps(figure.gaps) } : {}) };
      case "polyline": return { ...figure, points: figure.points.map(m) };
      case "polygon": return { ...figure, rings: figure.rings.map(ring => ring.map(m)) };
      case "text": return { ...figure, at: m(figure.at) };
      case "image": case "description": return figure;
    }
  });
}
