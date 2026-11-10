import type { MapObject, Point } from "@o-tid/map-file";
import { deleteVertex, insertOnSegment, nearestSegment, type VertexAddress } from "@o-tid/map-revision";
import { nearestVertex } from "./map-project-draw";

/**
 * Ägaren 2026-11-10: ett klick som ändrar punkterna i en linje eller yta. `REMOVE` tar bort brytpunkten under pekaren, `ADD`
 * lägger en ny punkt på sträckan under pekaren, och `EITHER` (Cmd/Ctrl+klick i Redigera) tar bort om pekaren står på en punkt
 * och lägger annars till. Svaret är det nya objektet och den nya punktens adress, eller inget när klicket inte träffade.
 */
export function editPointAt(object: MapObject, point: Point, tolerance: number, mode: "ADD" | "REMOVE" | "EITHER"):
  { object: MapObject; address?: VertexAddress } | undefined {
  if (object.kind === "point" || object.kind === "text") return undefined;
  const vertex = mode === "ADD" ? undefined : nearestVertex(object, point, tolerance);
  if (vertex) {
    const removed = deleteVertex(object, { part: vertex.part, index: vertex.index });
    return removed ? { object: removed } : undefined;
  }
  if (mode === "REMOVE") return undefined;
  const hit = nearestSegment(object, point, tolerance);
  return hit ? insertOnSegment(object, hit, hit.t) : undefined;
}
