import type { MapObject } from "@o-tid/map-file";
import { circleShape, SIMPLIFY_GROWTH, simplifyStep, smoothShape, straightenShape, vertexCount, type SimplifyStep } from "@o-tid/map-revision";
import { mapProjectQuickSv } from "../i18n/map-project-quick-sv";
import type { Texts } from "./language";

/** Förenklingens tolerans i kartans mm: lite (0,05 mm) och mer (0,15 mm). */
export const SIMPLIFY_MM = { little: 0.05, more: 0.15 } as const;

export type ShapeActionId = "simplify" | "simplifyMore" | "smooth" | "straighten";
export interface ShapeAction { readonly id: ShapeActionId; readonly label: string; readonly result: MapObject | undefined; readonly message: string;
  /** Förenklingens steg (toleransen som gav resultatet), som minns när åtgärden görs. */
  readonly step?: SimplifyStep | undefined }

/**
 * Ägaren 2026-11-23 («förenkla mer … går att göra en gång sen blir det inte mer»): förenklingens förra tolerans per objekt, så
 * att nästa tryck börjar ×1,6 högre. Gäller bara så länge objektet har det antal punkter som förra förenklingen gav (ändras
 * det på annat sätt, eller ångras det, börjar det om från grundsteget).
 */
export type SimplifyMemory = Map<string, { readonly tolerance: number; readonly count: number }>;

/** Nästa förenkling av objektet från grundsteget `base` eller ett steg över den förra. */
export function nextSimplify(memory: SimplifyMemory | undefined, key: string | undefined, object: MapObject, base: number,
  minArea: number | undefined): SimplifyStep | undefined {
  const seen = key === undefined ? undefined : memory?.get(key);
  const from = seen && seen.count === vertexCount(object) ? Math.max(base, seen.tolerance * SIMPLIFY_GROWTH) : base;
  return simplifyStep(object, from, { minArea });
}

/** Minns steget som just gjordes på objektet. */
export function rememberSimplify(memory: SimplifyMemory, key: string, step: SimplifyStep) {
  memory.set(key, { tolerance: step.tolerance, count: vertexCount(step.object) });
}

/**
 * Ägaren 2026-11-09: formens åtgärder för ett markerat objekt (linjer och ytor). Varje åtgärd har sitt resultat räknat (eller
 * inget när den inte ändrar något) och beskedet som visas efteråt. Förenkla och Förenkla mer går stegvis (`nextSimplify`).
 */
export function shapeActions(object: MapObject, text: Texts<typeof mapProjectQuickSv> = mapProjectQuickSv,
  simplify: { readonly memory?: SimplifyMemory | undefined; readonly key?: string | undefined; readonly minArea?: number | undefined } = {}): ShapeAction[] {
  if (object.kind !== "line" && object.kind !== "area") return [];
  const before = vertexCount(object);
  const simplified = (tolerance: number, id: ShapeActionId, label: string): ShapeAction => {
    const step = nextSimplify(simplify.memory, simplify.key, object, tolerance, simplify.minArea), result = step?.object;
    return { id, label, result, step, message: result ? text.simplified(before, vertexCount(result)) : text.nothingToSimplify };
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
