import type { MapObject } from "@o-tid/map-file";
import { circleShape, simplifyShape, smoothShape, straightenShape, vertexCount } from "@o-tid/map-revision";
import { mapProjectQuickSv } from "../i18n/map-project-quick-sv";
import type { Texts } from "./language";

/** Förenklingens tolerans i kartans mm: lite (0,05 mm) och mer (0,15 mm). */
export const SIMPLIFY_MM = { little: 0.05, more: 0.15 } as const;

export type ShapeActionId = "simplify" | "simplifyMore" | "smooth" | "straighten";
export interface ShapeAction { readonly id: ShapeActionId; readonly label: string; readonly result: MapObject | undefined; readonly message: string }

/**
 * Ägaren 2026-11-09: formens åtgärder för ett markerat objekt (linjer och ytor). Varje åtgärd har sitt resultat räknat (eller
 * inget när den inte ändrar något) och beskedet som visas efteråt.
 */
export function shapeActions(object: MapObject, text: Texts<typeof mapProjectQuickSv> = mapProjectQuickSv): ShapeAction[] {
  if (object.kind !== "line" && object.kind !== "area") return [];
  const before = vertexCount(object);
  const simplified = (tolerance: number, id: ShapeActionId, label: string): ShapeAction => {
    const result = simplifyShape(object, tolerance);
    return { id, label, result, message: result ? text.simplified(before, vertexCount(result)) : text.nothingToSimplify };
  };
  const curved = (object.kind === "line" ? object.path : object.rings.flat()).some(command => command.type === "C");
  return [
    simplified(SIMPLIFY_MM.little, "simplify", text.simplify),
    simplified(SIMPLIFY_MM.more, "simplifyMore", text.simplifyMore),
    { id: "smooth", label: text.smooth, result: smoothShape(object), message: text.smoothed },
    ...(curved ? [{ id: "straighten" as const, label: text.straighten, result: straightenShape(object), message: text.straightened }] : [])
  ];
}

/** Cirkeln som ritas med symbolen (linje eller yta), eller inget för en punkt- eller textsymbol. */
export function circleFor(kind: MapObject["kind"], symbol: string, center: { x: number; y: number }, edge: { x: number; y: number }): MapObject | undefined {
  if (kind !== "line" && kind !== "area") return undefined;
  return circleShape(kind, symbol, center, Math.hypot(edge.x - center.x, edge.y - center.y));
}

/** De senaste symbolerna: vald först, högst nio, utan dubbletter. */
export function withRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter(item => item !== id)].slice(0, 9);
}
