import type { MapObject, Point } from "@o-tid/map-file";
import type { ObjectKey, ObjectRef, VertexAddress } from "@o-tid/map-revision";
import type { SnapExtra } from "../../lib/map-project-snap";

/** Kartredigerarens typer och konstanter, utbrutna ur `map-project-editor.tsx` (ägaren 2026-11-23, filen under 800 rader). */
/** `area` = rita ett delområde (bara ägarna); `split` = dela kartområdet eller en del med ett streck; `note` = tryck där en notis ska sitta (K3); `circle` = runda former (ägaren 2026-11-09); `bucket` = Fyll yta (rutan mellan linjerna, ägaren 2026-11-13). */
export type Tool = "select" | "draw" | "area" | "split" | "note" | "circle" | "rectangle" | "bucket" | "text" | "addPoint" | "removePoint" | "cut";
export interface Selected { readonly key: ObjectKey; readonly ref: ObjectRef | null; readonly object: MapObject }
export type Drag =
  /** `extra`: objektets övriga punkter och sträckor att fästa mot (K8b V3); `anchor`: objektets punkt närmast greppet, som fästs. */
  | { readonly mode: "vertex"; readonly address: VertexAddress; readonly original: MapObject; readonly extra: SnapExtra }
  | { readonly mode: "object"; readonly start: Point; readonly original: MapObject; readonly anchor: Point | undefined }
  | { readonly mode: "rotate"; readonly original: MapObject }
  | { readonly mode: "place"; readonly at: Point }
  | { readonly mode: "handle" }
  /** K3: sträckan böjs (dras i där man tog tag). */
  | { readonly mode: "bend"; readonly address: VertexAddress; readonly t: number; readonly start: Point; readonly original: MapObject }
  /** K3: punktens styrpunkt dras. */
  | { readonly mode: "curveHandle"; readonly address: VertexAddress; readonly which: "in" | "out"; readonly original: MapObject }
  /** Cirkeln dras från mitten ut till kanten. */
  | { readonly mode: "circle"; readonly center: Point };

export const NO_MARKS = { selected: [], flagged: [], radiusMm: 0 } as const;
export const SHOWN_STATUSES = new Set(["UNSEEN", "PASSED", "CHECKED"] as const);
export const DOUBLE_TAP_MS = 350;
/** Fingret: så länge (ms) innan något markerat följer med i ett drag. Kort (ägaren 2026-11-12: «lyckas bara en gång»): efter 550 ms öppnas hjulet, så fönstret var för smalt med 250. */
export const TOUCH_HOLD_MS = 120;
export const degreesTo = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
/** Linjeändar närmare varandra än så (mm på kartan) räknas som att de möts när linjer slås ihop. */
export const JOIN_MM = 0.3;

