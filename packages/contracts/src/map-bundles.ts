import { z } from "zod";
import { courseVariantCodeSchema } from "./course-edit";
import { uuidSchema as uuid } from "./ids";

/**
 * Kartor till starten (PLAN.md steg 61): tryckantal per variant, kartbuntslistan och baksidorna ur samma plan
 * (domänens `planMapBundles`), och vad som ändrats sedan en lista skrevs ut.
 */
const count = z.number().int().nonnegative().max(100_000);
const number = z.number().int().positive().max(100_000);
const instant = z.iso.datetime({ offset: true });
const name = z.string().min(1).max(400);
const variant = courseVariantCodeSchema.nullable();

export const mapReserveSchema = z.object({ kind: z.enum(["PERCENT", "COUNT"]), value: z.number().int().min(0).max(1000) }).strict();
export const mapPrintListSchema = z.enum(["BUNDLE", "BACKS"]);
export const mapStartModeSchema = z.enum(["MINUTE", "MASS", "FREE"]);

const itemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("RUNNER"), number, entryId: uuid, name, club: name.nullable(), className: name, startTime: instant.nullable() }).strict(),
  z.object({ kind: z.literal("VACANT"), number, className: name, startTime: instant }).strict()
]);

export const mapBundleGroupSchema = z.object({
  courseName: name, variantCode: variant, items: z.array(itemSchema).max(20_000),
  runnerCount: count, vacancyCount: count, reserveCount: count, printCount: count
}).strict();

export const mapBundleRowSchema = z.object({
  number, entryId: uuid.nullable(), name: name.nullable(), club: name.nullable(), classId: uuid, className: name, courseName: name,
  variantCode: variant, startTime: instant.nullable(), startMode: mapStartModeSchema
}).strict();

export const mapPrintChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ADDED"), name, className: name, variantCode: variant }).strict(),
  z.object({ kind: z.literal("REMOVED"), name, className: name, variantCode: variant }).strict(),
  z.object({ kind: z.literal("VARIANT"), name, className: name, from: variant, to: variant }).strict(),
  z.object({ kind: z.literal("CLASS"), name, from: name, to: name, variantCode: variant }).strict(),
  z.object({ kind: z.literal("START_TIME"), name, className: name, from: instant.nullable(), to: instant.nullable() }).strict(),
  z.object({ kind: z.literal("COUNT"), courseName: name, variantCode: variant, from: count, to: count }).strict(),
  z.object({ kind: z.literal("NUMBERS"), count }).strict()
]);

/** Läget som sparas när en lista skrivs ut (domänens `PrintedMapState`). */
export const printedMapStateSchema = z.object({
  rows: z.array(z.object({ entryId: uuid, number, name, className: name, courseName: name, variantCode: variant,
    startTime: instant.nullable() }).strict()).max(20_000),
  counts: z.array(z.object({ courseName: name, variantCode: variant, printCount: count }).strict()).max(20_000)
}).strict();

const printSchema = z.object({ printedAt: instant, changes: z.array(mapPrintChangeSchema).max(40_000) }).strict();

export const mapBundleResponseSchema = z.object({
  formatVersion: z.literal(1), raceId: uuid, snapshotVersion: z.number().int().positive(),
  eventName: name, raceName: name, raceDate: z.iso.date(), timeZone: z.string().min(1).max(100),
  reserve: mapReserveSchema,
  /** Hash av listans innehåll; utskriften sparas bara mot det innehåll som visades. */
  stateHash: z.string().regex(/^[a-f0-9]{64}$/),
  classes: z.array(z.object({ classId: uuid, name, courseName: name, variantCodes: z.array(courseVariantCodeSchema).max(100),
    startMode: mapStartModeSchema }).strict()).max(1000),
  groups: z.array(mapBundleGroupSchema).max(20_000),
  rows: z.array(mapBundleRowSchema).max(20_000),
  missingVariant: z.array(z.object({ entryId: uuid, name, className: name }).strict()).max(20_000),
  prints: z.object({ BUNDLE: printSchema.optional(), BACKS: printSchema.optional() }).strict()
}).strict();

export const mapPrintRequestSchema = z.object({ formatVersion: z.literal(1), list: mapPrintListSchema,
  stateHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const mapPrintResponseSchema = z.object({ formatVersion: z.literal(1), raceId: uuid, list: mapPrintListSchema, printedAt: instant }).strict();
export const mapReserveRequestSchema = z.object({ formatVersion: z.literal(1), reserve: mapReserveSchema }).strict();
export const mapReserveResponseSchema = z.object({ formatVersion: z.literal(1), raceId: uuid, reserve: mapReserveSchema }).strict();

export type MapReserveDto = z.infer<typeof mapReserveSchema>;
export type MapPrintList = z.infer<typeof mapPrintListSchema>;
export type MapBundleResponse = z.infer<typeof mapBundleResponseSchema>;
export type MapPrintChangeDto = z.infer<typeof mapPrintChangeSchema>;
export type MapBundleRowDto = z.infer<typeof mapBundleRowSchema>;
export type MapBundleGroupDto = z.infer<typeof mapBundleGroupSchema>;
