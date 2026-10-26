import { z } from "zod";
import { uuidSchema } from "./ids";
import { courseForkingViewSchema } from "./course-forking";
import { courseVariantCodeSchema } from "./course-edit";

/**
 * Steg 52 (ADR-0176): kontrollkartan. Lägena är i en gemensam ram: kartbildens pixlar (MAP), meter runt mittpunkten med
 * norr uppåt (GEO) eller kartlägena i meter med kartans skala (PAPER). Inga interna id utom banans (för valet i arbetsytan).
 */
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const count = z.number().int().min(0).max(100_000);
const code = z.number().int().positive().max(100_000);

export const controlMapFrameSchema = z.enum(["MAP", "GEO", "PAPER", "NONE"]);

const layoutFields = {
  frame: controlMapFrameSchema,
  /** Meter per enhet i ramen; null = okänd skala (kartlägen utan skala). */
  metersPerUnit: z.number().positive().finite().nullable(),
  /** Kartbilden under (bara MAP): storlek och version för bildens adress. */
  map: z.object({ width: z.number().int().positive(), height: z.number().int().positive(), version: z.string().regex(/^[0-9a-f]{16}$/) })
    .strict().nullable(),
  bounds: z.object({ minX: coordinate, minY: coordinate, maxX: coordinate, maxY: coordinate }).strict().nullable()
};

const variantSchema = z.object({ code: courseVariantCodeSchema.nullable(), controlCodes: z.array(code).max(1000), entryCount: count }).strict();

export const controlMapCourseSchema = z.object({
  courseId: uuidSchema,
  name: z.string().min(1).max(160),
  classNames: z.array(z.string().min(1).max(160)).max(1000),
  start: point.nullable(),
  finish: point.nullable(),
  /** En bana utan gafflingar har en variant med koden null. */
  variants: z.array(variantSchema).min(1).max(100),
  forking: courseForkingViewSchema.nullable()
}).strict();
export type ControlMapCourse = z.infer<typeof controlMapCourseSchema>;

export const controlMapControlSchema = z.object({
  code,
  position: point.nullable(),
  /** Kontroll ur funktion (rättning för hela tävlingen). */
  outOfOrder: z.boolean(),
  courses: count, variants: count, planned: count, punched: count
}).strict();
export type ControlMapControl = z.infer<typeof controlMapControlSchema>;

export const controlMapResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuidSchema,
  ...layoutFields,
  controls: z.array(controlMapControlSchema).max(2000),
  courses: z.array(controlMapCourseSchema).max(1000)
}).strict();
export type ControlMapResponse = z.infer<typeof controlMapResponseSchema>;

export const runnerControlMarkSchema = z.enum(["OK", "MISSING", "WRONG_ORDER", "NEUTRAL"]);
export const runnerControlMarkRowSchema = z.object({
  code, position: z.number().int().positive().max(1000), mark: runnerControlMarkSchema,
  previous: z.union([code, z.literal("S")]), next: z.union([code, z.literal("M")])
}).strict();
export type RunnerControlMarkRowDto = z.infer<typeof runnerControlMarkRowSchema>;

/** Ett lopp för en löpare: banan (variant) och stämplingarna mot den. `leg` = stafettens sträcka, annars null. */
export const runnerControlMapLegSchema = z.object({
  leg: z.number().int().positive().max(30).nullable(),
  courseName: z.string().min(1).max(160),
  variantCode: courseVariantCodeSchema.nullable(),
  start: point.nullable(),
  finish: point.nullable(),
  /** null = ingen avläsning än; banan visas utan markeringar. */
  marks: z.array(runnerControlMarkRowSchema).max(1000).nullable(),
  controlCodes: z.array(code).max(1000)
}).strict();
export type RunnerControlMapLeg = z.infer<typeof runnerControlMapLegSchema>;

/** Löparens karta: bara löparens egna kontroller, inga andra löpares data och ingen belastning. */
export const runnerControlMapSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuidSchema,
  ...layoutFields,
  name: z.string().min(1).max(321),
  controls: z.array(z.object({ code, position: point.nullable() }).strict()).max(2000),
  legs: z.array(runnerControlMapLegSchema).min(1).max(30)
}).strict();
export type RunnerControlMap = z.infer<typeof runnerControlMapSchema>;
