import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * ADR-0219 (ägaren 2026-11-09, lagren fas 2, migration 0107): egna lager i kartprojektet. Ett **arbetslager** (`SYMBOLS`) är en
 * namngiven grupp av normens symbolnummer, delad i projektet; ett **skisslager** (`SKETCH`) har skisser som inte hör till
 * kartan (linjer på fri hand, punkter och korta texter, i kartans mm). Id:n skapas i klienten (samma begäran två gånger blir en).
 */
export const MAP_PROJECT_SKETCH_COLORS = ["#c0262d", "#1f5fbf", "#1d8a3a", "#7a3fb0", "#d4570b", "#000000"] as const;
const code = z.string().regex(/^\d{3}(\.\d{1,3})?$/);
const name = z.string().trim().min(1).max(80);
const color = z.enum(MAP_PROJECT_SKETCH_COLORS);
const coordinate = z.number().finite().min(-5_000_000).max(5_000_000);

export const mapProjectWorkLayerCreateRequestSchema = z.object({
  formatVersion: z.literal(1), layerId: uuidSchema, kind: z.enum(["SYMBOLS", "SKETCH"]), name,
  codes: z.array(code).max(300).optional(), color: color.optional()
}).strict().refine(value => value.kind === "SKETCH" || (value.codes?.length ?? 0) > 0, { message: "Ett arbetslager behöver symboler" });
export const mapProjectWorkLayerUpdateRequestSchema = z.object({
  formatVersion: z.literal(1), name: name.optional(), codes: z.array(code).min(1).max(300).optional(), color: color.optional()
}).strict().refine(value => Object.keys(value).length > 1);

export const mapProjectSketchCreateRequestSchema = z.object({
  formatVersion: z.literal(1), sketchId: uuidSchema, layerId: uuidSchema, kind: z.enum(["LINE", "POINT", "TEXT"]),
  points: z.array(z.tuple([coordinate, coordinate])).min(1).max(2000), text: z.string().trim().min(1).max(200).optional()
}).strict().refine(value => value.kind === "LINE" ? value.points.length >= 2 : value.points.length === 1, { message: "Fel antal punkter" })
  .refine(value => (value.kind === "TEXT") === (value.text !== undefined), { message: "Bara en text har text" });

/** Ägaren 2026-11-10: många skisser i ett anrop (ett äldre underlag som läses in i ett skisslager). */
export const MAP_PROJECT_SKETCH_BATCH_MAX = 500;
export const mapProjectSketchBatchRequestSchema = z.object({
  formatVersion: z.literal(1), layerId: uuidSchema,
  sketches: z.array(z.object({ sketchId: uuidSchema, kind: z.enum(["LINE", "POINT", "TEXT"]),
    points: z.array(z.tuple([coordinate, coordinate])).min(1).max(2000), text: z.string().trim().min(1).max(200).optional() }).strict()
    .refine(value => value.kind === "LINE" ? value.points.length >= 2 : value.points.length === 1)
    .refine(value => (value.kind === "TEXT") === (value.text !== undefined))).min(1).max(MAP_PROJECT_SKETCH_BATCH_MAX)
}).strict();

export interface MapProjectWorkLayerView {
  readonly layerId: string; readonly kind: "SYMBOLS" | "SKETCH"; readonly name: string; readonly codes: readonly string[]; readonly color: string;
  readonly own: boolean; readonly createdBy: { readonly accountId: string; readonly name: string | null }; readonly createdAt: string;
}
export interface MapProjectSketchView {
  readonly sketchId: string; readonly layerId: string; readonly kind: "LINE" | "POINT" | "TEXT";
  readonly points: readonly (readonly [number, number])[]; readonly text: string | null; readonly own: boolean; readonly createdAt: string;
}
export interface MapProjectWorkLayerList {
  readonly formatVersion: 1; readonly layers: readonly MapProjectWorkLayerView[]; readonly sketches: readonly MapProjectSketchView[];
}
