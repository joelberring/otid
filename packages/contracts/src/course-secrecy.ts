import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * Steg 52 (ADR-0176): banhemlighet. Banorna visas publikt (gafflingsbilden, kontrollernas lägen, kontrollkartan) när
 * ingen deltagare är kvar, när resultaten är fastställda eller när arrangören valt "Visa banorna publikt nu".
 */
export const coursePublicReasonSchema = z.enum(["REVEALED", "FINALIZED", "ALL_FINISHED"]);
export type CoursePublicReasonValue = z.infer<typeof coursePublicReasonSchema>;

/**
 * ADR-0186: före start. Varianten publikt efter löparens start (förval) eller alltid; kartbilden publikt efter tävlingens
 * start (förval) eller direkt när tävlingen publiceras.
 */
export const publicVariantTimingSchema = z.enum(["AFTER_START", "ALWAYS"]);
export const publicMapTimingSchema = z.enum(["AFTER_START", "ON_PUBLISH"]);
export const publicTimingSchema = z.object({ variant: publicVariantTimingSchema, map: publicMapTimingSchema }).strict();
export type PublicTimingValue = z.infer<typeof publicTimingSchema>;

export const courseSecrecyStateSchema = z.object({
  public: z.boolean(),
  reason: coursePublicReasonSchema.nullable(),
  /** Deltagare utan resultat eller beslut. */
  remaining: z.number().int().min(0).max(100_000),
  /** Arrangörens val "Visa banorna publikt nu". Null = inte valt. */
  revealedAt: z.iso.datetime({ offset: true }).nullable(),
  /** ADR-0186: arrangörens val för varianten och kartan före start. Saknas i svar från före ADR-0186. */
  publicTiming: publicTimingSchema.optional()
}).strict();
export type CourseSecrecyState = z.infer<typeof courseSecrecyStateSchema>;

export const courseSecrecyResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuidSchema,
  courseSecrecy: courseSecrecyStateSchema
}).strict();
export type CourseSecrecyResponse = z.infer<typeof courseSecrecyResponseSchema>;

/** PATCH …/course-secrecy: ett eller båda valen. */
export const publicTimingRequestSchema = z.object({
  formatVersion: z.literal(1),
  variant: publicVariantTimingSchema.optional(),
  map: publicMapTimingSchema.optional()
}).strict().refine(value => value.variant !== undefined || value.map !== undefined);
export type PublicTimingRequest = z.infer<typeof publicTimingRequestSchema>;

export const publicTimingResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuidSchema,
  publicTiming: publicTimingSchema
}).strict();
export type PublicTimingResponse = z.infer<typeof publicTimingResponseSchema>;
