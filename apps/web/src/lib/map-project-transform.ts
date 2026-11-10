import type { MapObject, PathCommand, Point } from "@o-tid/map-file";
import { objectBox, type Box } from "@o-tid/map-revision";

/** Ägaren 2026-11-10: flera markerade objekt flyttas och vrids tillsammans (som i Illustrator). */

/** Rutan runt objekten (kartans mm), eller inget för en tom lista. */
export function boundsOf(objects: readonly MapObject[]): Box | undefined {
  if (objects.length === 0) return undefined;
  const boxes = objects.map(objectBox);
  return { minX: Math.min(...boxes.map(box => box.minX)), minY: Math.min(...boxes.map(box => box.minY)),
    maxX: Math.max(...boxes.map(box => box.maxX)), maxY: Math.max(...boxes.map(box => box.maxY)) };
}

export const centerOf = (box: Box): Point => ({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 });

/** Vinkeln från mitten till punkten, i grader moturs (kartans y pekar uppåt). */
export const angleFrom = (center: Point, point: Point): number => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;

/**
 * Objektet vridet `degrees` grader moturs runt `center`: alla punkter och kurvornas styrpunkter flyttas, och en punktsymbols,
 * en texts och ett ytmönsters egen vinkel följer med.
 */
export function rotateObject(object: MapObject, center: Point, degrees: number): MapObject {
  const radians = degrees * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
  const turn = (x: number, y: number) => ({ x: center.x + (x - center.x) * cos - (y - center.y) * sin, y: center.y + (x - center.x) * sin + (y - center.y) * cos });
  const angle = (value: number) => (((value + degrees) % 360) + 360) % 360;
  const command = (item: PathCommand): PathCommand => {
    const to = turn(item.x, item.y);
    if (item.type !== "C") return { ...item, ...to };
    const first = turn(item.x1, item.y1), second = turn(item.x2, item.y2);
    return { ...item, ...to, x1: first.x, y1: first.y, x2: second.x, y2: second.y };
  };
  if (object.kind === "point" || object.kind === "text") return { ...object, at: turn(object.at.x, object.at.y), angle: angle(object.angle) };
  if (object.kind === "line") return { ...object, path: object.path.map(command) };
  return { ...object, angle: angle(object.angle), rings: object.rings.map(ring => ring.map(command)) };
}
