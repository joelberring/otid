import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * Steg 52 (ADR-0176): banhemlighet. Banorna visas publikt (gafflingsbilden, kontrollernas lägen, kontrollkartan) när
 * ingen deltagare är kvar, när resultaten är fastställda eller när arrangören valt "Visa banorna publikt nu".
 */
export const coursePublicReasonSchema = z.enum(["REVEALED", "FINALIZED", "ALL_FINISHED"]);
export type CoursePublicReasonValue = z.infer<typeof coursePublicReasonSchema>;

export const courseSecrecyStateSchema = z.object({
  public: z.boolean(),
  reason: coursePublicReasonSchema.nullable(),
  /** Deltagare utan resultat eller beslut. */
  remaining: z.number().int().min(0).max(100_000),
  /** Arrangörens val "Visa banorna publikt nu". Null = inte valt. */
  revealedAt: z.iso.datetime({ offset: true }).nullable()
}).strict();
export type CourseSecrecyState = z.infer<typeof courseSecrecyStateSchema>;

export const courseSecrecyResponseSchema = z.object({
  formatVersion: z.literal(1),
  raceId: uuidSchema,
  courseSecrecy: courseSecrecyStateSchema
}).strict();
export type CourseSecrecyResponse = z.infer<typeof courseSecrecyResponseSchema>;
